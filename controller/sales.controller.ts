import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import connect from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { allocateDiscountCents } from '../utils/saleAmount.js';
import { calculateLoyaltyPoints } from '../utils/loyaltyPoints.js';
import { positiveInt } from '../utils/numberHelper.js';
import { buildEscPosReceipt, ReceiptPrinterError, sendEscPosReceipt } from '../utils/receiptPrinter.js';
import { getBranchPrinterSettings } from '../utils/printerSettings.js';
import { serviceMessage } from '../utils/service.Message.js';

// ขอบเขตตัวเลขต้องตรงกับ INT และ DECIMAL ใน MySQL เพื่อปฏิเสธข้อมูลก่อนเขียน DB
const MAX_SQL_INT = 2_147_483_647;
const MAX_DECIMAL_12_2_CENTS = 999_999_999_999;
const MAX_DECIMAL_10_2_CENTS = 9_999_999_999;
const SALE_ROLES = new Set(['superuser', 'admin', 'manager', 'cashier', 'staff']);
const BRANCH_ROLES = new Set(['manager', 'cashier', 'staff']);

// unit ระบุหน่วยที่ลูกค้าซื้อ; quantity นับตาม unit แต่ stockQuantity แปลงกลับเป็นชิ้นย่อยในสต็อก
type SaleUnit = 'item' | 'pack';
type SaleRequestItem = {
  p_id: number;
  quantity: number;
  unit: SaleUnit;
};

type SaleInput = {
  bran_id: number;
  customer_id: number | null;
  customer_phone: string | null;
  // อัตราส่วนลดเก็บเป็น basis points: 10.50% = 1050 เพื่อคำนวณเป็นจำนวนเต็ม
  discountBps: number;
  items: SaleRequestItem[];
};

// รูปแบบแถวที่อ่านจากตารางสินค้า ราคา และสต็อก
type SaleProductRow = RowDataPacket & {
  p_id: number;
  bran_id: number;
  items_per_pack: number;
  stock_id: number | null;
  stock_amount: number | null;
  sale_price_items: string | number | null;
  sale_price_pack: string | number | null;
};

type SaleTaxRow = RowDataPacket & {
  tax_rate: string | number;
  tax_type: 'VAT' | 'NO_TAX' | 'OTHER';
};

// รายละเอียดขายที่ GET ส่งกลับ; total_item_amount เดิมคือยอดหลังหักส่วนลดแต่ยังไม่รวม VAT
type SaleItemRow = RowDataPacket & {
  item_id: number;
  p_id: number;
  p_name: string;
  p_code: string;
  sale_unit: SaleUnit;
  quantity: number;
  stock_quantity: number;
  price_per_unit: string | number;
  line_discount_amount: string | number;
  total_item_amount: string | number;
  taxable_amount: string | number;
  total_amount: string | number;
  vat_amount: string | number;
  vat_rate: string | number;
};

// หัวบิลที่อ่านจากตาราง sales
type SaleHeaderRow = RowDataPacket & {
  sale_id: number;
  company_id: number;
  bran_id: number;
  user_id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  points_earned: number | string;
  points_balance: number | string;
  subtotal: string | number;
  discount_rate: string | number;
  discount_amount: string | number;
  taxable_amount: string | number;
  vat_rate: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  created_at: string;
};

type SaleReceiptHeaderRow = RowDataPacket & {
  sale_id: number;
  company_id: number;
  bran_id: number;
  company_name: string;
  bran_name: string;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: string | number;
  discount_amount: string | number;
  vat_rate: string | number;
  vat_amount: string | number;
  total_amount: string | number;
  created_at: string;
};

type SaleReceiptItemRow = RowDataPacket & {
  p_id: number;
  p_name: string | null;
  sale_unit: SaleUnit;
  quantity: number;
  price_per_unit: string | number;
  line_total: string | number;
};

type DbConnection = Parameters<Parameters<typeof withTransaction>[0]>[0];

// ค่าที่คำนวณได้ต่อรายการ โดยจำนวนเงินเก็บเป็นหน่วยสตางค์จนกว่าจะเขียนหรือส่ง response
type PreparedItem = SaleRequestItem & {
  stockQuantity: number;
  priceCents: number;
  lineSubtotalCents: number;
  discountCents: number;
  taxableCents: number;
  vatCents: number; 
};

// รหัสข้อผิดพลาดภายใน ใช้แปลงเป็น HTTP status/message ที่ handler
type SaleErrorCode =
  | 'scope'
  | 'branch'
  | 'customer'
  | 'loyalty_config'
  | 'product'
  | 'stock'
  | 'stock_conflict'
  | 'stock_data'
  | 'tax'
  | 'price_or_stock'
  | 'amount'
  | 'idempotency_conflict';

class SaleError extends Error {
  constructor(readonly code: SaleErrorCode, readonly p_id?: number) {
    super(code);
  }
}

// แปลงเปอร์เซ็นต์เป็น basis points โดยอ่านทศนิยมจากข้อความตรง ๆ ไม่ใช้เลขทศนิยมลอยตัว
const parseRate = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const input = String(value);
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= 10_000 ? basisPoints : null;
};

// ตรวจจำนวนบวกให้อยู่ในช่วง signed INT ที่ฐานข้อมูลรองรับ
const positiveSqlInt = (value: unknown): number | null => { 
  const parsed = positiveInt(value);
  return parsed !== null && parsed <= MAX_SQL_INT ? parsed : null;
};

// ตรวจ body ของ POST /sales และแปลง discount_rate จากเปอร์เซ็นต์เป็น basis points
const parseSaleInput = (body: unknown): SaleInput | null => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const data = body as Record<string, unknown>;
  const branchId = positiveSqlInt(data.bran_id);
  const customerId = data.customer_id == null ? null : positiveSqlInt(data.customer_id);
  const customerPhone = data.customer_phone == null
    ? null
    : typeof data.customer_phone === 'string'
      ? data.customer_phone.trim()
      : null;
  const discountRate = data.discount_rate === undefined ? 0 : parseRate(data.discount_rate);
  if (!branchId
    || (data.customer_id != null && !customerId)
    || (data.customer_phone != null
      && (customerPhone === null || !customerPhone || customerPhone.length > 30))
    || (customerId !== null && customerPhone !== null)
    || discountRate === null || !Array.isArray(data.items)
    || !data.items.length || data.items.length > 500) return null;

  const items: SaleRequestItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of data.items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return null;
    const item = rawItem as Record<string, unknown>;
    const productId = positiveSqlInt(item.p_id);
    const quantity = positiveSqlInt(item.quantity);
    const unit = item.unit;
    if (!productId || !quantity || (unit !== 'item' && unit !== 'pack')) return null;
    const key = `${productId}:${unit}`;
    if (seen.has(key)) return null;
    seen.add(key);
    items.push({ p_id: productId, quantity, unit });
  }
  return {
    bran_id: branchId,
    customer_id: customerId,
    customer_phone: customerPhone,
    discountBps: discountRate,
    items,
  };
};

// แปลงราคา DECIMAL เป็นจำนวนเต็มสตางค์ เพื่อเลี่ยง floating-point error
const toCents = (value: string | number | null): number | null => {
  if (value === null) return null;
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
};

// ปัดเศษอัตราส่วนเป็นสตางค์ โดยทำเลขคณิตด้วย BigInt
const roundRatio = (amount: number, numerator: number, denominator: number): number => {
  const amountBigInt = BigInt(amount);
  const denominatorBigInt = BigInt(denominator);
  return Number(
    (amountBigInt * BigInt(numerator) + denominatorBigInt / 2n) / denominatorBigInt
  );
};

// แปลงสตางค์กลับเป็นรูปแบบทศนิยม 2 ตำแหน่งสำหรับ MySQL และ API
const formatAmount = (cents: number): string => (cents / 100).toFixed(2);

// ยืนยัน role และขอบเขตบริษัท/สาขาจาก JWT ก่อนทำรายการ
const resolveSaleScope = (req: Request, branchId: number) => {
  const userId = positiveInt(req.user?.user_id);
  const role = req.user?.user_role;
  const isSuperuser = role === 'superuser';
  const companyId = positiveInt(req.user?.company_id);
  const assignedBranchId = positiveInt(req.user?.bran_id);
  if (!userId || !role || !SALE_ROLES.has(role)) return null;
  if (!isSuperuser && !companyId) return null;
  if (BRANCH_ROLES.has(role)) {
    if (!assignedBranchId || assignedBranchId !== branchId) return null;
  }
  return { userId, companyId, branchId, isSuperuser };
};

// อ่านรหัส error ของ mysql2 อย่างปลอดภัยจาก unknown
const mysqlErrorCode = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
};

// ตรวจ deadlock ได้ทั้งจากรหัส MySQL และ errno
const isDeadlock = (error: unknown): boolean =>
  mysqlErrorCode(error) === 'ER_LOCK_DEADLOCK'
  || (typeof error === 'object' && error !== null && 'errno' in error && error.errno === 1213);

// แปลง response ที่บันทึกไว้จาก JSON และตรวจโครงสร้างก่อน replay
const parseStoredSale = (value: string | object | null): Record<string, unknown> => {
  const sale = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!sale || typeof sale !== 'object' || Array.isArray(sale)
    || !('sale_id' in sale) || !('items' in sale) || !Array.isArray(sale.items)) {
    throw new Error('Stored idempotent sale response is invalid');
  }
  return sale as Record<string, unknown>;
};

// Idempotency-Key รองรับ ASCII ที่พิมพ์ได้ ความยาว 1-128 ตัวอักษร
const validateIdempotencyKey = (value: string | undefined): string | null | false => {
  if (value === undefined) return null;
  return value.length > 0 && value.length <= 128 && /^[\x21-\x7e]+$/.test(value)
    ? value
    : false;
};

const loadSaleReceipt = async (saleId: number, req: Request) => {
  const userId = positiveInt(req.user?.user_id);
  const role = req.user?.user_role;
  const isSuperuser = role === 'superuser';
  const companyId = positiveInt(req.user?.company_id) ?? 0;
  const branchId = positiveInt(req.user?.bran_id) ?? 0;
  if (!userId || !role || !SALE_ROLES.has(role) || (!isSuperuser && !companyId)
    || (BRANCH_ROLES.has(role) && !branchId)) return null;

  const [saleRows] = await connect.promise().query<SaleReceiptHeaderRow[]>(
    `SELECT s.sale_id, s.company_id, s.bran_id, s.subtotal, s.discount_amount, s.vat_rate, s.vat_amount,
            s.total_amount, s.created_at, c.company_name, b.bran_name,
            customer.customer_name, customer.phone_number AS customer_phone
     FROM sales s
     INNER JOIN branc b ON b.bran_id = s.bran_id
     INNER JOIN company c ON c.company_id = s.company_id
     LEFT JOIN customers customer
       ON customer.customer_id = s.customer_id AND customer.company_id = s.company_id
     WHERE s.sale_id = ? AND (? = 1 OR s.company_id = ?)
       AND (? = 0 OR s.bran_id = ?)
     LIMIT 1`,
    [saleId, isSuperuser ? 1 : 0, companyId, BRANCH_ROLES.has(role) ? 1 : 0, branchId]
  );
  const sale = saleRows[0];
  if (!sale) return null;

  const [items] = await connect.promise().query<SaleReceiptItemRow[]>(
    `SELECT si.p_id, p.p_name, si.sale_unit, si.quantity, si.price_per_unit,
            si.total_item_amount + si.vat_amount AS line_total
     FROM sale_items si
     LEFT JOIN product p ON p.p_id = si.p_id
     WHERE si.sale_id = ?
     ORDER BY si.item_id`,
    [saleId]
  );

  return {
    companyId: sale.company_id,
    branchId: sale.bran_id,
    companyName: sale.company_name,
    branchName: sale.bran_name,
    customerName: sale.customer_name,
    customerPhone: sale.customer_phone,
    saleId: sale.sale_id,
    createdAt: sale.created_at,
    subtotal: sale.subtotal,
    discountAmount: sale.discount_amount,
    vatRate: sale.vat_rate,
    vatAmount: sale.vat_amount,
    totalAmount: sale.total_amount,
    items: items.map((item) => ({
      name: item.p_name ?? `Product ${item.p_id}`,
      quantity: item.quantity,
      unit: item.sale_unit,
      pricePerUnit: item.price_per_unit,
      lineTotal: item.line_total,
    })),
  };
};

const printSaleReceipt = async (saleId: number, req: Request) => {
  const receipt = await loadSaleReceipt(saleId, req);
  if (!receipt) throw new Error('Sale receipt is unavailable for this user');
  const printerConfig = await getBranchPrinterSettings(receipt.branchId);
  await sendEscPosReceipt(buildEscPosReceipt(receipt), printerConfig ?? undefined);
};

// ค้นหาบิลเดิมจาก user + key; hash ทำให้ใช้ key เดิมกับ payload ต่างกันไม่ได้
const findIdempotentSale = async (
  connection: DbConnection,
  userId: number,
  idempotencyKey: string,
  idempotencyHash: string,
  currentRead = false
) => {
  const [rows] = await connection.query(
    `SELECT idempotency_hash, idempotency_response
     FROM sales
     WHERE user_id = ? AND idempotency_key = ?
     LIMIT 1${currentRead ? ' FOR SHARE' : ''}`,
    [userId, idempotencyKey]
  ) as [Array<RowDataPacket & {
    idempotency_hash: string;
    idempotency_response: string | object | null;
  }>, unknown];
  const existing = rows[0];
  if (!existing) return null;
  if (existing.idempotency_hash !== idempotencyHash) throw new SaleError('idempotency_conflict');
  return parseStoredSale(existing.idempotency_response);
};

// เริ่ม transaction ใหม่เมื่อ deadlock โดยลองซ้ำได้สูงสุด 2 ครั้งหลังครั้งแรก
const runSaleTransaction = async (
  input: SaleInput,
  req: Request,
  idempotencyKey: string | null,
  idempotencyHash: string
) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction((connection) =>
        createSaleInTransaction(connection, input, req, idempotencyKey, idempotencyHash)
      );
    } catch (error) {
      if (!isDeadlock(error) || attempt >= 2) throw error;
    }
  }
};

// ประมวลผลการขายทั้งหมดใน transaction เดียว เพื่อให้บิล รายการ และสต็อก commit/rollback พร้อมกัน
const createSaleInTransaction = async (
  connection: DbConnection,
  input: SaleInput,
  req: Request,
  idempotencyKey: string | null,
  idempotencyHash: string
) => {

  const scope = resolveSaleScope(req, input.bran_id);
  if (!scope) throw new SaleError('scope');

  // ตรวจ key ก่อนทำงาน และตรวจซ้ำภายหลังล็อกสต็อกเพื่อรองรับคำขอพร้อมกัน
  if (idempotencyKey) {
    const existing = await findIdempotentSale(
      connection,
      scope.userId,
      idempotencyKey,
      idempotencyHash
    );
    if (existing) return { data: existing, replayed: true as const };
  }

  const [branchRows] = await connection.query(
    `SELECT b.bran_id, b.company_id
     FROM branc b
     INNER JOIN company c ON c.company_id = b.company_id
     WHERE b.bran_id = ? AND c.c_status = 'active'
       AND (? = 1 OR b.company_id = ?)`,
    [input.bran_id, scope.isSuperuser ? 1 : 0, scope.companyId]
  ) as [Array<RowDataPacket & { bran_id: number; company_id: number }>, unknown];
  const branch = branchRows[0];
  if (!branch) throw new SaleError('branch');

  let customer: { customer_id: number; customer_name: string; phone_number: string } | null = null;
  if (input.customer_id !== null || input.customer_phone !== null) {
    const customerFilter = input.customer_id !== null
      ? 'customer_id = ?'
      : 'phone_number = ?';
    const customerValue = input.customer_id ?? input.customer_phone;
    const [customerRows] = await connection.query(
      `SELECT customer_id, customer_name, phone_number
       FROM customers
       WHERE company_id = ? AND status = 'active' AND ${customerFilter}
       LIMIT 1
       FOR UPDATE`,
      [branch.company_id, customerValue]
    ) as [Array<RowDataPacket & {
      customer_id: number;
      customer_name: string;
      phone_number: string;
    }>, unknown];
    customer = customerRows[0] ?? null;
    if (!customer) throw new SaleError('customer');
  }

  // อ่านสินค้าและราคาปัจจุบัน พร้อมล็อกเฉพาะแถวสต็อก (s) ไม่ล็อกข้อมูลสินค้า/ราคา
  const ids = [...new Set(input.items.map(({ p_id }) => p_id))];
  const placeholders = ids.map(() => '?').join(', ');
  const [products] = await connection.query(
    `SELECT p.p_id, p.bran_id, p.items_per_pack, s.stock_id, s.stock_amount,
            price.sale_price_items, price.sale_price_pack
     FROM product p
     LEFT JOIN p_stock s ON s.p_id = p.p_id AND s.deleted_at IS NULL
     LEFT JOIN p_price price ON price.p_id = p.p_id
       AND price.deleted_at IS NULL
       AND price.price_id = (
         SELECT MAX(latest.price_id)
         FROM p_price latest
         WHERE latest.p_id = p.p_id AND latest.deleted_at IS NULL
       )
     WHERE p.bran_id = ? AND p.deleted_at IS NULL
       AND p.p_id IN (${placeholders})
     ORDER BY p.p_id
     FOR UPDATE OF s`,
    [input.bran_id, ...ids]
  ) as [SaleProductRow[], unknown];
  if (idempotencyKey) {
    const existing = await findIdempotentSale(
      connection,
      scope.userId,
      idempotencyKey,
      idempotencyHash,
      true
    );
    if (existing) return { data: existing, replayed: true as const };
  }

  const productById = new Map<number, SaleProductRow>();
  for (const product of products) {
    const productId = Number(product.p_id);
    if (productById.has(productId)) throw new SaleError('stock_data', productId);
    productById.set(productId, product);
  }
  if (productById.size !== ids.length) throw new SaleError('product');

  // คำนวณจำนวนสต็อกเป็นชิ้นย่อยเสมอ: pack = quantity × items_per_pack
  const prepared: PreparedItem[] = [];
  for (const item of input.items) {
    const product = productById.get(item.p_id);
    if (!product) throw new SaleError('product');
    const packSize = positiveSqlInt(product.items_per_pack);
    const availableStock = product.stock_amount === null ? null : Number(product.stock_amount);
    const stockQuantity = item.quantity * (item.unit === 'pack' ? packSize ?? 0 : 1);
    const priceCents = toCents(item.unit === 'pack' ? product.sale_price_pack : product.sale_price_items);
    if (!packSize || availableStock === null || !Number.isSafeInteger(availableStock)
      || availableStock < 0 || !Number.isSafeInteger(stockQuantity) || stockQuantity > MAX_SQL_INT
      || priceCents === null) {
      throw new SaleError('price_or_stock');
    }
    const lineSubtotalCents = priceCents * item.quantity;
    if (!Number.isSafeInteger(lineSubtotalCents)
      || lineSubtotalCents > MAX_DECIMAL_12_2_CENTS
      || priceCents > MAX_DECIMAL_12_2_CENTS) {
      throw new SaleError('amount');
    }
    prepared.push({ ...item, stockQuantity, priceCents, lineSubtotalCents, discountCents: 0, taxableCents: 0, vatCents: 0 });
  }

  // รวมการขาย item และ pack ของ p_id เดียวกันก่อนตรวจยอดสต็อก
  const requiredStock = new Map<number, number>();
  for (const item of prepared) {
    requiredStock.set(item.p_id, (requiredStock.get(item.p_id) ?? 0) + item.stockQuantity);
  }
  for (const [productId, quantity] of requiredStock) {
    const availableStock = Number(productById.get(productId)?.stock_amount);
    if (availableStock < quantity) throw new SaleError('stock', productId);
  }

  const subtotalCents = prepared.reduce((sum, item) => sum + item.lineSubtotalCents, 0);
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0
    || subtotalCents > MAX_DECIMAL_12_2_CENTS) {
    throw new SaleError('amount');
  }

  // โหลดภาษี default ของบริษัท; VAT ใช้ basis points และ NO_TAX คือ 0%
  const discountCents = roundRatio(subtotalCents, input.discountBps, 10_000);
  const [taxRows] = await connection.query(
    `SELECT tax_rate, tax_type
     FROM tax
     WHERE company_id = ? AND status = 1 AND deleted_at IS NULL AND is_default = 1
     ORDER BY tax_id DESC
     LIMIT 1`,
    [branch.company_id]
  ) as [SaleTaxRow[], unknown];
  const tax = taxRows[0];
  if (!tax) throw new SaleError('tax');
  const parsedVatBps = tax.tax_type === 'VAT'
    ? parseRate(tax.tax_rate)
    : tax.tax_type === 'NO_TAX' ? 0 : null;
  if (parsedVatBps === null) throw new SaleError('tax');
  const vatBps: number = parsedVatBps;

  // กระจายส่วนลดตามสัดส่วนของแต่ละรายการ ให้ยอดรวมส่วนลดตรงกับหัวบิลทุกสตางค์
  const itemDiscounts = allocateDiscountCents(
    prepared.map((item) => item.lineSubtotalCents),
    discountCents,
    subtotalCents
  );
  if (itemDiscounts.reduce((sum, amount) => sum + amount, 0) !== discountCents) {
    throw new SaleError('amount');
  }
  prepared.forEach((item, index) => {
    item.discountCents = itemDiscounts[index] ?? 0;
  });
  prepared.forEach((item) => {
    item.taxableCents = item.lineSubtotalCents - item.discountCents;
    item.vatCents = roundRatio(item.taxableCents, vatBps, 10_000);
  });
  const taxableCents = subtotalCents - discountCents;
  const vatCents = prepared.reduce((sum, item) => sum + item.vatCents, 0);
  const totalCents = taxableCents + vatCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_DECIMAL_12_2_CENTS
    || vatCents > MAX_DECIMAL_12_2_CENTS
    || prepared.some((item) =>
      item.discountCents > MAX_DECIMAL_12_2_CENTS
      || item.taxableCents > MAX_DECIMAL_12_2_CENTS
      || item.vatCents > MAX_DECIMAL_10_2_CENTS
    )) {
    throw new SaleError('amount');
  }

  // สร้างหัวบิลก่อน แล้วอัปเดตสต็อกและบันทึก stock movement ภายใน transaction เดียวกัน
  const [saleResult] = await connection.query(
    `INSERT INTO sales
       (company_id, bran_id, user_id, customer_id, subtotal, discount_rate, discount_amount,
        taxable_amount, vat_rate, vat_amount, total_amount, idempotency_key, idempotency_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      branch.company_id,
      input.bran_id,
      scope.userId,
      customer?.customer_id ?? null,
      formatAmount(subtotalCents),
      (input.discountBps / 100).toFixed(2),
      formatAmount(discountCents),
      formatAmount(taxableCents),
      (vatBps / 100).toFixed(2),
      formatAmount(vatCents),
      formatAmount(totalCents),
      idempotencyKey,
      idempotencyKey ? idempotencyHash : null,
    ]
  ) as [ResultSetHeader, unknown];

  for (const [productId, quantity] of requiredStock) {
    const product = productById.get(productId);
    if (!product || product.stock_amount === null) throw new SaleError('stock_data');
    const stockBefore = Number(product.stock_amount);
    const [stockUpdate] = await connection.query(
      `UPDATE p_stock
       SET stock_amount = stock_amount - ?, user_id = ?
       WHERE p_id = ? AND deleted_at IS NULL AND stock_amount >= ?`,
      [quantity, scope.userId, productId, quantity]
    ) as [ResultSetHeader, unknown];
    if (stockUpdate.affectedRows !== 1) throw new SaleError('stock_conflict', productId);

    await connection.query(
      `INSERT INTO stock_movements
         (sale_id, p_id, user_id, quantity_change, stock_before, stock_after)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [saleResult.insertId, productId, scope.userId, -quantity, stockBefore, stockBefore - quantity]
    );
  }

  // บันทึกรายการย่อย; total_item_amount ใน schema เก็บยอด taxable หลังหักส่วนลด ไม่รวม VAT
  for (const item of prepared) {
    await connection.query(
      `INSERT INTO sale_items
         (sale_id, p_id, sale_unit, quantity, stock_quantity, price_per_unit,
          line_discount_amount, total_item_amount, vat_amount, vat_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleResult.insertId,
        item.p_id,
        item.unit,
        item.quantity,
        item.stockQuantity,
        formatAmount(item.priceCents),
        formatAmount(item.discountCents),
        formatAmount(item.taxableCents),
        formatAmount(item.vatCents),
        (vatBps / 100).toFixed(2),
      ]
    );
  }

  let pointsEarned = 0;
  let pointsBalance: number | null = null;
  if (customer) {
    const [programRows] = await connection.query(
      `SELECT earn_amount, earn_points, minimum_purchase
       FROM loyalty_programs
       WHERE company_id = ? AND is_active = 1
       LIMIT 1`,
      [branch.company_id]
    ) as [Array<RowDataPacket & {
      earn_amount: string | number;
      earn_points: number;
      minimum_purchase: string | number;
    }>, unknown];
    const program = programRows[0];
    if (program) {
      const calculatedPoints = calculateLoyaltyPoints(
        taxableCents,
        program.earn_amount,
        Number(program.earn_points),
        program.minimum_purchase
      );
      if (calculatedPoints === null) throw new SaleError('loyalty_config');
      pointsEarned = calculatedPoints;
      if (pointsEarned > 0) {
        await connection.query(
          `INSERT INTO loyalty_transactions
             (company_id, customer_id, bran_id, user_id, transaction_type, points_change,
              purchase_amount, reference_type, reference_id, idempotency_key, note)
           VALUES (?, ?, ?, ?, 'earn', ?, ?, 'sale', ?, ?, ?)`,
          [
            branch.company_id,
            customer.customer_id,
            input.bran_id,
            scope.userId,
            pointsEarned,
            formatAmount(taxableCents),
            saleResult.insertId,
            `sale:${saleResult.insertId}`,
            `Points earned from sale #${saleResult.insertId}`,
          ]
        );
      }
    }

    const [balanceRows] = await connection.query(
      `SELECT COALESCE(SUM(points_change), 0) AS points_balance
       FROM loyalty_transactions
       WHERE company_id = ? AND customer_id = ?
         AND (? IS NULL OR bran_id = ?)`,
      [branch.company_id, customer.customer_id, scope.branchId, scope.branchId]
    ) as [Array<RowDataPacket & { points_balance: number | string }>, unknown];
    pointsBalance = Number(balanceRows[0]?.points_balance ?? 0);
  }

  // เก็บ response ไว้ใช้ตอบคำขอ retry ด้วย Idempotency-Key เดิม
  const data = {
    sale_id: saleResult.insertId,
    branch_id: input.bran_id,
    customer_id: customer?.customer_id ?? null,
    customer_name: customer?.customer_name ?? null,
    customer_phone: customer?.phone_number ?? null,
    points_earned: pointsEarned,
    points_balance: pointsBalance,
    subtotal: formatAmount(subtotalCents),
    discount_rate: (input.discountBps / 100).toFixed(2),
    discount_amount: formatAmount(discountCents),
    taxable_amount: formatAmount(taxableCents),
    vat_rate: (vatBps / 100).toFixed(2),
    vat_amount: formatAmount(vatCents),
    total_amount: formatAmount(totalCents),
    items: prepared.map((item) => ({
      p_id: item.p_id,
      unit: item.unit,
      quantity: item.quantity,
      stock_quantity: item.stockQuantity,
      price_per_unit: formatAmount(item.priceCents),
      subtotal: formatAmount(item.lineSubtotalCents),
      discount_amount: formatAmount(item.discountCents),
      taxable_amount: formatAmount(item.taxableCents),
      vat_rate: (vatBps / 100).toFixed(2),
      vat_amount: formatAmount(item.vatCents),
      total_amount: formatAmount(item.taxableCents + item.vatCents),
    })),
  };
  if (idempotencyKey) {
    await connection.query(
      'UPDATE sales SET idempotency_response = ? WHERE sale_id = ?',
      [JSON.stringify(data), saleResult.insertId]
    );
  }
  return { data, replayed: false as const };
};

// HTTP handler สำหรับตรวจ input, จัดการ idempotency และแปลงข้อผิดพลาดภายในเป็น HTTP response
export const createSale = async (req: Request, res: Response) => {
  const input = parseSaleInput(req.body);
  if (!input) {
    return res.status(400).json({
      resultCode: 400,
      message: 'bran_id, valid discount_rate (0-100), non-empty unique items, and at most one valid customer_id or customer_phone are required',
    });
  }

  const idempotencyKey = validateIdempotencyKey(req.get('Idempotency-Key'));
  if (idempotencyKey === false) {
    return res.status(400).json({ resultCode: 400, message: 'Idempotency-Key must be 1-128 printable ASCII characters' });
  }
  const hashInput = input.customer_id === null && input.customer_phone === null
    ? { bran_id: input.bran_id, discountBps: input.discountBps, items: input.items }
    : input;
  const idempotencyHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');

  try {
    const result = await runSaleTransaction(input, req, idempotencyKey, idempotencyHash);
    let receiptPrintStatus: 'sent' | 'not_configured' | 'failed' | 'not_reprinted' = 'not_reprinted';
    if (!result.replayed) {
      try {
        await printSaleReceipt(Number(result.data.sale_id), req);
        receiptPrintStatus = 'sent';
      } catch (error) {
        console.error('Print sale receipt error:', error);
        receiptPrintStatus = error instanceof ReceiptPrinterError && error.code === 'not_configured'
          ? 'not_configured'
          : 'failed';
      }
    }
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return res.status(201).json({
      resultCode: 201,
      message: serviceMessage.OPERATION_SUCESS,
      data: result.data,
      receipt_print: { status: receiptPrintStatus },
    });
  } catch (error) {
    if (error instanceof SaleError) {
      if (error.code === 'scope') return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
      if (error.code === 'branch') return res.status(404).json({ resultCode: 404, message: serviceMessage.BRANCH_OUTSIDE_COMPANY });
      if (error.code === 'customer') return res.status(404).json({ resultCode: 404, message: 'Active customer was not found in this company' });
      if (error.code === 'loyalty_config') return res.status(409).json({ resultCode: 409, message: 'The active loyalty program has invalid or unsupported point settings' });
      if (error.code === 'product') return res.status(400).json({ resultCode: 400, message: 'Every product must belong to the selected branch' });
      if (error.code === 'stock' || error.code === 'stock_conflict') {
        return res.status(409).json({ resultCode: 409, message: `Insufficient stock for product ${error.p_id}` });
      }
      if (error.code === 'stock_data') {
        return res.status(409).json({
          resultCode: 409,
          message: `Duplicate stock records found for product ${error.p_id}`,
        });
      }
      if (error.code === 'tax') return res.status(409).json({ resultCode: 409, message: 'A valid active default tax configuration is required' });
      if (error.code === 'price_or_stock') {
        return res.status(409).json({ resultCode: 409, message: 'Every product needs a valid price and stock record' });
      }
      if (error.code === 'idempotency_conflict') {
        return res.status(409).json({ resultCode: 409, message: 'Idempotency-Key was already used with a different sale request' });
      }
      return res.status(400).json({ resultCode: 400, message: 'Sale amount is outside the supported range' });
    }

    if (mysqlErrorCode(error) === 'ER_DUP_ENTRY' && idempotencyKey) {
      try {
        const userId = positiveInt(req.user?.user_id);
        if (userId) {
          const [rows] = await connect.promise().query<Array<RowDataPacket & {
            idempotency_hash: string;
            idempotency_response: string | object | null;
          }>>(
            `SELECT idempotency_hash, idempotency_response
             FROM sales WHERE user_id = ? AND idempotency_key = ? LIMIT 1`,
            [userId, idempotencyKey]
          );
          const existing = rows[0];
          if (existing) {
            if (existing.idempotency_hash !== idempotencyHash) {
              return res.status(409).json({ resultCode: 409, message: 'Idempotency-Key was already used with a different sale request' });
            }
            res.setHeader('Idempotency-Replayed', 'true');
            return res.status(201).json({
              resultCode: 201,
              message: serviceMessage.OPERATION_SUCESS,
              data: parseStoredSale(existing.idempotency_response),
            });
          }
        }
      } catch (replayError) {
        console.error('Read idempotent sale error:', replayError);
        return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
      }
    }
    console.error('Create sale error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

export const reprintSaleReceipt = async (req: Request, res: Response) => {
  const saleId = positiveSqlInt(req.params.sale_id);
  if (!saleId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const receipt = await loadSaleReceipt(saleId, req);
    if (!receipt) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    const printerConfig = await getBranchPrinterSettings(receipt.branchId);
    await sendEscPosReceipt(buildEscPosReceipt(receipt), printerConfig ?? undefined);
    return res.status(200).json({ resultCode: 200, message: 'Receipt sent to printer' });
  } catch (error) {
    console.error('Reprint sale receipt error:', error);
    if (error instanceof ReceiptPrinterError) {
      const status = error.code === 'connection_failed' ? 502 : 503;
      const message = error.code === 'not_configured'
        ? 'Printer is not configured'
        : error.code === 'invalid_config'
          ? 'Printer configuration is invalid'
          : 'Could not connect to printer; the sale is saved and can be reprinted later';
      return res.status(status).json({ resultCode: status, message });
    }
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

// อ่านบิลโดยจำกัดสิทธิ์ตามบริษัท/สาขา; LEFT JOIN คงรายการขายแม้ข้อมูลสินค้าถูกลบภายหลัง
export const getSaleById = async (req: Request, res: Response) => {
  const saleId = positiveInt(req.params.sale_id);
  if (!saleId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  const userId = positiveInt(req.user?.user_id);
  const companyId = positiveInt(req.user?.company_id);
  const branchId = positiveInt(req.user?.bran_id);
  const role = req.user?.user_role;
  const isSuperuser = role === 'superuser';
  if (!userId || !role || !SALE_ROLES.has(role) || (!isSuperuser && !companyId)
    || (BRANCH_ROLES.has(role) && !branchId)) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  }

  try {
    const [saleRows] = await connect.promise().query<SaleHeaderRow[]>(
        `SELECT s.sale_id, s.company_id, s.bran_id, s.user_id, s.customer_id,
                customer.customer_name, customer.phone_number AS customer_phone,
                COALESCE((
                  SELECT SUM(lt.points_change)
                  FROM loyalty_transactions lt
                  WHERE lt.company_id = s.company_id
                    AND lt.customer_id = s.customer_id
                    AND lt.reference_type = 'sale'
                    AND lt.reference_id = s.sale_id
                    AND lt.transaction_type = 'earn'
                ), 0) AS points_earned,
                COALESCE((
                  SELECT SUM(balance.points_change)
                  FROM loyalty_transactions balance
                  WHERE balance.company_id = s.company_id
                    AND balance.customer_id = s.customer_id
                    AND (? = 0 OR balance.bran_id = ?)
                ), 0) AS points_balance,
                s.subtotal, s.discount_rate, s.discount_amount, s.taxable_amount,
                s.vat_rate, s.vat_amount, s.total_amount, s.created_at
         FROM sales s
         LEFT JOIN customers customer
           ON customer.customer_id = s.customer_id AND customer.company_id = s.company_id
         WHERE s.sale_id = ? AND (? = 1 OR s.company_id = ?)
           AND (? = 0 OR s.bran_id = ?)
         LIMIT 1`,
        [
          BRANCH_ROLES.has(role) ? 1 : 0,
          branchId,
          saleId,
          isSuperuser ? 1 : 0,
          companyId,
          BRANCH_ROLES.has(role) ? 1 : 0,
          branchId,
        ]
      );
    const sale = saleRows[0];
    if (!sale) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });

    const [items] = await connect.promise().query<SaleItemRow[]>(
        `SELECT si.item_id, si.p_id, p.p_name, p.p_code, si.sale_unit, si.quantity,
                si.stock_quantity, si.price_per_unit, si.line_discount_amount,
                si.total_item_amount, si.total_item_amount AS taxable_amount,
                si.total_item_amount + si.vat_amount AS total_amount,
                si.vat_amount, si.vat_rate
         FROM sale_items si
         LEFT JOIN product p ON p.p_id = si.p_id
         WHERE si.sale_id = ?
         ORDER BY si.item_id`,
        [saleId]
      );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: { ...sale, items } });
  } catch (error) {
    console.error('Get sale error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};
 
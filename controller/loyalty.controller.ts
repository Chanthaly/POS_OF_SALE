import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { withTransaction } from '../dbconfig/configdb.js';
import { positiveInt } from '../utils/numberHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type LoyaltyConnection = PoolConnection;
type LoyaltyScope = {
  companyId: number;
  branchId: number | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const bodyOf = (req: Request): Record<string, unknown> =>
  isObject(req.body) ? req.body : {};

const scopeOf = (req: Request, body = bodyOf(req)): LoyaltyScope | null => {
  const isSuperuser = req.user?.user_role === 'superuser';
  const companyId = isSuperuser
    ? positiveInt(req.query.company_id) ?? positiveInt(body.company_id)
    : positiveInt(req.user?.company_id);
  const role = req.user?.user_role;
  const branchId = role === 'manager' || role === 'cashier' || role === 'staff'
    ? positiveInt(req.user?.bran_id)
    : null;

  if (!companyId
    || ((role === 'manager' || role === 'cashier' || role === 'staff') && !branchId)) {
    return null;
  }
  return { companyId, branchId };
};

const positiveDecimal = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text) || Number(text) <= 0) return null;
  return text;
};

const nonNegativeDecimal = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value);
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) return null;
  return text;
};

const positiveInt32 = (value: unknown): number | null => {
  const parsed = positiveInt(value);
  return parsed !== null && parsed <= 2147483647 ? parsed : null;
};

const boundedText = (value: unknown, maxLength: number, nullable = false): string | null | undefined => {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
};

const nullableText = (value: unknown, maxLength: number): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  return boundedText(value, maxLength);
};

const nullableDateTime = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return value.trim();
};

const validStatus = (value: unknown): value is 'active' | 'inactive' =>
  value === 'active' || value === 'inactive';

const badRequest = (res: Response, message = 'Invalid loyalty request data') =>
  res.status(400).json({ resultCode: 400, message });

const notFound = (res: Response) =>
  res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });

const noScope = (res: Response) =>
  res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });

const dbError = (res: Response, error: unknown, action: string) => {
  console.error(`${action} error:`, error);
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ resultCode: 409, message: 'A conflicting loyalty record already exists' });
  }
  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ resultCode: 409, message: 'The loyalty record is still referenced or has invalid related data' });
  }
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return badRequest(res, 'Loyalty data violates a database constraint');
  }
  return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
};

const parseId = (req: Request, param: string): number | null => positiveInt(req.params[param]);

const customerExists = async (connection: LoyaltyConnection, customerId: number, companyId: number) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT customer_id FROM customers WHERE customer_id = ? AND company_id = ?',
    [customerId, companyId]
  );
  return rows.length > 0;
};

const branchExists = async (connection: LoyaltyConnection, branchId: number, companyId: number) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT bran_id FROM branc WHERE bran_id = ? AND company_id = ?',
    [branchId, companyId]
  );
  return rows.length > 0;
};

const userExists = async (connection: LoyaltyConnection, userId: number, companyId: number) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT user_id FROM users WHERE user_id = ? AND company_id = ?',
    [userId, companyId]
  );
  return rows.length > 0;
};

const productExists = async (connection: LoyaltyConnection, productId: number, companyId: number) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT p.p_id
     FROM product p
     INNER JOIN branc b ON b.bran_id = p.bran_id
     WHERE p.p_id = ? AND b.company_id = ?`,
    [productId, companyId]
  );
  return rows.length > 0;
};

const parseTransaction = (data: Record<string, unknown>) => {
  const customerId = positiveInt(data.customer_id);
  const branchId = data.bran_id == null ? null : positiveInt(data.bran_id);
  const userId = data.user_id == null ? null : positiveInt(data.user_id);
  const type = data.transaction_type;
  const points = typeof data.points_change === 'number' || typeof data.points_change === 'string'
    ? Number(data.points_change)
    : Number.NaN;
  const purchaseAmount = data.purchase_amount == null
    ? null
    : nonNegativeDecimal(data.purchase_amount);
  const referenceType = nullableText(data.reference_type, 30);
  const referenceId = data.reference_id == null ? null : positiveInt(data.reference_id);
  const idempotencyKey = nullableText(data.idempotency_key, 100);
  const note = nullableText(data.note, 500);
  const allowedTypes = ['earn', 'redeem', 'adjustment', 'expiry', 'reversal'];
  const validDirection = type === 'earn' ? points > 0
    : type === 'redeem' || type === 'expiry' ? points < 0
      : type === 'adjustment' || type === 'reversal' ? points !== 0
        : false;

  if (!customerId || (data.bran_id != null && !branchId)
    || (data.user_id != null && !userId) || !allowedTypes.includes(String(type))
    || !Number.isSafeInteger(points) || points < -2147483648 || points > 2147483647 || !validDirection
    || (data.purchase_amount != null && purchaseAmount === null)
    || referenceType === undefined || (data.reference_id != null && !referenceId)
    || idempotencyKey === undefined || note === undefined) return null;

  return {
    customerId,
    branchId,
    userId,
    type,
    points,
    purchaseAmount,
    referenceType,
    referenceId,
    idempotencyKey,
    note,
  };
};

const parseRedemption = (data: Record<string, unknown>) => {
  const customerId = positiveInt(data.customer_id);
  const rewardId = positiveInt(data.reward_id);
  const transactionId = positiveInt(data.points_transaction_id);
  const quantity = positiveInt32(data.quantity);
  const pointsSpent = positiveInt32(data.points_spent);
  const redemptionCode = nullableText(data.redemption_code, 64);
  const status = data.status;
  const fulfilledAt = nullableDateTime(data.fulfilled_at);
  const cancelledAt = nullableDateTime(data.cancelled_at);

  if (!customerId || !rewardId || !transactionId || !quantity || !pointsSpent
    || redemptionCode === undefined
    || !['issued', 'fulfilled', 'cancelled'].includes(String(status))
    || fulfilledAt === undefined || cancelledAt === undefined) return null;

  return { customerId, rewardId, transactionId, quantity, pointsSpent, redemptionCode, status, fulfilledAt, cancelledAt };
};

const parseActiveFlag = (value: unknown): 0 | 1 | null => {
  if (value === 0 || value === '0' || value === false) return 0;
  if (value === 1 || value === '1' || value === true) return 1;
  return null;
};

const relationIsValid = async (
  connection: LoyaltyConnection,
  companyId: number,
  customerId: number,
  rewardId: number,
  transactionId: number,
  branchId: number | null
) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT r.reward_id
     FROM loyalty_rewards r
     INNER JOIN loyalty_transactions t
       ON t.company_id = r.company_id
      AND t.transaction_id = ?
      AND t.customer_id = ?
      AND (? IS NULL OR t.bran_id = ?)
      AND t.transaction_type = 'redeem' AND t.points_change < 0
     WHERE r.reward_id = ? AND r.company_id = ?`,
    [transactionId, customerId, branchId, branchId, rewardId, companyId]
  );
  return rows.length > 0;
};

export const getCustomers = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  if (!scope) return noScope(res);
  const customerId = req.params.customer_id ? parseId(req, 'customer_id') : null;
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (req.params.customer_id && !customerId) return badRequest(res, 'Invalid customer_id');
  try {
    const params: (number | string | null)[] = [
      scope.branchId,
      scope.branchId,
      scope.companyId,
      customerId,
      customerId,
    ];
    const searchCondition = search
      ? ' AND (customer_name LIKE ? OR phone_number LIKE ? OR email LIKE ?)'
      : '';
    if (search) {
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }
    const [rows] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<RowDataPacket[]>(
        `SELECT customer_id, company_id, customer_name, phone_number, email, status, created_at, updated_at,
                COALESCE((
                  SELECT SUM(lt.points_change)
                  FROM loyalty_transactions lt
                  WHERE lt.customer_id = customers.customer_id
                    AND lt.company_id = customers.company_id
                    AND (? IS NULL OR lt.bran_id = ?)
                ), 0) AS points_balance
         FROM customers WHERE company_id = ? AND (? IS NULL OR customer_id = ?)
         ${searchCondition}
         ORDER BY customer_id DESC`,
        params
      )
    );
    if ((customerId || search) && !rows.length) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (error) {
    return dbError(res, error, 'Get loyalty customers');
  }
};

export const createCustomer = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req, body);
  const name = boundedText(body.customer_name, 150);
  const phone = boundedText(body.phone_number, 30);
  const email = nullableText(body.email, 254);
  const status = body.status === undefined ? 'active' : body.status;
  if (!scope) return noScope(res);
  if (!name || !phone || email === undefined || !validStatus(status)) return badRequest(res);
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        'INSERT INTO customers (company_id, customer_name, phone_number, email, status) VALUES (?, ?, ?, ?, ?)',
        [scope.companyId, name, phone, email, status]
      )
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, customer_id: result.insertId });
  } catch (error) {
    return dbError(res, error, 'Create loyalty customer');
  }
};

export const updateCustomer = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const customerId = parseId(req, 'customer_id');
  const body = bodyOf(req);
  const name = boundedText(body.customer_name, 150);
  const phone = boundedText(body.phone_number, 30);
  const email = nullableText(body.email, 254);
  const status = body.status;
  if (!scope) return noScope(res);
  if (!customerId) return badRequest(res, 'Invalid customer_id');
  if (!name || !phone || email === undefined || !validStatus(status)) return badRequest(res);
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `UPDATE customers SET customer_name = ?, phone_number = ?, email = ?, status = ?
         WHERE customer_id = ? AND company_id = ?`,
        [name, phone, email, status, customerId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Update loyalty customer');
  }
};

export const deleteCustomer = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const customerId = parseId(req, 'customer_id');
  if (!scope) return noScope(res);
  if (!customerId) return badRequest(res, 'Invalid customer_id');
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        'DELETE FROM customers WHERE customer_id = ? AND company_id = ?',
        [customerId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Delete loyalty customer');
  }
};

export const getLoyaltyPrograms = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  if (!scope) return noScope(res);
  try {
    const [rows] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<RowDataPacket[]>(
        `SELECT program_id, company_id, earn_amount, earn_points, minimum_purchase, is_active, created_at, updated_at
         FROM loyalty_programs WHERE company_id = ?`,
        [scope.companyId]
      )
    );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows[0] ?? null });
  } catch (error) {
    return dbError(res, error, 'Get loyalty program');
  }
};

export const createLoyaltyProgram = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req, body);
  const earnAmount = positiveDecimal(body.earn_amount ?? '10000.00');
  const earnPoints = positiveInt32(body.earn_points ?? 1);
  const minimumPurchase = nonNegativeDecimal(body.minimum_purchase ?? '0.00');
  const isActive = parseActiveFlag(body.is_active ?? 0);
  if (!scope) return noScope(res);
  if (!earnAmount || !earnPoints || !minimumPurchase || isActive === null) {
    return badRequest(res);
  }
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `INSERT INTO loyalty_programs (company_id, earn_amount, earn_points, minimum_purchase, is_active)
         VALUES (?, ?, ?, ?, ?)`,
        [scope.companyId, earnAmount, earnPoints, minimumPurchase, isActive]
      )
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, program_id: result.insertId });
  } catch (error) {
    return dbError(res, error, 'Create loyalty program');
  }
};

export const updateLoyaltyProgram = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req);
  const programId = parseId(req, 'program_id');
  const earnAmount = positiveDecimal(body.earn_amount);
  const earnPoints = positiveInt32(body.earn_points);
  const minimumPurchase = nonNegativeDecimal(body.minimum_purchase);
  const isActive = parseActiveFlag(body.is_active);
  if (!scope) return noScope(res);
  if (!programId) return badRequest(res, 'Invalid program_id');
  if (!earnAmount || !earnPoints || !minimumPurchase || isActive === null) {
    return badRequest(res);
  }
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `UPDATE loyalty_programs
         SET earn_amount = ?, earn_points = ?, minimum_purchase = ?, is_active = ?
         WHERE program_id = ? AND company_id = ?`,
        [earnAmount, earnPoints, minimumPurchase, isActive, programId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Update loyalty program');
  }
};

export const deleteLoyaltyProgram = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const programId = parseId(req, 'program_id');
  if (!scope) return noScope(res);
  if (!programId) return badRequest(res, 'Invalid program_id');
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        'DELETE FROM loyalty_programs WHERE program_id = ? AND company_id = ?',
        [programId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Delete loyalty program');
  }
};

export const getLoyaltyRewards = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  if (!scope) return noScope(res);
  const rewardId = req.params.reward_id ? parseId(req, 'reward_id') : null;
  if (req.params.reward_id && !rewardId) return badRequest(res, 'Invalid reward_id');
  try {
    const [rows] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<RowDataPacket[]>(
        `SELECT reward_id, company_id, product_id, reward_name, reward_type, points_cost,
                discount_amount, stock_quantity, status, created_at, updated_at
         FROM loyalty_rewards
         WHERE company_id = ? AND (? IS NULL OR reward_id = ?)
         ORDER BY reward_id DESC`,
        [scope.companyId, rewardId, rewardId]
      )
    );
    if (rewardId && !rows.length) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (error) {
    return dbError(res, error, 'Get loyalty rewards');
  }
};

export const createLoyaltyReward = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req, body);
  const productId = body.product_id === null ? null : positiveInt(body.product_id);
  const name = boundedText(body.reward_name, 150);
  const rewardType = body.reward_type;
  const pointsCost = positiveInt32(body.points_cost);
  const discountAmount = body.discount_amount === null ? null : positiveDecimal(body.discount_amount);
  const stockQuantity = body.stock_quantity === null ? null : body.stock_quantity === undefined
    ? null
    : positiveInt32(body.stock_quantity) ?? (body.stock_quantity === 0 || body.stock_quantity === '0' ? 0 : undefined);
  const status = body.status === undefined ? 'active' : body.status;
  if (!scope) return noScope(res);
  if (!name || !pointsCost || !validStatus(status)
    || (body.product_id !== null && body.product_id !== undefined && !productId)
    || (body.discount_amount !== null && body.discount_amount !== undefined && !discountAmount)
    || stockQuantity === undefined
    || !(
      (rewardType === 'discount' && discountAmount !== null && discountAmount !== undefined && productId === null)
      || (rewardType === 'product' && discountAmount === null && productId !== null)
    )) return badRequest(res);
  try {
    const result = await withTransaction(async (connection: LoyaltyConnection) => {
      if (productId && !(await productExists(connection, productId, scope.companyId))) {
        return { invalid: true as const };
      }
      const [insert] = await connection.query<ResultSetHeader>(
        `INSERT INTO loyalty_rewards
           (company_id, product_id, reward_name, reward_type, points_cost, discount_amount, stock_quantity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [scope.companyId, productId, name, rewardType, pointsCost, discountAmount, stockQuantity, status]
      );
      return { insert };
    });
    if ('invalid' in result) return badRequest(res, 'Product must belong to the selected company');
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, reward_id: result.insert.insertId });
  } catch (error) {
    return dbError(res, error, 'Create loyalty reward');
  }
};

export const updateLoyaltyReward = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req);
  const rewardId = parseId(req, 'reward_id');
  const productId = body.product_id === null ? null : positiveInt(body.product_id);
  const name = boundedText(body.reward_name, 150);
  const rewardType = body.reward_type;
  const pointsCost = positiveInt32(body.points_cost);
  const discountAmount = body.discount_amount === null ? null : positiveDecimal(body.discount_amount);
  const stockQuantity = body.stock_quantity === null
    ? null
    : positiveInt32(body.stock_quantity) ?? (body.stock_quantity === 0 || body.stock_quantity === '0' ? 0 : undefined);
  const status = body.status;
  if (!scope) return noScope(res);
  if (!rewardId) return badRequest(res, 'Invalid reward_id');
  if (!name || !pointsCost || !validStatus(status)
    || (body.product_id !== null && !productId)
    || (body.discount_amount !== null && !discountAmount)
    || stockQuantity === undefined
    || !(
      (rewardType === 'discount' && discountAmount !== null && productId === null)
      || (rewardType === 'product' && discountAmount === null && productId !== null)
    )) return badRequest(res);
  try {
    if (productId && !(await withTransaction((connection: LoyaltyConnection) => productExists(connection, productId, scope.companyId)))) {
      return badRequest(res, 'Product must belong to the selected company');
    }
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `UPDATE loyalty_rewards
         SET product_id = ?, reward_name = ?, reward_type = ?, points_cost = ?, discount_amount = ?,
             stock_quantity = ?, status = ?
         WHERE reward_id = ? AND company_id = ?`,
        [productId, name, rewardType, pointsCost, discountAmount, stockQuantity, status, rewardId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Update loyalty reward');
  }
};

export const deleteLoyaltyReward = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const rewardId = parseId(req, 'reward_id');
  if (!scope) return noScope(res);
  if (!rewardId) return badRequest(res, 'Invalid reward_id');
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        'DELETE FROM loyalty_rewards WHERE reward_id = ? AND company_id = ?',
        [rewardId, scope.companyId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Delete loyalty reward');
  }
};

export const getLoyaltyTransactions = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  if (!scope) return noScope(res);
  const transactionId = req.params.transaction_id ? parseId(req, 'transaction_id') : null;
  if (req.params.transaction_id && !transactionId) return badRequest(res, 'Invalid transaction_id');
  try {
    const [rows] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<RowDataPacket[]>(
        `SELECT transaction_id, company_id, customer_id, bran_id, user_id, transaction_type,
                points_change, purchase_amount, reference_type, reference_id, idempotency_key, note, created_at
         FROM loyalty_transactions
         WHERE company_id = ? AND (? IS NULL OR transaction_id = ?)
           AND (? IS NULL OR bran_id = ?)
         ORDER BY transaction_id DESC`,
        [scope.companyId, transactionId, transactionId, scope.branchId, scope.branchId]
      )
    );
    if (transactionId && !rows.length) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (error) {
    return dbError(res, error, 'Get loyalty transactions');
  }
};

export const createLoyaltyTransaction = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req, body);
  const userId = positiveInt(req.user?.user_id);
  const data = parseTransaction({ ...body, user_id: userId });
  if (!scope) return noScope(res);
  if (!data || !userId) return badRequest(res);
  if (scope.branchId && data.branchId !== scope.branchId) return noScope(res);
  try {
    const [result] = await withTransaction(async (connection: LoyaltyConnection) => {
      if (!(await customerExists(connection, data.customerId, scope.companyId))) {
        return { invalid: 'customer' as const };
      }
      if (data.branchId && !(await branchExists(connection, data.branchId, scope.companyId))) {
        return { invalid: 'branch' as const };
      }
      const [insert] = await connection.query<ResultSetHeader>(
        `INSERT INTO loyalty_transactions
           (company_id, customer_id, bran_id, user_id, transaction_type, points_change, purchase_amount,
            reference_type, reference_id, idempotency_key, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [scope.companyId, data.customerId, data.branchId, userId, data.type, data.points,
          data.purchaseAmount, data.referenceType, data.referenceId, data.idempotencyKey, data.note]
      );
      return { result: insert };
    });
    if ('invalid' in result) return badRequest(res, `Invalid ${result.invalid} for this company`);
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, transaction_id: result.result.insertId });
  } catch (error) {
    return dbError(res, error, 'Create loyalty transaction');
  }
};

export const updateLoyaltyTransaction = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req);
  const transactionId = parseId(req, 'transaction_id');
  const data = parseTransaction(body);
  if (!scope) return noScope(res);
  if (!transactionId) return badRequest(res, 'Invalid transaction_id');
  if (!data) return badRequest(res);
  if (scope.branchId && data.branchId !== scope.branchId) return noScope(res);
  try {
    const result = await withTransaction(async (connection: LoyaltyConnection) => {
      if (!(await customerExists(connection, data.customerId, scope.companyId))
        || (data.branchId && !(await branchExists(connection, data.branchId, scope.companyId)))
        || (data.userId && !(await userExists(connection, data.userId, scope.companyId)))) {
        return { invalid: true as const };
      }
      const [update] = await connection.query<ResultSetHeader>(
        `UPDATE loyalty_transactions
         SET customer_id = ?, bran_id = ?, user_id = ?, transaction_type = ?, points_change = ?, purchase_amount = ?,
             reference_type = ?, reference_id = ?, idempotency_key = ?, note = ?
         WHERE transaction_id = ? AND company_id = ? AND (? IS NULL OR bran_id = ?)`,
        [data.customerId, data.branchId, data.userId, data.type, data.points, data.purchaseAmount, data.referenceType,
          data.referenceId, data.idempotencyKey, data.note, transactionId, scope.companyId,
          scope.branchId, scope.branchId]
      );
      return { update };
    });
    if ('invalid' in result) return badRequest(res, 'Customer or branch does not belong to this company');
    if (!result.update.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Update loyalty transaction');
  }
};

export const deleteLoyaltyTransaction = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const transactionId = parseId(req, 'transaction_id');
  if (!scope) return noScope(res);
  if (!transactionId) return badRequest(res, 'Invalid transaction_id');
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `DELETE FROM loyalty_transactions
         WHERE transaction_id = ? AND company_id = ? AND (? IS NULL OR bran_id = ?)`,
        [transactionId, scope.companyId, scope.branchId, scope.branchId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Delete loyalty transaction');
  }
};

export const getLoyaltyRedemptions = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  if (!scope) return noScope(res);
  const redemptionId = req.params.redemption_id ? parseId(req, 'redemption_id') : null;
  if (req.params.redemption_id && !redemptionId) return badRequest(res, 'Invalid redemption_id');
  try {
    const [rows] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<RowDataPacket[]>(
        `SELECT redemption_id, company_id, customer_id, reward_id, points_transaction_id, quantity,
                points_spent, redemption_code, status, created_at, fulfilled_at, cancelled_at
         FROM loyalty_redemptions lr
         WHERE company_id = ? AND (? IS NULL OR redemption_id = ?)
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM loyalty_transactions t
             WHERE t.transaction_id = lr.points_transaction_id AND t.bran_id = ?
           ))
         ORDER BY redemption_id DESC`,
        [scope.companyId, redemptionId, redemptionId, scope.branchId, scope.branchId]
      )
    );
    if (redemptionId && !rows.length) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (error) {
    return dbError(res, error, 'Get loyalty redemptions');
  }
};

export const createLoyaltyRedemption = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req, body);
  const data = parseRedemption(body);
  if (!scope) return noScope(res);
  if (!data) return badRequest(res);
  try {
    const [result] = await withTransaction(async (connection: LoyaltyConnection) => {
      const valid = await relationIsValid(
        connection, scope.companyId, data.customerId, data.rewardId, data.transactionId, scope.branchId
      );
      if (!valid) return { invalid: true as const };
      const [insert] = await connection.query<ResultSetHeader>(
        `INSERT INTO loyalty_redemptions
           (company_id, customer_id, reward_id, points_transaction_id, quantity, points_spent,
            redemption_code, status, fulfilled_at, cancelled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [scope.companyId, data.customerId, data.rewardId, data.transactionId, data.quantity,
          data.pointsSpent, data.redemptionCode, data.status, data.fulfilledAt, data.cancelledAt]
      );
      return { result: insert };
    });
    if ('invalid' in result) return badRequest(res, 'Customer, reward and points transaction must belong together in this company');
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, redemption_id: result.result.insertId });
  } catch (error) {
    return dbError(res, error, 'Create loyalty redemption');
  }
};

export const updateLoyaltyRedemption = async (req: Request, res: Response) => {
  const body = bodyOf(req);
  const scope = scopeOf(req);
  const redemptionId = parseId(req, 'redemption_id');
  const data = parseRedemption(body);
  if (!scope) return noScope(res);
  if (!redemptionId) return badRequest(res, 'Invalid redemption_id');
  if (!data) return badRequest(res);
  try {
    const result = await withTransaction(async (connection: LoyaltyConnection) => {
      if (!(await relationIsValid(
        connection, scope.companyId, data.customerId, data.rewardId, data.transactionId, scope.branchId
      ))) return { invalid: true as const };
      const [update] = await connection.query<ResultSetHeader>(
        `UPDATE loyalty_redemptions
         SET customer_id = ?, reward_id = ?, points_transaction_id = ?, quantity = ?, points_spent = ?,
             redemption_code = ?, status = ?, fulfilled_at = ?, cancelled_at = ?
         WHERE redemption_id = ? AND company_id = ?`,
        [data.customerId, data.rewardId, data.transactionId, data.quantity, data.pointsSpent,
          data.redemptionCode, data.status, data.fulfilledAt, data.cancelledAt, redemptionId, scope.companyId]
      );
      return { update };
    });
    if ('invalid' in result) return badRequest(res, 'Customer, reward and points transaction must belong together in this company');
    if (!result.update.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Update loyalty redemption');
  }
};

export const deleteLoyaltyRedemption = async (req: Request, res: Response) => {
  const scope = scopeOf(req);
  const redemptionId = parseId(req, 'redemption_id');
  if (!scope) return noScope(res);
  if (!redemptionId) return badRequest(res, 'Invalid redemption_id');
  try {
    const [result] = await withTransaction((connection: LoyaltyConnection) =>
      connection.query<ResultSetHeader>(
        `DELETE FROM loyalty_redemptions
         WHERE redemption_id = ? AND company_id = ?
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM loyalty_transactions t
             WHERE t.transaction_id = loyalty_redemptions.points_transaction_id AND t.bran_id = ?
           ))`,
        [redemptionId, scope.companyId, scope.branchId, scope.branchId]
      )
    );
    if (!result.affectedRows) return notFound(res);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (error) {
    return dbError(res, error, 'Delete loyalty redemption');
  }
};

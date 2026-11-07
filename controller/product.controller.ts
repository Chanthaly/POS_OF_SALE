import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { positiveInt } from '../utils/numberHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type Product = RowDataPacket & {
  p_id: number;
  p_name: string;
  p_code: string;
  p_img: string | null;
  created_at: string;
  bran_id: number;
  pty_id: number;
  items_per_pack: number;
  product_size_id: number | null;
  size_value: number | string | null;
  size_unit: string | null;
  product_size: string | null;
  stock_full_packs: number;
  stock_remaining_items: number;
  countsum: number | string;
  countsum_pack: number | string;
};

const branchScope = (req: Request, requestedBranchId?: unknown) => {
  const isSuperuser = req.user?.user_role === 'superuser';
  const isBranchManager = req.user?.user_role === 'manager';
  const branchId = isSuperuser || isBranchManager ? positiveInt(isSuperuser ? requestedBranchId : req.user?.bran_id) : null;
  const companyId = positiveInt(req.user?.company_id);
  if (!isSuperuser && !companyId) return null;
  if (isSuperuser && requestedBranchId !== undefined && !branchId) return null;
  return { branchId, companyId, isSuperuser };
};

const isValidDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export const getProducts = async (req: Request, res: Response) => {
  try {
    const scope = branchScope(req, req.query.bran_id);
    if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.INVALID_BRANCH_SCOPE });
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    if ((startDate !== undefined && !isValidDateOnly(startDate))
      || (endDate !== undefined && !isValidDateOnly(endDate))
      || (typeof startDate === 'string' && typeof endDate === 'string' && startDate > endDate)) {
      return res.status(400).json({ resultCode: 400, message: serviceMessage.INVALID_PRODUCT_DATE_RANGE });
    }
    const params: (string | number)[] = [];
    let sql = `SELECT p.p_id, p.p_name, p.p_code, p.p_img, pt.Ptype_name, pst.stock_amount,
      p.items_per_pack,
      p.product_size_id, ps.size_value, ps.size_unit,
      CONCAT(ps.size_value, ' ', ps.size_unit) AS product_size,
      FLOOR(COALESCE(pst.stock_amount, 0) / p.items_per_pack) AS stock_full_packs,
      MOD(COALESCE(pst.stock_amount, 0), p.items_per_pack) AS stock_remaining_items,
      pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
      COALESCE(pst.stock_amount, 0) * COALESCE(pr.cost_price_item, 0) AS countsum,
      FLOOR(COALESCE(pst.stock_amount, 0) / p.items_per_pack) * COALESCE(pr.cost_price_pack, 0)
        + MOD(COALESCE(pst.stock_amount, 0), p.items_per_pack) * COALESCE(pr.cost_price_item, 0) AS countsum_pack,
      p.created_at, b.bran_name
      FROM product p
      INNER JOIN branc b ON b.bran_id = p.bran_id
      LEFT JOIN p_type pt ON pt.Ptype_id = p.pty_id AND pt.deleted_at IS NULL
      LEFT JOIN product_size ps ON ps.product_size_id = p.product_size_id
      LEFT JOIN p_stock pst ON pst.p_id = p.p_id AND pst.deleted_at IS NULL
      LEFT JOIN p_price pr ON pr.p_id = p.p_id
        AND pr.deleted_at IS NULL
        AND pr.price_id = (
          SELECT MAX(latest_pr.price_id)
          FROM p_price latest_pr
          WHERE latest_pr.p_id = p.p_id AND latest_pr.deleted_at IS NULL
        )`
    const conditions: string[] = ['p.deleted_at IS NULL'];
    if (!scope.isSuperuser) {
      conditions.push('b.company_id = ?');
      params.push(scope.companyId!);
      if (scope.branchId) {
        conditions.push('p.bran_id = ?');
        params.push(scope.branchId);
      }
    } else if (scope.branchId) {
      conditions.push('p.bran_id = ?');
      params.push(scope.branchId);
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      conditions.push('(p.p_name LIKE ? OR p.p_code LIKE ?)');
      const searchPattern = `${search}%`;
      params.push(searchPattern, searchPattern);
    }
    if (typeof startDate === 'string') {
      conditions.push('p.created_at >= ?');
      params.push(startDate);
    }
    if (typeof endDate === 'string') {
      conditions.push('p.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
      params.push(endDate);
    }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY p.p_id DESC';
    const [rows] = await WaitTransition.promise().query<Product[]>(sql, params);
    if (search && !rows.length) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND, data: [] });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    console.error('Get products error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
   }
};

export const getProductById = async (req: Request, res: Response) => {
  const productId = positiveInt(req.params.p_id);
  if (!productId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  try {
    const scope = branchScope(req);
    if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
    const params: (string | number)[] = [productId];
     let sql = `SELECT p.p_id, p.p_name, p.p_code, p.p_img, pt.Ptype_name, pst.stock_amount,
       p.items_per_pack,
       p.product_size_id, ps.size_value, ps.size_unit,
       CONCAT(ps.size_value, ' ', ps.size_unit) AS product_size,
       FLOOR(COALESCE(pst.stock_amount, 0) / p.items_per_pack) AS stock_full_packs,
       MOD(COALESCE(pst.stock_amount, 0), p.items_per_pack) AS stock_remaining_items,
       pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
       COALESCE(pst.stock_amount, 0) * COALESCE(pr.cost_price_item, 0) AS countsum,
       FLOOR(COALESCE(pst.stock_amount, 0) / p.items_per_pack) * COALESCE(pr.cost_price_pack, 0)
         + MOD(COALESCE(pst.stock_amount, 0), p.items_per_pack) * COALESCE(pr.cost_price_item, 0) AS countsum_pack,
       p.created_at, b.bran_name
       FROM product p
      INNER JOIN branc b ON b.bran_id = p.bran_id
       LEFT JOIN p_type pt ON pt.Ptype_id = p.pty_id AND pt.deleted_at IS NULL
       LEFT JOIN product_size ps ON ps.product_size_id = p.product_size_id
        LEFT JOIN p_stock pst ON pst.p_id = p.p_id AND pst.deleted_at IS NULL
       LEFT JOIN p_price pr ON pr.p_id = p.p_id
         AND pr.deleted_at IS NULL
         AND pr.price_id = (
           SELECT MAX(latest_pr.price_id)
           FROM p_price latest_pr
           WHERE latest_pr.p_id = p.p_id AND latest_pr.deleted_at IS NULL
         )
       WHERE p.p_id = ? AND p.deleted_at IS NULL`;
    if (!scope.isSuperuser) {
      sql += ' AND b.company_id = ?';
      params.push(scope.companyId!);
      if (scope.branchId) {
        sql += '         AND p.bran_id = ?';
          params.push(scope.branchId);
      }
    }
    const [rows] = await WaitTransition.promise().query<Product[]>(sql, params);
    if (!rows.length) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows[0] });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addProduct = async (req: Request, res: Response) => {
  const {
    p_name,
    p_code,
    p_img,
    created_at,
    bran_id: bodyBranchId,
    pty_id,
    Ptype_id: bodyProductTypeId,
    productTypeId: requestProductTypeId,
    items_per_pack: bodyItemsPerPack,
    product_size_id: bodyProductSizeId,
  } = req.body as Omit<Partial<Product>, 'items_per_pack' | 'product_size_id'> & {
    Ptype_id?: unknown;
    productTypeId?: unknown;
    items_per_pack?: unknown;
    product_size_id?: unknown;
  };
  const scope = branchScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  const targetBranchId = scope.isSuperuser ? positiveInt(bodyBranchId) : positiveInt(req.user?.bran_id);
  const productTypeId = positiveInt(pty_id ?? bodyProductTypeId ?? requestProductTypeId);
  const itemsPerPack = bodyItemsPerPack === undefined ? 24 : positiveInt(bodyItemsPerPack);
  const productSizeId = bodyProductSizeId == null || bodyProductSizeId === '' ? null : positiveInt(bodyProductSizeId);
  if (!targetBranchId) {
    
    return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_BRANCH_NOT_ASSIGNED });
  }
  if (!p_name?.trim() || !p_code?.trim() || !productTypeId || !itemsPerPack
    || (bodyProductSizeId != null && bodyProductSizeId !== '' && !productSizeId)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.PRODUCT_FIELDS_REQUIRED });
  }
  try {
    const [branch] = await WaitTransition.promise().query<RowDataPacket[]>(
      'SELECT bran_id FROM branc WHERE bran_id = ? AND (? IS NULL OR company_id = ?)',
      [targetBranchId, scope.companyId, scope.companyId]
    );
    if (!branch.length) return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCH_OUTSIDE_COMPANY });
    if (productSizeId) {
      const [sizes] = await WaitTransition.promise().query<RowDataPacket[]>(
        'SELECT product_size_id FROM product_size WHERE product_size_id = ?',
        [productSizeId]
      );
      if (!sizes.length) return res.status(400).json({ resultCode: 400, message: serviceMessage.PRODUCT_SIZE_ID_NOT_FOUND });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'INSERT INTO product (p_name, p_code, p_img, created_at, bran_id, pty_id, items_per_pack, product_size_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p_name.trim(), p_code.trim(), p_img ?? null, created_at ?? new Date(), targetBranchId, productTypeId, itemsPerPack, productSizeId]
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, p_id: result.insertId });
  } catch (err) {
    console.error('Add product error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  const productId = positiveInt(req.params.p_id);
  const {
    p_name,
    p_code,
    p_img,
    pty_id,
    bran_id: bodyBranchId,
    items_per_pack: bodyItemsPerPack,
    product_size_id: bodyProductSizeId,
  } = req.body as Omit<Partial<Product>, 'items_per_pack' | 'product_size_id'> & {
    items_per_pack?: unknown;
    product_size_id?: unknown;
  };
  const scope = branchScope(req);
  const targetBranchId = scope?.isSuperuser ? positiveInt(bodyBranchId) : (scope?.branchId ?? positiveInt(bodyBranchId));
  const productTypeId = positiveInt(pty_id);
  const itemsPerPack = bodyItemsPerPack === undefined ? null : positiveInt(bodyItemsPerPack);
  const productSizeId = bodyProductSizeId == null || bodyProductSizeId === '' ? null : positiveInt(bodyProductSizeId);
  if (!productId || !p_name?.trim() || !p_code?.trim() || !productTypeId || !scope || !targetBranchId
    || (bodyItemsPerPack !== undefined && !itemsPerPack)
    || (bodyProductSizeId != null && bodyProductSizeId !== '' && !productSizeId)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.DATA_NOT_EXIST });
  }
  try {
    const [targetBranch] = await WaitTransition.promise().query<RowDataPacket[]>(
      'SELECT bran_id FROM branc WHERE bran_id = ? AND company_id = ?',
      [targetBranchId, scope.companyId]
    );
    if (!targetBranch.length) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCH_OUTSIDE_COMPANY });
    }
    if (productSizeId) {
      const [sizes] = await WaitTransition.promise().query<RowDataPacket[]>(
        'SELECT product_size_id FROM product_size WHERE product_size_id = ?',
        [productSizeId]
      );
      if (!sizes.length) return res.status(400).json({ resultCode: 400, message: serviceMessage.PRODUCT_SIZE_ID_NOT_FOUND });
    }
    const params: (string | number | null)[] = [p_name.trim(), p_code.trim(), p_img ?? null, productTypeId, targetBranchId, itemsPerPack];
    let sql = 'UPDATE product SET p_name = ?, p_code = ?, p_img = ?, pty_id = ?, bran_id = ?, items_per_pack = COALESCE(?, items_per_pack)';
    if (bodyProductSizeId !== undefined) {
      sql += ', product_size_id = ?';
      params.push(productSizeId);
    }
    sql += ' WHERE p_id = ? AND deleted_at IS NULL';
    params.push(productId);
    if (!scope.isSuperuser && scope.companyId && req.user?.user_role === 'manager') {
      sql += ' AND bran_id IN (SELECT bran_id FROM branc WHERE company_id = ?)';
      params.push(scope.companyId);
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(sql, params);
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  const productId = positiveInt(req.params.p_id);
  const scope = branchScope(req);
  if (!productId || !scope) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  try {
    const params: number[] = [productId];
    let sql = 'UPDATE product SET deleted_at = CURRENT_TIMESTAMP WHERE p_id = ? AND deleted_at IS NULL';
    if (!scope.isSuperuser && scope.companyId && req.user?.user_role === 'manager') {
      sql += ' AND bran_id IN (SELECT bran_id FROM branc WHERE company_id = ?)';
      params.push(scope.companyId);
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(sql, params);
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};
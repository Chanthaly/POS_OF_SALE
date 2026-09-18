import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type Product = RowDataPacket & {
  p_id: number;
  p_name: string;
  p_code: string;
  p_img: string | null;
  created_at: string;
  bran_id: number;
  pty_id: number;
};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

export const getProducts = async (req: Request, res: Response) => {
  try {
    const scope = branchScope(req, req.query.bran_id);
    if (!scope) return res.status(403).json({ resultCode: 403, message: 'Invalid branch scope' });
    const params: (string | number)[] = [];
    let sql = `SELECT p.p_name, p.p_code, p.p_img, pt.Ptype_name, pst.stock_amount,
      pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
      p.created_at, b.bran_name
      FROM product p
      INNER JOIN branc b ON b.bran_id = p.bran_id
      LEFT JOIN p_type pt ON pt.p_id = p.p_id
      LEFT JOIN p_stock pst ON pst.p_id = p.p_id
      LEFT JOIN p_price pr ON pr.p_id = p.p_id`
    const conditions: string[] = [];
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
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      conditions.push('(p.p_name LIKE ? OR p.p_code LIKE ?)');
      const search = `${req.query.search.trim()}%`;
      params.push(search, search);
    }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY p.p_id DESC';
    const [rows] = await WaitTransition.promise().query<Product[]>(sql, params);
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
    if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
    const params: (string | number)[] = [productId];
     let sql = `SELECT p.p_name, p.p_code, p.p_img, pt.Ptype_name, pst.stock_amount,
      pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
      p.created_at, b.bran_name
      FROM product p
      INNER JOIN branc b ON b.bran_id = p.bran_id
      LEFT JOIN p_type pt ON pt.p_id = p.p_id
      LEFT JOIN p_stock pst ON pst.p_id = p.p_id
      LEFT JOIN p_price pr ON pr.p_id = p.p_id
      WHERE p.p_id = ?`;
    if (!scope.isSuperuser) {
      sql += ' AND b.company_id = ?';
      params.push(scope.companyId!);
      if (scope.branchId) {
        sql += ' AND p.bran_id = ?';        params.push(scope.branchId);
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
  } = req.body as Partial<Product> & { Ptype_id?: unknown; productTypeId?: unknown };
  const scope = branchScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  const targetBranchId = scope.isSuperuser || req.user?.user_role === 'admin' ? positiveInt(bodyBranchId) : scope.branchId;
  const productTypeId = positiveInt(pty_id ?? bodyProductTypeId ?? requestProductTypeId);
  if (!targetBranchId) {
    return res.status(403).json({ resultCode: 403, message: 'User branch is not assigned' });
  }
  console.log('Add product request:', { p_name, p_code, p_img, created_at,productTypeId });
  if (!p_name?.trim() || !p_code?.trim() || !productTypeId) {
    return res.status(400).json({ resultCode: 400, message: 'p_name, p_code and product type ID are required' });
  }
  try {
    const [branch] = await WaitTransition.promise().query<RowDataPacket[]>(
      'SELECT bran_id FROM branc WHERE bran_id = ? AND (? IS NULL OR company_id = ?)',
      [targetBranchId, scope.companyId, scope.companyId]
    );
    if (!branch.length) return res.status(403).json({ resultCode: 403, message: 'Branch is outside your company' });
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'INSERT INTO product (p_name, p_code, p_img, created_at, bran_id, pty_id) VALUES (?, ?, ?, ?, ?, ?)',
      [p_name.trim(), p_code.trim(), p_img ?? null, created_at ?? new Date(), targetBranchId, productTypeId]
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, p_id: result.insertId });
  } catch (err) {
    console.error('Add product error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  const productId = positiveInt(req.params.p_id);
  const { p_name, p_code, p_img, pty_id, bran_id: bodyBranchId } = req.body as Partial<Product>;
  const scope = branchScope(req);
  const targetBranchId = scope?.isSuperuser ? positiveInt(bodyBranchId) : (scope?.branchId ?? positiveInt(bodyBranchId));
  const productTypeId = positiveInt(pty_id);
  if (!productId || !p_name?.trim() || !p_code?.trim() || !productTypeId || !scope || !targetBranchId) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.DATA_NOT_EXIST });
  }
  try {
    const [targetBranch] = await WaitTransition.promise().query<RowDataPacket[]>(
      'SELECT bran_id FROM branc WHERE bran_id = ? AND company_id = ?',
      [targetBranchId, scope.companyId]
    );
    if (!targetBranch.length) {
      return res.status(403).json({ resultCode: 403, message: 'Branch is outside your company' });
    }
    const params: (string | number | null)[] = [p_name.trim(), p_code.trim(), p_img ?? null, productTypeId, targetBranchId, productId];
    let sql = 'UPDATE product SET p_name = ?, p_code = ?, p_img = ?, pty_id = ?, bran_id = ? WHERE p_id = ?';
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
    let sql = 'DELETE FROM product WHERE p_id = ?';
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
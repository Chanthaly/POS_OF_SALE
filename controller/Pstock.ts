import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type ProductStock = RowDataPacket & {
  stock_id: number;
  stock_amount: number;
  user_id: number;
  created_at: string;
  p_id: number;
  p_name: string;
  p_code: string;
  bran_id: number;
  bran_name: string;
  company_id: number;
};

type StockScope = {
  userId: number;
  branchId: number | null;
  companyId: number;
  isBranchManager: boolean;
};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const nonNegativeInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const tokenScope = (req: Request): StockScope | null => {
  const userId = positiveInt(req.user?.user_id);
  const branchId = positiveInt(req.user?.bran_id);
  const companyId = positiveInt(req.user?.company_id);
  const isBranchManager = req.user?.user_role === 'manager';
  if (!userId || !companyId || (isBranchManager && !branchId)) return null;
  return { userId, branchId: isBranchManager ? branchId : null, companyId, isBranchManager };
};

const productInScope = async (pId: number, scope: StockScope) => {
  const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
    `SELECT p.p_id
  FROM product p
  INNER JOIN branc b ON b.bran_id = p.bran_id
  WHERE p.p_id = ? AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
    [pId, scope.companyId, scope.branchId, scope.branchId]
  );
  return rows.length > 0;
};

export const getPstock = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });

  try {
    const [rows] = await WaitTransition.promise().query<ProductStock[]>(
      `SELECT s.stock_id, s.stock_amount, s.user_id, s.created_at,
              p.p_id, p.p_name, p.p_code, p.bran_id,
    b.bran_name, b.company_id
  FROM p_stock s
  INNER JOIN product p ON p.p_id = s.p_id
  INNER JOIN branc b ON b.bran_id = p.bran_id
  WHERE b.company_id = ? AND (? IS NULL OR p.bran_id = ?)
  ORDER BY s.stock_id DESC`,
      [scope.companyId, scope.branchId, scope.branchId]
    );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    console.error('Get stock error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addPstock = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const stockAmount = nonNegativeInt(req.body?.stock_amount);
  const productId = positiveInt(req.body?.p_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (stockAmount === null || !productId) {
    return res.status(400).json({ resultCode: 400, message: 'stock_amount and p_id are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'INSERT INTO p_stock (stock_amount, user_id, p_id) VALUES (?, ?, ?)',
      [stockAmount, scope.userId, productId]
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, stock_id: result.insertId });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ resultCode: 409, message: 'Stock for this product already exists' });
    }
    console.error('Add stock error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updatePstock = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const stockId = positiveInt(req.params.stock_id);
  const stockAmount = nonNegativeInt(req.body?.stock_amount);
  const productId = positiveInt(req.body?.p_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!stockId || stockAmount === null || !productId) {
    return res.status(400).json({ resultCode: 400, message: 'stock_id, stock_amount and p_id are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `UPDATE p_stock s
       INNER JOIN product p ON p.p_id = ?
       INNER JOIN branc b ON b.bran_id = p.bran_id
       SET s.stock_amount = ?, s.user_id = ?
       WHERE s.stock_id = ? AND s.p_id = p.p_id
        AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
      [productId, stockAmount, scope.userId, stockId, scope.companyId, scope.branchId, scope.branchId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Update stock error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deletePstock = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const stockId = positiveInt(req.params.stock_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!stockId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `DELETE s FROM p_stock s
       INNER JOIN product p ON p.p_id = s.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
      WHERE s.stock_id = ? AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
          [stockId, scope.companyId, scope.branchId, scope.branchId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Delete stock error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

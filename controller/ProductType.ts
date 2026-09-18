import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type ProductType = RowDataPacket & {
  Ptype_id: number;
  Ptype_name: string;
  p_id: number;
  created_at: string;
  update_at: string;
  p_name: string;
  p_code: string;
  bran_id: number;
  bran_name: string;
  company_id: number;
};

type ProductTypeScope = {
  branchId: number | null;
  companyId: number;
  isBranchManager: boolean;
};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const tokenScope = (req: Request): ProductTypeScope | null => {
  const branchId = positiveInt(req.user?.bran_id);
  const companyId = positiveInt(req.user?.company_id);
  const isBranchManager = req.user?.user_role === 'manager';
  if (!companyId || (isBranchManager && !branchId)) return null;
  return { branchId: isBranchManager ? branchId : null, companyId, isBranchManager };
};

const productInScope = async (pId: number, scope: ProductTypeScope) => {
  const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
    `SELECT p.p_id
     FROM product p
     INNER JOIN branc b ON b.bran_id = p.bran_id
    WHERE p.p_id = ? AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
      [pId, scope.companyId, scope.branchId, scope.branchId]
  );
  return rows.length > 0;
};

export const getProductTypes = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });

  try {
    const [rows] = await WaitTransition.promise().query<ProductType[]>(
      `SELECT pt.Ptype_id, pt.Ptype_name, pt.p_, pt.created_at, pt.update_at,
              p.p_name, p.p_code, p.bran_id, b.bran_name, b.company_id
       FROM p_type pt
       INNER JOIN product p ON p.p_id = pt.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
      WHERE b.company_id = ? AND (? IS NULL OR p.bran_id = ?)
       ORDER BY pt.Ptype_id DESC`,
      [scope.companyId, scope.branchId, scope.branchId]
    );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    console.error('Get product types error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addProductType = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const productTypeName = typeof req.body?.Ptype_name === 'string' ? req.body.Ptype_name.trim() : '';
  const productId = positiveInt(req.body?.p_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!productTypeName || productTypeName.length > 34 || !productId) {
    return res.status(400).json({ resultCode: 400, message: 'Ptype_name and p_id are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'INSERT INTO p_type (Ptype_name, p_id) VALUES (?, ?)',
      [productTypeName, productId]
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, Ptype_id: result.insertId });
  } catch (err) {
    console.error('Add product type error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateProductType = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const productTypeId = positiveInt(req.params.Ptype_id);
  const productTypeName = typeof req.body?.Ptype_name === 'string' ? req.body.Ptype_name.trim() : '';
  const productId = positiveInt(req.body?.p_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!productTypeId || !productTypeName || productTypeName.length > 34 || !productId) {
    return res.status(400).json({ resultCode: 400, message: 'Ptype_id, Ptype_name and p_id are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `UPDATE p_type pt
       INNER JOIN product p ON p.p_id = pt.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
       SET pt.Ptype_name = ?, pt.p_id = ?
      WHERE pt.Ptype_id = ? AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
          [productTypeName, productId, productTypeId, scope.companyId, scope.branchId, scope.branchId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Update product type error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deleteProductType = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const productTypeId = positiveInt(req.params.Ptype_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!productTypeId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `DELETE pt FROM p_type pt
       INNER JOIN product p ON p.p_id = pt.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
      WHERE pt.Ptype_id = ? AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
          [productTypeId, scope.companyId, scope.branchId, scope.branchId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Delete product type error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

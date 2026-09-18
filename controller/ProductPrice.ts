import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type ProductPrice = RowDataPacket & {
  price_id: number;
  p_id: number;
  cost_price_item: number;
  cost_price_pack: number;
  sale_price_pack: number;
  sale_price_items: number;
  created_at: string;
  p_name: string;
  p_code: string;
  bran_id: number;
  bran_name: string;
  company_id: number;
};

type ProductPriceScope = {
  branchId: number;
  companyId: number;
};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const priceValue = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed * 100) ? parsed : null;
};

const tokenScope = (req: Request): ProductPriceScope | null => {
  const branchId = positiveInt(req.user?.bran_id);
  const companyId = positiveInt(req.user?.company_id);
  if (!branchId || !companyId) return null;
  return { branchId, companyId };
};

const productInScope = async (pId: number, scope: ProductPriceScope) => {
  const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
    `SELECT p.p_id
     FROM product p
     INNER JOIN branc b ON b.bran_id = p.bran_id
     WHERE p.p_id = ? AND p.bran_id = ? AND b.company_id = ?`,
    [pId, scope.branchId, scope.companyId]
  );
  return rows.length > 0;
};

export const getProductPrices = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });

  try {
    const [rows] = await WaitTransition.promise().query<ProductPrice[]>(
            `SELECT pr.price_id, pr.p_id, pr.created_at,
              pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
              p.p_name, p.p_code, p.bran_id, b.bran_name, b.company_id
       FROM p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
       WHERE p.bran_id = ? AND b.company_id = ?
       ORDER BY pr.price_id DESC`,
      [scope.branchId, scope.companyId]
    );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    console.error('Get product prices error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addProductPrice = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const productId = positiveInt(req.body?.p_id);
  const costPriceItem = priceValue(req.body?.cost_price_item);
  const costPricePack = priceValue(req.body?.cost_price_pack);
  const salePricePack = priceValue(req.body?.sale_price_pack);
  const salePriceItems = priceValue(req.body?.sale_price_items);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!productId || costPriceItem === null || costPricePack === null || salePricePack === null || salePriceItems === null) {
    return res.status(400).json({ resultCode: 400, message: 'p_id and all price fields are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `INSERT INTO p_price
        (p_id, cost_price_item, cost_price_pack, sale_price_pack, sale_price_items)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, costPriceItem, costPricePack, salePricePack, salePriceItems]
    );
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, price_id: result.insertId });
  } catch (err) {
    console.error('Add product price error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateProductPrice = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const priceId = positiveInt(req.params.price_id);
  const productId = positiveInt(req.body?.p_id);
  const costPriceItem = priceValue(req.body?.cost_price_item);
  const costPricePack = priceValue(req.body?.cost_price_pack);
  const salePricePack = priceValue(req.body?.sale_price_pack);
  const salePriceItems = priceValue(req.body?.sale_price_items);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!priceId || !productId || costPriceItem === null || costPricePack === null || salePricePack === null || salePriceItems === null) {
    return res.status(400).json({ resultCode: 400, message: 'price_id, p_id and all price fields are required' });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: 'Product is outside your branch' });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `UPDATE p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
         SET pr.p_id = ?, pr.cost_price_item = ?, pr.cost_price_pack = ?,
           pr.sale_price_pack = ?, pr.sale_price_items = ?
       WHERE pr.price_id = ? AND p.bran_id = ? AND b.company_id = ?`,
        [productId, costPriceItem, costPricePack, salePricePack, salePriceItems, priceId, scope.branchId, scope.companyId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Update product price error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deleteProductPrice = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  const priceId = positiveInt(req.params.price_id);
  if (!scope) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });
  if (!priceId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `DELETE pr FROM p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id
       INNER JOIN branc b ON b.bran_id = p.bran_id
       WHERE pr.price_id = ? AND p.bran_id = ? AND b.company_id = ?`,
      [priceId, scope.branchId, scope.companyId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Delete product price error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

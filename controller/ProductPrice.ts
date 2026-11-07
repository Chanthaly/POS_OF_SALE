import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { positiveInt } from '../utils/numberHelper.js';
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
  branchId: number | null;
  companyId: number;
  isBranchManager: boolean;
};

const priceValue = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed * 100) ? parsed : null;
};

const tokenScope = (req: Request): ProductPriceScope | null => {
  const branchId = positiveInt(req.user?.bran_id);
  const companyId = positiveInt(req.user?.company_id);
  const isBranchManager = req.user?.user_role === 'manager';
  if (!companyId || (isBranchManager && !branchId)) return null;
  return { branchId: isBranchManager ? branchId : null, companyId, isBranchManager };
};

const productInScope = async (pId: number, scope: ProductPriceScope) => {
  const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
    `SELECT p.p_id
     FROM product p
     INNER JOIN branc b ON b.bran_id = p.bran_id
    WHERE p.p_id = ? AND p.deleted_at IS NULL AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
      [pId, scope.companyId, scope.branchId, scope.branchId]
  );
  return rows.length > 0;
};

export const getProductPrices = async (req: Request, res: Response) => {
  const scope = tokenScope(req);
  if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });

  try {
    const [rows] = await WaitTransition.promise().query<ProductPrice[]>(
            `SELECT pr.price_id, pr.p_id, pr.created_at,
              pr.cost_price_item, pr.cost_price_pack, pr.sale_price_pack, pr.sale_price_items,
              p.p_name, p.p_code, p.bran_id, b.bran_name, b.company_id
       FROM p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id AND p.deleted_at IS NULL
       INNER JOIN branc b ON b.bran_id = p.bran_id
      WHERE pr.deleted_at IS NULL AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)
       ORDER BY pr.price_id DESC`,
      [scope.companyId, scope.branchId, scope.branchId]
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
  if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  if (!productId || costPriceItem === null || costPricePack === null || salePricePack === null || salePriceItems === null) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.PRICE_CREATE_FIELDS_REQUIRED });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.PRODUCT_OUTSIDE_BRANCH });
    }
    const result = await withTransaction(async (connection) => {
      const [existingPrices] = await connection.query(
        'SELECT price_id FROM p_price WHERE p_id = ? AND deleted_at IS NULL ORDER BY price_id DESC LIMIT 1 FOR UPDATE',
        [productId]
      ) as [Array<RowDataPacket & { price_id: number }>];
      if (existingPrices[0]) {
        const priceId = existingPrices[0].price_id;
        await connection.query(
          `UPDATE p_price
           SET cost_price_item = ?, cost_price_pack = ?, sale_price_pack = ?, sale_price_items = ?
           WHERE price_id = ?`,
          [costPriceItem, costPricePack, salePricePack, salePriceItems, priceId]
        );
        return { priceId, created: false };
      }
      const [inserted] = await connection.query(
        `INSERT INTO p_price
          (p_id, cost_price_item, cost_price_pack, sale_price_pack, sale_price_items)
         VALUES (?, ?, ?, ?, ?)`,
        [productId, costPriceItem, costPricePack, salePricePack, salePriceItems]
      ) as [ResultSetHeader];
      return { priceId: inserted.insertId, created: true };
    });
    return res.status(result.created ? 201 : 200).json({
      resultCode: result.created ? 201 : 200,
      message: serviceMessage.OPERATION_SUCESS,
      price_id: result.priceId
    });
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
  if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  if (!priceId || !productId || costPriceItem === null || costPricePack === null || salePricePack === null || salePriceItems === null) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.PRICE_UPDATE_FIELDS_REQUIRED });
  }

  try {
    if (!(await productInScope(productId, scope))) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.PRODUCT_OUTSIDE_BRANCH });
    }
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `UPDATE p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id AND p.deleted_at IS NULL
       INNER JOIN branc b ON b.bran_id = p.bran_id
         SET pr.p_id = ?, pr.cost_price_item = ?, pr.cost_price_pack = ?,
           pr.sale_price_pack = ?, pr.sale_price_items = ?
      WHERE pr.price_id = ? AND pr.deleted_at IS NULL
        AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)` ,
       [productId, costPriceItem, costPricePack, salePricePack, salePriceItems, priceId, scope.companyId, scope.branchId, scope.branchId]
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
  if (!scope) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  if (!priceId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      `UPDATE p_price pr
       INNER JOIN product p ON p.p_id = pr.p_id AND p.deleted_at IS NULL
       INNER JOIN branc b ON b.bran_id = p.bran_id
       SET pr.deleted_at = CURRENT_TIMESTAMP
      WHERE pr.price_id = ? AND pr.deleted_at IS NULL
        AND b.company_id = ? AND (? IS NULL OR p.bran_id = ?)`,
          [priceId, scope.companyId, scope.branchId, scope.branchId]
    );
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Delete product price error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

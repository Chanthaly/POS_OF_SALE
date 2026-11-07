import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { positiveInt } from '../utils/numberHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type ProductSize = RowDataPacket & {
  product_size_id: number;
  size_value: number | string;
  size_unit: 'ml' | 'l' | 'mm';
};

const sizeUnits = new Set(['ml', 'l', 'mm']);

const parseSizeValue = (value: unknown): number | null => {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 9999999.999 && Number.isInteger(parsed * 1000)
    ? parsed
    : null;
};

const errorCode = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
};

export const getProductSizes = async (_req: Request, res: Response) => {
  try {
    const [rows] = await WaitTransition.promise().query<ProductSize[]>(
      'SELECT product_size_id, size_value, size_unit FROM product_size ORDER BY size_unit, size_value'
    );
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: rows.map((size) => ({
        ...size,
        size_label: `${Number(size.size_value)} ${size.size_unit}`
      }))
    });
  } catch (err) {
    console.error('Get product sizes error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const getProductSizeById = async (req: Request, res: Response) => {
  const productSizeId = positiveInt(req.params.product_size_id);
  if (!productSizeId) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  }

  try {
    const [rows] = await WaitTransition.promise().query<ProductSize[]>(
      'SELECT product_size_id, size_value, size_unit FROM product_size WHERE product_size_id = ?',
      [productSizeId]
    );
    const size = rows[0];
    if (!size) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: {
        ...size,
        size_label: `${Number(size.size_value)} ${size.size_unit}`
      }
    });
  } catch (err) {
    console.error('Get product size error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addProductSize = async (req: Request, res: Response) => {
  const sizeValue = parseSizeValue(req.body?.size_value);
  const sizeUnit = typeof req.body?.size_unit === 'string' ? req.body.size_unit.trim().toLowerCase() : '';
  if (sizeValue === null || !sizeUnits.has(sizeUnit)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.PRODUCT_SIZE_FIELDS_REQUIRED });
  }

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'INSERT INTO product_size (size_value, size_unit) VALUES (?, ?)',
      [sizeValue, sizeUnit]
    );
    return res.status(201).json({
      resultCode: 201,
      message: serviceMessage.OPERATION_SUCESS,
      product_size_id: result.insertId
    });
  } catch (err: unknown) {
    if (errorCode(err) === 'ER_DUP_ENTRY') {
      return res.status(409).json({ resultCode: 409, message: serviceMessage.PRODUCT_SIZE_ALREADY_EXISTS });
    }
    console.error('Add product size error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateProductSize = async (req: Request, res: Response) => {
  const productSizeId = positiveInt(req.params.product_size_id);
  const sizeValue = parseSizeValue(req.body?.size_value);
  const sizeUnit = typeof req.body?.size_unit === 'string' ? req.body.size_unit.trim().toLowerCase() : '';
  if (!productSizeId) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  }
  if (sizeValue === null || !sizeUnits.has(sizeUnit)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.PRODUCT_SIZE_FIELDS_REQUIRED });
  }

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'UPDATE product_size SET size_value = ?, size_unit = ? WHERE product_size_id = ?',
      [sizeValue, sizeUnit, productSizeId]
    );
    if (!result.affectedRows) {
      const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
        'SELECT product_size_id FROM product_size WHERE product_size_id = ?',
        [productSizeId]
      );
      if (!rows.length) return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err: unknown) {
    if (errorCode(err) === 'ER_DUP_ENTRY') {
      return res.status(409).json({ resultCode: 409, message: serviceMessage.PRODUCT_SIZE_ALREADY_EXISTS });
    }
    console.error('Update product size error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deleteProductSize = async (req: Request, res: Response) => {
  const productSizeId = positiveInt(req.params.product_size_id);
  if (!productSizeId) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  }

  try {
    const [result] = await WaitTransition.promise().query<ResultSetHeader>(
      'DELETE FROM product_size WHERE product_size_id = ?',
      [productSizeId]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err: unknown) {
    if (errorCode(err) === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        resultCode: 409,
        message: serviceMessage.PRODUCT_SIZE_IN_USE
      });
    }
    console.error('Delete product size error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

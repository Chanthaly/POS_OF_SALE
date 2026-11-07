import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { positiveInt } from '../utils/numberHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

const taxTypes = ['VAT', 'NO_TAX', 'OTHER'] as const;
type TaxType = typeof taxTypes[number];
type TaxInput = {
  tax_name: string;
  tax_code: string | null;
  tax_rate: number;
  tax_type: TaxType;
  is_default: 0 | 1;
  status: 0 | 1;
};
type TaxRow = RowDataPacket & TaxInput & {
  tax_id: number;
  company_id: number;
  created_at: string;
  updated_at: string;
};

const parseFlag = (value: unknown, fallback: 0 | 1): 0 | 1 | null => {
  if (value === undefined) return fallback;
  if (value === 0 || value === '0' || value === false) return 0;
  if (value === 1 || value === '1' || value === true) return 1;
  return null;
};

const parseTaxInput = (body: Record<string, unknown>): TaxInput | null => {
  const taxName = typeof body.tax_name === 'string' ? body.tax_name.trim() : '';
  const taxCode = body.tax_code === undefined || body.tax_code === null || body.tax_code === ''
    ? null
    : typeof body.tax_code === 'string' ? body.tax_code.trim() : undefined;
  const rateString = String(body.tax_rate === undefined ? 0 : body.tax_rate);
  const taxRate = Number(rateString);
  const taxType = body.tax_type === undefined ? 'VAT' : body.tax_type;
  const isDefault = parseFlag(body.is_default, 0);
  const status = parseFlag(body.status, 1);

  if (
    !taxName || taxName.length > 100 ||
    taxCode === undefined || (taxCode !== null && taxCode.length > 50) ||
    !/^\d+(?:\.\d{1,2})?$/.test(rateString) || !Number.isFinite(taxRate) || taxRate > 100 ||
    typeof taxType !== 'string' || !taxTypes.includes(taxType as TaxType) ||
    isDefault === null || status === null
  ) return null;

  return {
    tax_name: taxName,
    tax_code: taxCode,
    tax_rate: taxRate,
    tax_type: taxType as TaxType,
    is_default: isDefault,
    status,
  };
};

const lockCompany = async (connection: { query: (...args: any[]) => Promise<any> }, companyId: number) => {
  const [rows] = await connection.query(
    'SELECT company_id FROM company WHERE company_id = ? FOR UPDATE',
    [companyId]
  ) as [RowDataPacket[], unknown];
  return rows.length > 0;
};

const clearDefaultTax = async (connection: { query: (...args: any[]) => Promise<any> }, companyId: number, exceptId?: number) => {
  await connection.query(
    `UPDATE tax SET is_default = 0 WHERE company_id = ? AND deleted_at IS NULL${exceptId === undefined ? '' : ' AND tax_id <> ?'}`,
    exceptId === undefined ? [companyId] : [companyId, exceptId]
  );
};

const requestedCompanyId = (value: unknown): number | null | undefined => {
  if (value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  return positiveInt(value) ?? undefined;
};

const companyScope = (req: Request, requestedId?: number | null): number | null => {
  if (req.user?.user_role === 'superuser') return requestedId ?? null;
  const companyId = positiveInt(req.user?.company_id);
  if (!companyId || (requestedId !== undefined && requestedId !== null && requestedId !== companyId)) return null;
  return companyId;
};

export const getTaxes = async (req: Request, res: Response) => {
  const requestedId = requestedCompanyId(req.query.company_id);
  if (requestedId === undefined) return res.status(400).json({ resultCode: 400, message: serviceMessage.INVALID_COMPANY_ID });
  const companyId = companyScope(req, requestedId);
  if (req.user?.user_role !== 'superuser' && !companyId) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_MISMATCH });
  }

  try {
    const [rows] = await WaitTransition.promise().query<TaxRow[]>(
      `SELECT tax_id, company_id, tax_name, tax_code, tax_rate, tax_type,
              is_default, status, created_at, updated_at
       FROM tax${companyId ? ' WHERE company_id = ? AND deleted_at IS NULL' : ' WHERE deleted_at IS NULL'}
       ORDER BY company_id, is_default DESC, tax_id DESC`,
      companyId ? [companyId] : []
    );
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    console.error('Get taxes error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const addTax = async (req: Request, res: Response) => {
  const isSuperuser = req.user?.user_role === 'superuser';
  const requestedId = isSuperuser ? requestedCompanyId(req.body?.company_id) : undefined;
  const companyId = isSuperuser ? requestedId : companyScope(req);
  const input = parseTaxInput(req.body ?? {});
  if (isSuperuser && (!companyId || requestedId === undefined)) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.VALID_COMPANY_ID_REQUIRED });
  }
  if (!companyId) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_COMPANY_NOT_ASSIGNED });
  if (!input) return res.status(400).json({ resultCode: 400, message: serviceMessage.INVALID_TAX_DATA });

  try {
    const taxId = await withTransaction(async (connection) => {
      if (!(await lockCompany(connection, companyId))) return null;
      if (input.is_default) await clearDefaultTax(connection, companyId);
      const [result] = await connection.query(
        `INSERT INTO tax (company_id, tax_name, tax_code, tax_rate, tax_type, is_default, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, input.tax_name, input.tax_code, input.tax_rate, input.tax_type, input.is_default, input.status]
      ) as [ResultSetHeader, unknown];
      return result.insertId;
    });
    if (taxId === null) return res.status(404).json({ resultCode: 404, message: serviceMessage.COMPANY_NOT_FOUND });
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, tax_id: taxId });
  } catch (err) {
    console.error('Add tax error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const updateTax = async (req: Request, res: Response) => {
  const taxId = positiveInt(req.params.tax_id);
  const input = parseTaxInput(req.body ?? {});
  if (!taxId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  if (!input) return res.status(400).json({ resultCode: 400, message: serviceMessage.INVALID_TAX_DATA });

  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        'SELECT company_id FROM tax WHERE tax_id = ? AND deleted_at IS NULL',
        [taxId]
      ) as [Array<RowDataPacket & { company_id: number }>, unknown];
      const companyId = rows[0]?.company_id;
      if (!companyId) return 'not-found';
      if (req.user?.user_role !== 'superuser' && positiveInt(req.user?.company_id) !== companyId) return 'forbidden';
      if (!(await lockCompany(connection, companyId))) return 'not-found';
      const [lockedRows] = await connection.query(
        'SELECT company_id FROM tax WHERE tax_id = ? AND deleted_at IS NULL FOR UPDATE',
        [taxId]
      ) as [Array<RowDataPacket & { company_id: number }>, unknown];
      if (lockedRows[0]?.company_id !== companyId) return 'not-found';
      if (input.is_default) await clearDefaultTax(connection, companyId, taxId);
      await connection.query(
        `UPDATE tax
         SET tax_name = ?, tax_code = ?, tax_rate = ?, tax_type = ?, is_default = ?, status = ?
         WHERE tax_id = ? AND company_id = ? AND deleted_at IS NULL`,
        [input.tax_name, input.tax_code, input.tax_rate, input.tax_type, input.is_default, input.status, taxId, companyId]
      );
      return 'updated';
    });
    if (result === 'not-found') return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    if (result === 'forbidden') return res.status(403).json({ resultCode: 403, message: serviceMessage.TAX_OUTSIDE_COMPANY });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Update tax error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const deleteTax = async (req: Request, res: Response) => {
  const taxId = positiveInt(req.params.tax_id);
  if (!taxId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });

  try {
    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        'SELECT company_id FROM tax WHERE tax_id = ? AND deleted_at IS NULL',
        [taxId]
      ) as [Array<RowDataPacket & { company_id: number }>, unknown];
      const companyId = rows[0]?.company_id;
      if (!companyId) return 'not-found';
      if (req.user?.user_role !== 'superuser' && positiveInt(req.user?.company_id) !== companyId) return 'forbidden';
      if (!(await lockCompany(connection, companyId))) return 'not-found';
      const [lockedRows] = await connection.query(
        'SELECT company_id FROM tax WHERE tax_id = ? AND deleted_at IS NULL FOR UPDATE',
        [taxId]
      ) as [Array<RowDataPacket & { company_id: number }>, unknown];
      if (lockedRows[0]?.company_id !== companyId) return 'not-found';
      await connection.query(
        `UPDATE tax SET deleted_at = CURRENT_TIMESTAMP, status = 0, is_default = 0
         WHERE tax_id = ? AND company_id = ? AND deleted_at IS NULL`,
        [taxId, companyId]
      );
      return 'deleted';
    });
    if (result === 'not-found') return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    if (result === 'forbidden') return res.status(403).json({ resultCode: 403, message: serviceMessage.TAX_OUTSIDE_COMPANY });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Delete tax error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

import type { Request, Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { serviceMessage } from '../utils/service.Message.js';

type TransferItem = { product_id: number; quantity: number; note?: string };
type TransferBody = {
  transfer_no: string;
  from_branch_id: number;
  to_branch_id: number;
  transfer_date?: string;
  note?: string;
  items: TransferItem[];
};

const positiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const companyForBranch = async (branchId: number) => {
  const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(
    'SELECT bran_id, company_id FROM branc WHERE bran_id = ?', [branchId]
  );
  return rows[0] as { bran_id: number; company_id: number } | undefined;
};

export const getTransfers = async (req: Request, res: Response) => {
  try {
    const isSuperuser = req.user?.user_role === 'superuser';
    const isAdmin = req.user?.user_role === 'admin';
    const companyId = positiveInt(req.user?.company_id);
    const branchId = positiveInt(req.user?.bran_id);
    if (!isSuperuser && (!companyId || !branchId)) return res.status(403).json({ resultCode: 403, message: 'User scope is not assigned' });

    let sql = 'SELECT t.*, fb.bran_name AS from_branch_name, tb.bran_name AS to_branch_name FROM st_transfers t INNER JOIN branc fb ON fb.bran_id = t.from_branch_id INNER JOIN branc tb ON tb.bran_id = t.to_branch_id';
    const params: number[] = [];
    if (!isSuperuser) {
      sql += ' WHERE fb.company_id = ?';
      params.push(companyId!);
      if (!isAdmin && branchId) {
        sql += ' AND (t.from_branch_id = ? OR t.to_branch_id = ?)';
        params.push(branchId, branchId);
      }
    }
    sql += ' ORDER BY t.tr_id DESC';
    const [rows] = await WaitTransition.promise().query<RowDataPacket[]>(sql, params);
    return res.status(200).json({ resultCode: 200, message: serviceMessage.SUCCESS, data: rows });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const createTransfer = async (req: Request, res: Response) => {
  const body = req.body as Partial<TransferBody>;
  const fromBranchId = positiveInt(body.from_branch_id);
  const toBranchId = positiveInt(body.to_branch_id);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!body.transfer_no?.trim() || !fromBranchId || !toBranchId || fromBranchId === toBranchId || !items.length) {
    return res.status(400).json({ resultCode: 400, message: 'transfer_no, different branches and items are required' });
  }
  if (items.some((item) => !positiveInt(item.product_id) || !positiveInt(item.quantity))) {
    return res.status(400).json({ resultCode: 400, message: 'Each item needs a positive product_id and quantity' });
  }
    if (req.user?.user_role !== 'superuser' && req.user?.user_role !== 'admin') {
    return res.status(403).json({ resultCode: 403, message: 'Only head office can create transfers' });
  }

  try {
    const fromBranch = await companyForBranch(fromBranchId);
    const toBranch = await companyForBranch(toBranchId);
    if (!fromBranch || !toBranch) {
      return res.status(403).json({ resultCode: 403, message: 'Both branches must belong to the same company' });
    }
    if (req.user?.user_role === 'admin' && fromBranch.company_id !== Number(req.user.company_id)) {
      return res.status(403).json({ resultCode: 403, message: 'Branches are outside your company' });
    }
    const productIds = items.map((item) => item.product_id);
    const productPlaceholders = productIds.map(() => '?').join(',');
    const [products] = await WaitTransition.promise().query<RowDataPacket[]>(
      `SELECT p_id FROM product WHERE bran_id = ? AND p_id IN (${productPlaceholders})`,
      [fromBranchId, ...productIds]
    );
    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({ resultCode: 400, message: 'Every product must belong to the source branch' });
    }

    const result = await withTransaction(async (connection) => {
      const [transfer] = await connection.query(
        `INSERT INTO st_transfers
          (transfer_no, from_branch_id, to_branch_id, transferred_by, status, transfer_date, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'panding', ?, ?, NOW(), NOW())`,
        [body.transfer_no!.trim(), fromBranchId, toBranchId, req.user!.user_id, body.transfer_date ?? new Date(), body.note ?? null]
      );
      for (const item of items) {
        await connection.query(
          'INSERT INTO st_transers_items (transfer_id, product_id, quantity, received_quantity, note) VALUES (?, ?, ?, 0, ?)',
          [transfer.insertId, item.product_id, item.quantity, item.note ?? null]
        );
      }
      return transfer.insertId;
    });
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, tr_id: result });
  } catch (err) {
    console.error('Create transfer error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

const updateTransferStatus = async (req: Request, res: Response, status: 'received' | 'cancelled') => {
  const transferId = positiveInt(req.params.tr_id);
  if (!transferId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  const branchId = positiveInt(req.user?.bran_id);
  const isSuperuser = req.user?.user_role === 'superuser';
  const isAdmin = req.user?.user_role === 'admin';
  if (status === 'received' && !isSuperuser && !branchId) return res.status(403).json({ resultCode: 403, message: 'Branch user is not assigned' });
  try {
    if (isAdmin) {
      const [companyTransfers] = await WaitTransition.promise().query<RowDataPacket[]>(
        `SELECT t.tr_id
         FROM st_transfers t
         INNER JOIN branc fb ON fb.bran_id = t.from_branch_id
         INNER JOIN branc tb ON tb.bran_id = t.to_branch_id
         WHERE t.tr_id = ? AND fb.company_id = ? AND tb.company_id = ?`,
        [transferId, req.user?.company_id, req.user?.company_id]
      );
      if (!companyTransfers.length) {
        return res.status(403).json({ resultCode: 403, message: 'Transfer is outside your company' });
      }
    }
    const result = await withTransaction(async (connection) => {
      const [updated] = await connection.query(
          status === 'received'
            ? isSuperuser || isAdmin
            ? `UPDATE st_transfers SET status = 'received', received_by = ?, updated_at = NOW()
              WHERE tr_id = ? AND status IN ('panding', 'in_transit')`
            : `UPDATE st_transfers SET status = 'received', received_by = ?, updated_at = NOW()
              WHERE tr_id = ? AND to_branch_id = ? AND status IN ('panding', 'in_transit')`
          : `UPDATE st_transfers SET status = 'cancelled', updated_at = NOW()
             WHERE tr_id = ? AND status IN ('panding', 'in_transit')`,
        status === 'received' ? (isSuperuser ? [req.user?.user_id, transferId] : [req.user?.user_id, transferId, branchId]) : [transferId]
      ) as [{ affectedRows: number }];
      if (status === 'received' && updated.affectedRows) {
        await connection.query(
          'UPDATE st_transers_items SET received_quantity = quantity WHERE transfer_id = ?',
          [transferId]
        );
      }
      return updated;
    });
    if (!result.affectedRows) return res.status(404).json({ resultCode: 404, message: 'Transfer not found or status cannot be changed' });
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const receiveTransfer = (req: Request, res: Response) => updateTransferStatus(req, res, 'received');
export const cancelTransfer = (req: Request, res: Response) => updateTransferStatus(req, res, 'cancelled');
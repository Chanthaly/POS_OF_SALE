import type { Request, Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import WaitTransition from '../db/dbconfigHelper.js';
import { withTransaction } from '../dbconfig/configdb.js';
import { positiveInt } from '../utils/numberHelper.js';
import { serviceMessage } from '../utils/service.Message.js';

type TransferItem = { product_id: number; quantity: number; note?: string };
type TransferBody = {
  from_branch_id: number;
  to_branch_id: number;
  transfer_date?: string;
  note_dct?: string;
  items: TransferItem[];
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
    if (!isSuperuser && (!companyId || !branchId)) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });

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
  if (!fromBranchId || !toBranchId || fromBranchId === toBranchId || !items.length) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.DIFFERENT_TRANSFER_BRANCHES_AND_ITEMS_REQUIRED });
  }
  if (items.some((item) => !positiveInt(item.product_id) || !positiveInt(item.quantity))) {
    return res.status(400).json({ resultCode: 400, message: serviceMessage.TRANSFER_PRODUCT_FIELDS_REQUIRED });
  }
    if (req.user?.user_role !== 'superuser' && req.user?.user_role !== 'admin') {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.ONLY_HEAD_OFFICE_CAN_CREATE_TRANSFERS });
  }

  try {
    const fromBranch = await companyForBranch(fromBranchId);
    const toBranch = await companyForBranch(toBranchId);
    if (!fromBranch || !toBranch) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.BOTH_BRANCHES_SAME_COMPANY_REQUIRED });
    }
    if (fromBranch.company_id !== toBranch.company_id) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.BOTH_BRANCHES_SAME_COMPANY_REQUIRED });
    }
    if (req.user?.user_role === 'admin' && fromBranch.company_id !== Number(req.user.company_id)) {
      return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCHES_OUTSIDE_COMPANY });
    }
    const productIds = items.map((item) => item.product_id);
    const productPlaceholders = productIds.map(() => '?').join(',');
    const [products] = await WaitTransition.promise().query<RowDataPacket[]>(
      `SELECT p_id FROM product WHERE bran_id = ? AND deleted_at IS NULL AND p_id IN (${productPlaceholders})`,
      [fromBranchId, ...productIds]
    );
    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({ resultCode: 400, message: serviceMessage.EVERY_PRODUCT_SOURCE_BRANCH_REQUIRED });
    }
    const result = await withTransaction(async (connection) => {
      const [dateRows] = await connection.query(
        "SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS transfer_day, DATE_FORMAT(CURRENT_DATE, '%Y%m%d') AS date_prefix"
      ) as [RowDataPacket[]];
      const { transfer_day: transferDay, date_prefix: datePrefix } = dateRows[0] as {
        transfer_day: string;
        date_prefix: string;
      };
      await connection.query(
        `INSERT INTO st_transfer_daily_sequence (transfer_day, last_number)
         VALUES (?, LAST_INSERT_ID(1))
         ON DUPLICATE KEY UPDATE last_number = LAST_INSERT_ID(last_number + 1)`,
        [transferDay]
      );
      const [sequenceRows] = await connection.query(
        'SELECT LAST_INSERT_ID() AS sequence_number'
      ) as [RowDataPacket[]];
      const sequenceNumber = Number(sequenceRows[0]?.sequence_number);
      const transferNo = `${datePrefix}${String(sequenceNumber).padStart(3, '0')}`;
      const [transfer] = await connection.query(
        `INSERT INTO st_transfers
          (transfer_no, from_branch_id, to_branch_id, transferred_by, status, transfer_date, note_dct, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'panding', ?, ?, NOW(), NOW())`,
        [transferNo, fromBranchId, toBranchId, req.user!.user_id, body.transfer_date ?? new Date(), body.note_dct ?? null]
      );
      for (const item of items) {
        await connection.query(
          'INSERT INTO st_transers_items (transfer_id, product_id, quantity, received_quantity, note) VALUES (?, ?, ?, 0, ?)',
          [transfer.insertId, item.product_id, item.quantity, item.note ?? null]
        );
      }
      return { id: transfer.insertId, transferNo };
    });
    return res.status(201).json({ resultCode: 201, message: serviceMessage.OPERATION_SUCESS, tr_id: result.id, transfer_no: result.transferNo });
  } catch (err) {
    console.error('Create transfer error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

type TransferActionRow = RowDataPacket & {
  tr_id: number;
  from_branch_id: number;
  to_branch_id: number;
  status: string;
  from_company_id: number;
  to_company_id: number;
};

type TransferReceiveItem = RowDataPacket & {
  product_id: number;
  quantity: number;
  p_name: string;
  p_code: string;
  p_img: string | null;
  pty_id: number;
  source_type_name: string | null;
  destination_type_id: number | null;
  destination_product_id: number | null;
};

type TransferDispatchItem = RowDataPacket & {
  product_id: number;
  quantity: number;
  stock_amount: number | null;
};

const getTransferForUpdate = async (connection: Parameters<Parameters<typeof withTransaction>[0]>[0], transferId: number) => {
  const [rows] = await connection.query(
    `SELECT t.tr_id, t.from_branch_id, t.to_branch_id, t.status,
            fb.company_id AS from_company_id, tb.company_id AS to_company_id
     FROM st_transfers t
     INNER JOIN branc fb ON fb.bran_id = t.from_branch_id
     INNER JOIN branc tb ON tb.bran_id = t.to_branch_id
     WHERE t.tr_id = ?
     FOR UPDATE`,
    [transferId]
  ) as [TransferActionRow[]];
  return rows[0];
};

const updateTransferStatus = async (req: Request, res: Response, status: 'received' | 'cancelled') => {
  const transferId = positiveInt(req.params.tr_id);
  if (!transferId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  const branchId = positiveInt(req.user?.bran_id);
  const userId = positiveInt(req.user?.user_id);
  const isSuperuser = req.user?.user_role === 'superuser';
  const isAdmin = req.user?.user_role === 'admin';
  if (status === 'received' && (!userId || !branchId)) {
    return res.status(403).json({ resultCode: 403, message: serviceMessage.DESTINATION_BRANCH_USER_REQUIRED });
  }
  try {
    const result = await withTransaction(async (connection) => {
      const transfer = await getTransferForUpdate(connection, transferId);
      if (!transfer) return { error: 'not_found' as const };
      if (isAdmin && (transfer.from_company_id !== Number(req.user?.company_id) || transfer.to_company_id !== Number(req.user?.company_id))) {
        return { error: 'outside_company' as const };
      }
      if (status === 'received' && transfer.to_branch_id !== branchId) {
        return { error: 'wrong_receiving_branch' as const };
      }
      if (status === 'cancelled' && !isSuperuser && !isAdmin) {
        return { error: 'outside_branch' as const };
      }
      const requiredStatus = status === 'received' ? 'in_transit' : 'panding';
      if (transfer.status !== requiredStatus) return { error: 'invalid_status' as const };

      if (status === 'received') {
        const [items] = await connection.query(
          `SELECT ti.product_id, ti.quantity, source.p_name, source.p_code, source.p_img, source.pty_id,
                  source_type.Ptype_name AS source_type_name,
                  destination.p_id AS destination_product_id,
                  destination_type.Ptype_id AS destination_type_id
           FROM st_transers_items ti
           INNER JOIN product source ON source.p_id = ti.product_id
           LEFT JOIN p_type source_type
             ON source_type.Ptype_id = source.pty_id AND source_type.p_id = source.p_id
                AND source_type.deleted_at IS NULL
           LEFT JOIN product destination
             ON destination.p_code = source.p_code AND destination.bran_id = ?
                AND destination.deleted_at IS NULL
           LEFT JOIN p_type destination_type
             ON destination_type.Ptype_id = destination.pty_id AND destination_type.p_id = destination.p_id
                AND destination_type.deleted_at IS NULL
           WHERE ti.transfer_id = ? AND source.bran_id = ?
           FOR UPDATE`,
          [transfer.to_branch_id, transferId, transfer.from_branch_id]
        ) as [TransferReceiveItem[]];
        if (!items.length) return { error: 'transfer_items_missing' as const };
        for (const item of items) {
          let destinationProductId = item.destination_product_id;
          if (!destinationProductId) {
            const [createdProduct] = await connection.query(
              `INSERT INTO product (p_name, p_code, p_img, created_at, bran_id, pty_id)
               VALUES (?, ?, ?, NOW(), ?, ?)
               ON DUPLICATE KEY UPDATE p_id = LAST_INSERT_ID(p_id), deleted_at = NULL`,
              [item.p_name, item.p_code, item.p_img, transfer.to_branch_id, item.pty_id]
            ) as [ResultSetHeader];
            destinationProductId = createdProduct.insertId || null;
            if (!destinationProductId) {
              const [destinationProducts] = await connection.query(
                'SELECT p_id FROM product WHERE bran_id = ? AND p_code = ? AND deleted_at IS NULL FOR UPDATE',
                [transfer.to_branch_id, item.p_code]
              ) as [Array<RowDataPacket & { p_id: number }>];
              destinationProductId = destinationProducts[0]?.p_id ?? null;
            }
          }
          if (!destinationProductId) {
            throw new Error(`Unable to resolve destination product for product code ${item.p_code}`);
          }
          if (item.source_type_name && !item.destination_type_id) {
            const [createdType] = await connection.query(
              'INSERT INTO p_type (Ptype_name, p_id) VALUES (?, ?)',
              [item.source_type_name, destinationProductId]
            ) as [ResultSetHeader];
            await connection.query(
              'UPDATE product SET pty_id = ? WHERE p_id = ? AND bran_id = ?',
              [createdType.insertId, destinationProductId, transfer.to_branch_id]
            );
          }
          const [sourcePrices] = await connection.query(
            `SELECT cost_price_item, cost_price_pack, sale_price_pack, sale_price_items
             FROM p_price WHERE p_id = ? AND deleted_at IS NULL ORDER BY price_id DESC LIMIT 1`,
            [item.product_id]
          ) as [Array<RowDataPacket & {
            cost_price_item: number;
            cost_price_pack: number;
            sale_price_pack: number;
            sale_price_items: number;
          }>];
          const [destinationPrices] = await connection.query(
            'SELECT price_id FROM p_price WHERE p_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
            [destinationProductId]
          ) as [Array<RowDataPacket & { price_id: number }>];
          if (sourcePrices[0] && !destinationPrices.length) {
            const price = sourcePrices[0];
            await connection.query(
              `INSERT INTO p_price
                (p_id, cost_price_item, cost_price_pack, sale_price_pack, sale_price_items)
               VALUES (?, ?, ?, ?, ?)`,
              [destinationProductId, price.cost_price_item, price.cost_price_pack, price.sale_price_pack, price.sale_price_items]
            );
          }
          await connection.query(
            `INSERT INTO p_stock (stock_amount, user_id, p_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
               stock_amount = IF(deleted_at IS NULL, stock_amount + VALUES(stock_amount), VALUES(stock_amount)),
               user_id = VALUES(user_id),
               deleted_at = NULL`,
            [item.quantity, userId, destinationProductId]
          );
        }
        await connection.query(
          'UPDATE st_transers_items SET received_quantity = quantity WHERE transfer_id = ?',
          [transferId]
        );
      }
      await connection.query(
        status === 'received'
          ? "UPDATE st_transfers SET status = 'received', received_by = ?, updated_at = NOW() WHERE tr_id = ?"
          : "UPDATE st_transfers SET status = 'cancelled', updated_at = NOW() WHERE tr_id = ?",
        status === 'received' ? [userId, transferId] : [transferId]
      );
      return { success: true as const };
    });
    if ('error' in result) {
      if (result.error === 'not_found') return res.status(404).json({ resultCode: 404, message: serviceMessage.TRANSFER_NOT_FOUND });
      if (result.error === 'outside_company' || result.error === 'outside_branch') {
        return res.status(403).json({ resultCode: 403, message: serviceMessage.TRANSFER_OUTSIDE_ASSIGNED_SCOPE });
      }
      if (result.error === 'wrong_receiving_branch') {
        return res.status(403).json({ resultCode: 403, message: serviceMessage.ONLY_DESTINATION_BRANCH_CAN_RECEIVE });
      }
      if (result.error === 'transfer_items_missing') {
        return res.status(409).json({ resultCode: 409, message: serviceMessage.TRANSFER_NO_VALID_PRODUCTS_TO_RECEIVE });
      }
      return res.status(409).json({ resultCode: 409, message: serviceMessage.TRANSFER_STATUS_ACTION_NOT_ALLOWED });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const dispatchTransfer = async (req: Request, res: Response) => {
  const transferId = positiveInt(req.params.tr_id);
  const branchId = positiveInt(req.user?.bran_id);
  const userId = positiveInt(req.user?.user_id);
  const isSuperuser = req.user?.user_role === 'superuser';
  const isAdmin = req.user?.user_role === 'admin';
  if (!transferId) return res.status(400).json({ resultCode: 400, message: serviceMessage.ID_NOT_FOUND });
  if (!userId) return res.status(403).json({ resultCode: 403, message: serviceMessage.USER_SCOPE_NOT_ASSIGNED });
  if (!isSuperuser && !isAdmin && !branchId) return res.status(403).json({ resultCode: 403, message: serviceMessage.BRANCH_USER_NOT_ASSIGNED });

  try {
    const result = await withTransaction(async (connection) => {
      const transfer = await getTransferForUpdate(connection, transferId);
      if (!transfer) return { error: 'not_found' as const };
      if (isAdmin && (transfer.from_company_id !== Number(req.user?.company_id) || transfer.to_company_id !== Number(req.user?.company_id))) {
        return { error: 'outside_company' as const };
      }
      if (!isSuperuser && !isAdmin && transfer.from_branch_id !== branchId) {
        return { error: 'outside_branch' as const };
      }
      if (transfer.status !== 'panding') return { error: 'invalid_status' as const };

      const [items] = await connection.query(
        `SELECT ti.product_id, ti.quantity, s.stock_amount
         FROM st_transers_items ti
         INNER JOIN product p ON p.p_id = ti.product_id
         LEFT JOIN p_stock s ON s.p_id = p.p_id AND s.deleted_at IS NULL
         WHERE ti.transfer_id = ? AND p.bran_id = ? AND p.deleted_at IS NULL
         FOR UPDATE`,
        [transferId, transfer.from_branch_id]
      ) as [TransferDispatchItem[]];
      if (!items.length || items.some((item) => item.stock_amount === null || Number(item.stock_amount) < Number(item.quantity))) {
        return { error: 'insufficient_stock' as const };
      }
      for (const item of items) {
        await connection.query(
          `UPDATE p_stock s
           INNER JOIN product p ON p.p_id = s.p_id
           SET s.stock_amount = s.stock_amount - ?, s.user_id = ?
           WHERE p.p_id = ? AND p.bran_id = ? AND p.deleted_at IS NULL AND s.deleted_at IS NULL`,
          [item.quantity, userId, item.product_id, transfer.from_branch_id]
        );
      }
      await connection.query(
        "UPDATE st_transfers SET status = 'in_transit', updated_at = NOW() WHERE tr_id = ?",
        [transferId]
      );
      return { success: true as const };
    });
    if ('error' in result) {
      if (result.error === 'not_found') return res.status(404).json({ resultCode: 404, message: serviceMessage.TRANSFER_NOT_FOUND });
      if (result.error === 'outside_company' || result.error === 'outside_branch') {
        return res.status(403).json({ resultCode: 403, message: serviceMessage.TRANSFER_OUTSIDE_ASSIGNED_SCOPE });
      }
      if (result.error === 'insufficient_stock') {
        return res.status(409).json({ resultCode: 409, message: serviceMessage.INSUFFICIENT_SOURCE_BRANCH_STOCK });
      }
      return res.status(409).json({ resultCode: 409, message: serviceMessage.TRANSFER_STATUS_DISPATCH_NOT_ALLOWED });
    }
    return res.status(200).json({ resultCode: 200, message: serviceMessage.OPERATION_SUCESS });
  } catch (err) {
    console.error('Dispatch transfer error:', err);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR, error: err });
  }
};

export const receiveTransfer = (req: Request, res: Response) => updateTransferStatus(req, res, 'received');
export const cancelTransfer = (req: Request, res: Response) => updateTransferStatus(req, res, 'cancelled');
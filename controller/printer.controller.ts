import type { Request, Response } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import connect from '../db/dbconfigHelper.js';
import { positiveInt } from '../utils/numberHelper.js';
import { parsePrinterInput } from '../utils/printerSettings.js';
import { serviceMessage } from '../utils/service.Message.js';

type PrinterRow = RowDataPacket & {
  printer_id: number;
  printer_name: string;
  printer_type: 'thermal' | 'laser' | 'inkjet';
  connection_type: 'usb' | 'wifi' | 'lan';
  ip_address: string | null;
  bran_id: number;
  created_at: string;
  company_id: number;
};

type PrinterPublicRow = RowDataPacket & Omit<PrinterRow, 'company_id'>;

const printerResponse = (printer: NonNullable<ReturnType<typeof parsePrinterInput>>) => ({
  printer_name: printer.printerName,
  printer_type: printer.printerType,
  connection_type: printer.connectionType,
  ip_address: printer.ipAddress,
});

const requestBody = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const resolveCompanyId = (req: Request, requestedCompanyId: unknown): number | null =>
  req.user?.user_role === 'superuser'
    ? positiveInt(requestedCompanyId)
    : positiveInt(req.user?.company_id);

const canAccessBranch = async (
  req: Request,
  branchId: number,
  companyId: number
): Promise<boolean> => {
  if (['manager', 'cashier', 'staff'].includes(req.user?.user_role ?? '')
    && req.user?.bran_id !== branchId) return false;

  const [branches] = await connect.promise().query<Array<RowDataPacket & { bran_id: number }>>(
    'SELECT bran_id FROM branc WHERE bran_id = ? AND company_id = ? LIMIT 1',
    [branchId, companyId]
  );
  return branches.length > 0;
};

const getAuthorizedPrinter = async (
  req: Request,
  printerId: number,
  requestedCompanyId: unknown
): Promise<PrinterRow | null> => {
  
  const companyId = resolveCompanyId(req, requestedCompanyId);
  if (!companyId) return null;

  const [rows] = await connect.promise().query<PrinterRow[]>(
    `SELECT p.printer_id, p.printer_name, p.printer_type, p.connection_type,
            p.ip_address, p.bran_id, p.created_at, b.company_id
     FROM printers p
     INNER JOIN branc b ON b.bran_id = p.bran_id
     WHERE p.printer_id = ? AND b.company_id = ?
     LIMIT 1`,
    [printerId, companyId]
  );
  const printer = rows[0];
  if (!printer) return null;
  return await canAccessBranch(req, printer.bran_id, companyId) ? printer : null;
};

export const getPrinters = async (req: Request, res: Response) => {
  try {
    const branchId = positiveInt(req.query.bran_id);
    const companyId = resolveCompanyId(req, req.query.company_id);
    if (!branchId || !companyId || !(await canAccessBranch(req, branchId, companyId))) {
      return res.status(400).json({ resultCode: 400, message: 'A valid branch is required' });
    }

    const [rows] = await connect.promise().query<PrinterPublicRow[]>(
      `SELECT p.printer_id, p.printer_name, p.printer_type, p.connection_type,
              p.ip_address, p.bran_id, p.created_at
       FROM printers p
       INNER JOIN branc b ON b.bran_id = p.bran_id
       WHERE p.bran_id = ? AND b.company_id = ?
       ORDER BY p.printer_id DESC`,
      [branchId, companyId]
    );
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: rows,
    });
  } catch (error) {
    console.error('Get printers error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

export const getPrinterById = async (req: Request, res: Response) => {
  const printerId = positiveInt(req.params.printer_id);
  if (!printerId) {
    return res.status(400).json({ resultCode: 400, message: 'Invalid printer_id' });
  }

  try {
    const printer = await getAuthorizedPrinter(
      req,
      printerId,
      req.query.company_id
    );
    if (!printer) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }

    const { company_id: _companyId, ...data } = printer;
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data,
    });
  } catch (error) {
    console.error('Get printer error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

export const createPrinter = async (req: Request, res: Response) => {
  const body = requestBody(req.body);
  const branchId = positiveInt(body.bran_id);
  const companyId = resolveCompanyId(req, body.company_id);
  const printer = parsePrinterInput(body);
  if (!branchId || !companyId || !printer) {
    return res.status(400).json({ resultCode: 400, message: 'Invalid branch or printer details' });
  }

  try {
    if (!(await canAccessBranch(req, branchId, companyId))) {
      return res.status(400).json({ resultCode: 400, message: 'A valid branch is required' });
    }
    const [result] = await connect.promise().query<ResultSetHeader>(
      `INSERT INTO printers (printer_name, printer_type, connection_type, ip_address, bran_id)
       VALUES (?, ?, ?, ?, ?)`,
      [printer.printerName, printer.printerType, printer.connectionType, printer.ipAddress, branchId]
    );
    return res.status(201).json({
      resultCode: 201,
      message: serviceMessage.SUCCESS,
      data: { printer_id: result.insertId, ...printerResponse(printer), bran_id: branchId },
    });
  } catch (error) {
    console.error('Create printer error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

export const updatePrinter = async (req: Request, res: Response) => {
  const body = requestBody(req.body);
  const printerId = positiveInt(req.params.printer_id);
  const printer = parsePrinterInput(body);
  if (!printerId || !printer) {
    return res.status(400).json({ resultCode: 400, message: 'Invalid printer_id or printer details' });
  }

  try {
    const existing = await getAuthorizedPrinter(
      req,
      printerId,
      req.query.company_id ?? body.company_id
    );
    if (!existing) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }

    await connect.promise().query<ResultSetHeader>(
      `UPDATE printers
       SET printer_name = ?, printer_type = ?, connection_type = ?, ip_address = ?
       WHERE printer_id = ? AND bran_id = ?`,
      [printer.printerName, printer.printerType, printer.connectionType, printer.ipAddress, printerId, existing.bran_id]
    );
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: { printer_id: printerId, ...printerResponse(printer), bran_id: existing.bran_id },
    });
  } catch (error) {
    console.error('Update printer error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

export const deletePrinter = async (req: Request, res: Response) => {
  const printerId = positiveInt(req.params.printer_id);
  if (!printerId) {
    return res.status(400).json({ resultCode: 400, message: 'Invalid printer_id' });
  }

  try {
    const existing = await getAuthorizedPrinter(
      req,
      printerId,
      req.query.company_id
    );
    if (!existing) {
      return res.status(404).json({ resultCode: 404, message: serviceMessage.DATA_NOT_FOUND });
    }

    const [result] = await connect.promise().query<ResultSetHeader>(
      'DELETE FROM printers WHERE printer_id = ? AND bran_id = ?',
      [printerId, existing.bran_id]
    );
    return res.status(200).json({
      resultCode: 200,
      message: serviceMessage.SUCCESS,
      data: { deleted: result.affectedRows > 0 },
    });
  } catch (error) {
    console.error('Delete printer error:', error);
    return res.status(500).json({ resultCode: 500, message: serviceMessage.SERVER_ERROR });
  }
};

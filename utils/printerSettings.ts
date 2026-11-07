import { isIP } from 'node:net';
import type { RowDataPacket } from 'mysql2';
import connect from '../db/dbconfigHelper.js';
import type { EscPosPrinterConfig } from './receiptPrinter.js';

export type PrinterInput = {
  printerName: string;
  printerType: 'thermal' | 'laser' | 'inkjet';
  connectionType: 'usb' | 'wifi' | 'lan';
  ipAddress: string | null;
};

const printerTypes: ReadonlySet<string> = new Set(['thermal', 'laser', 'inkjet']);
const connectionTypes: ReadonlySet<string> = new Set(['usb', 'wifi', 'lan']);
const isPrinterType = (value: unknown): value is PrinterInput['printerType'] =>
  typeof value === 'string' && printerTypes.has(value);
const isConnectionType = (value: unknown): value is PrinterInput['connectionType'] =>
  typeof value === 'string' && connectionTypes.has(value);

export const parsePrinterInput = (value: unknown): PrinterInput | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const printerName = typeof input.printer_name === 'string' ? input.printer_name.trim() : '';
  const printerType = input.printer_type;
  const connectionType = input.connection_type;
  const rawIpAddress = input.ip_address;

  if (!printerName || printerName.length > 100
    || !isPrinterType(printerType)
    || !isConnectionType(connectionType)) return null;

  if (connectionType === 'usb') {
    if (rawIpAddress !== undefined && rawIpAddress !== null && rawIpAddress !== '') return null;
    return {
      printerName,
      printerType,
      connectionType,
      ipAddress: null,
    };
  }

  const ipAddress = typeof rawIpAddress === 'string' ? rawIpAddress.trim() : '';
  if (isIP(ipAddress) === 0) return null;
  return {
    printerName,
    printerType,
    connectionType,
    ipAddress,
  };
};

type PrinterAddressRow = RowDataPacket & { ip_address: string };

export const getBranchPrinterSettings = async (
  branchId: number
): Promise<EscPosPrinterConfig | null> => {
  const [rows] = await connect.promise().query<PrinterAddressRow[]>(
    `SELECT ip_address
     FROM printers
     WHERE bran_id = ?
       AND printer_type = 'thermal'
       AND connection_type IN ('wifi', 'lan')
       
       AND ip_address IS NOT NULL
     ORDER BY printer_id ASC
     LIMIT 1`,
    [branchId]
  );
  const printer = rows[0];
  return printer ? { host: printer.ip_address, port: 9100 } : null;
};

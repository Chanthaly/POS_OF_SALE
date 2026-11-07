import Printer from '@node-escpos/core';
import Network from '@node-escpos/network-adapter';

export type EscPosPrinterConfig = {
  host: string;
  port: number;
};

export type ReceiptItem = {
  name: string;
  quantity: number;
  unit: 'item' | 'pack';
  pricePerUnit: string | number;
  lineTotal: string | number;
};

export type ReceiptData = {
  companyName: string;
  branchName: string;
  saleId: number;
  createdAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  subtotal: string | number;
  discountAmount: string | number;
  vatRate: string | number;
  vatAmount: string | number;
  totalAmount: string | number;
  items: ReceiptItem[];
};

export class ReceiptPrinterError extends Error {
  constructor(readonly code: 'not_configured' | 'invalid_config' | 'connection_failed', message: string) {
    super(message);
  }
}

const lineWidth = 48;
const escape = (value: string): string => value.replace(/[\x00-\x1f\x7f]/g, ' ');
const amount = (value: string | number): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
};

const separator = '-'.repeat(lineWidth);
const leftRight = (left: string, right: string): string => {
  const safeLeft = escape(left);
  const safeRight = escape(right);
  const clippedLeft = safeLeft.slice(0, Math.max(0, lineWidth - safeRight.length - 1));
  return `${clippedLeft}${' '.repeat(Math.max(1, lineWidth - clippedLeft.length - safeRight.length))}${safeRight}`;
};

export const buildEscPosReceipt = (receipt: ReceiptData): Buffer => {
  const lines: string[] = [
    '\x1b@',
    '\x1ba\x01',
    '\x1bE\x01',
    escape(receipt.companyName),
    escape(receipt.branchName),
    '\x1bE\x00',
    '\x1ba\x00',
    `RECEIPT #${receipt.saleId}`,
    escape(receipt.createdAt),
  ];
  if (receipt.customerName) lines.push(`Customer: ${escape(receipt.customerName)}`);
  if (receipt.customerPhone) lines.push(`Phone: ${escape(receipt.customerPhone)}`);
  lines.push(separator);

  for (const item of receipt.items) {
    lines.push(escape(item.name).slice(0, lineWidth));
    lines.push(`${item.quantity} ${item.unit} x ${amount(item.pricePerUnit)}`);
    lines.push(leftRight('', amount(item.lineTotal)));
  }

  lines.push(
    separator,
    leftRight('Subtotal', amount(receipt.subtotal)),
    leftRight('Discount', amount(receipt.discountAmount)),
    leftRight(`VAT ${amount(receipt.vatRate)}%`, amount(receipt.vatAmount)),
    '\x1bE\x01',
    '\x1d!\x11',
    leftRight('TOTAL', amount(receipt.totalAmount)),
    '\x1d!\x00',
    '\x1bE\x00',
    '',
    '\x1ba\x01',
    'Th ank you',
    '',
    '',
    '\x1dV\x00',
  );

  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
};

export const sendEscPosReceipt = async (
  data: Buffer,
  printerConfig?: EscPosPrinterConfig
): Promise<void> => {
  const host = (printerConfig?.host || process.env.ESC_POS_PRINTER_HOST || process.env.EPSON_PRINTER_HOST)?.trim();
  if (!host) {
    throw new ReceiptPrinterError('not_configured', 'ESC_POS_PRINTER_HOST is not configured');
  }

  const portValue = printerConfig?.port
    ?? Number(process.env.ESC_POS_PRINTER_PORT ?? process.env.EPSON_PRINTER_PORT ?? '9100');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ReceiptPrinterError('invalid_config', 'ESC_POS_PRINTER_PORT must be a valid TCP port');
  }

  const adapter = new Network(host, port, 5_000);
  const printer = new Printer(adapter, { encoding: 'UTF-8', width: lineWidth });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let printingStarted = false;
    const timeout = setTimeout(() => {
      finish(new ReceiptPrinterError('connection_failed', 'Timed out sending receipt to ESC/POS printer'));
    }, 5_000);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        adapter.close();
        reject(error instanceof ReceiptPrinterError
          ? error
          : new ReceiptPrinterError('connection_failed', `Could not send receipt to ESC/POS printer: ${error.message}`));
      } else {
        resolve();
      }
    };

    adapter.open((error, device) => {
      if (settled || printingStarted) return;
      if (error) {
        finish(error);
        return;
      }

      printingStarted = true;
      void printer.print(data).close().then(
        () => finish(),
        (printError: unknown) => finish(
          printError instanceof Error ? printError : new Error(String(printError))
        )
      );
    });
  });
};

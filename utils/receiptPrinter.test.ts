import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import { buildEscPosReceipt, ReceiptPrinterError, sendEscPosReceipt } from './receiptPrinter.js';

test('builds an 80mm ESC/POS receipt with item units and totals', () => {
  const receipt = buildEscPosReceipt({
    companyName: 'Sample shop',
    branchName: 'Main branch',
    saleId: 12,
    createdAt: '2026-10-31 11:00:00',
    customerName: 'Customer One',
    customerPhone: '02012345678',
    subtotal: '100.00',
    discountAmount: '5.00',
    vatRate: '10.00',
    vatAmount: '9.50',
    totalAmount: '104.50',
    items: [{
      name: 'Coffee',
      quantity: 2,
      unit: 'item',
      pricePerUnit: '50.00',
      lineTotal: '104.50',
    }],
  }).toString('utf8');

  assert.ok(receipt.startsWith('\x1b@'));
  assert.ok(receipt.includes('RECEIPT #12'));
  assert.ok(receipt.includes('Customer: Customer One'));
  assert.ok(receipt.includes('Phone: 02012345678'));
  assert.ok(receipt.includes('2 item x 50.00'));
  assert.ok(receipt.includes('VAT 10.00%'));
  assert.ok(receipt.includes('104.50'));
  assert.ok(receipt.endsWith('\x1dV\x00\n'));
});

test('removes printer control characters from receipt text', () => {
  const receipt = buildEscPosReceipt({
    companyName: 'Shop\x1b@',
    branchName: 'Branch',
    saleId: 1,
    createdAt: 'now',
    subtotal: 1,
    discountAmount: 0,
    vatRate: 0,
    vatAmount: 0,
    totalAmount: 1,
    items: [],
  }).toString('utf8');

  assert.ok(receipt.includes('Shop @'));
  assert.ok(!receipt.includes('Shop\x1b@'));
});

test('reports an unconfigured printer instead of silently skipping the job', async () => {
  const previousEscPosHost = process.env.ESC_POS_PRINTER_HOST;
  const previousHost = process.env.EPSON_PRINTER_HOST;
  delete process.env.ESC_POS_PRINTER_HOST;
  delete process.env.EPSON_PRINTER_HOST;
  try {
    await assert.rejects(
      sendEscPosReceipt(Buffer.from('test')),
      (error: unknown) => error instanceof ReceiptPrinterError && error.code === 'not_configured'
    );
  } finally {
    if (previousEscPosHost === undefined) delete process.env.ESC_POS_PRINTER_HOST;
    else process.env.ESC_POS_PRINTER_HOST = previousEscPosHost;
    if (previousHost === undefined) delete process.env.EPSON_PRINTER_HOST;
    else process.env.EPSON_PRINTER_HOST = previousHost;
  }
});

test('reports an invalid TCP port before connecting', async () => {
  const previousHost = process.env.ESC_POS_PRINTER_HOST;
  const previousPort = process.env.ESC_POS_PRINTER_PORT;
  process.env.ESC_POS_PRINTER_HOST = '127.0.0.1';
  process.env.ESC_POS_PRINTER_PORT = '70000';
  try {
    await assert.rejects(
      sendEscPosReceipt(Buffer.from('test')),
      (error: unknown) => error instanceof ReceiptPrinterError && error.code === 'invalid_config'
    );
  } finally {
    if (previousHost === undefined) delete process.env.ESC_POS_PRINTER_HOST;
    else process.env.ESC_POS_PRINTER_HOST = previousHost;
    if (previousPort === undefined) delete process.env.ESC_POS_PRINTER_PORT;
    else process.env.ESC_POS_PRINTER_PORT = previousPort;
  }
});

test('sends a complete receipt to the configured LAN/Wi-Fi TCP printer', async () => {
  const previousEscPosHost = process.env.ESC_POS_PRINTER_HOST;
  const previousEscPosPort = process.env.ESC_POS_PRINTER_PORT;
  const previousHost = process.env.EPSON_PRINTER_HOST;
  const previousPort = process.env.EPSON_PRINTER_PORT;
  const server = createServer();
  const received = new Promise<Buffer>((resolve) => {
    server.once('connection', (socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    process.env.ESC_POS_PRINTER_HOST = '127.0.0.1';
    process.env.ESC_POS_PRINTER_PORT = String(address.port);

    await sendEscPosReceipt(Buffer.from('RECEIPT #7'));
    assert.equal((await received).toString('utf8'), 'RECEIPT #7');
  } finally {
    if (previousEscPosHost === undefined) delete process.env.ESC_POS_PRINTER_HOST;
    else process.env.ESC_POS_PRINTER_HOST = previousEscPosHost;
    if (previousEscPosPort === undefined) delete process.env.ESC_POS_PRINTER_PORT;
    else process.env.ESC_POS_PRINTER_PORT = previousEscPosPort;
    if (previousHost === undefined) delete process.env.EPSON_PRINTER_HOST;
    else process.env.EPSON_PRINTER_HOST = previousHost;
    if (previousPort === undefined) delete process.env.EPSON_PRINTER_PORT;
    else process.env.EPSON_PRINTER_PORT = previousPort;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sends using the supplied TCP printer configuration', async () => {
  const server = createServer();
  const received = new Promise<Buffer>((resolve) => {
    server.once('connection', (socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await sendEscPosReceipt(Buffer.from('TERMINAL RECEIPT'), {
      host: '127.0.0.1',
      port: address.port,
    });
    assert.equal((await received).toString('utf8'), 'TERMINAL RECEIPT');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('continues supporting the legacy Epson TCP printer settings', async () => {
  const previousEscPosHost = process.env.ESC_POS_PRINTER_HOST;
  const previousEscPosPort = process.env.ESC_POS_PRINTER_PORT;
  const previousHost = process.env.EPSON_PRINTER_HOST;
  const previousPort = process.env.EPSON_PRINTER_PORT;
  const server = createServer();
  const received = new Promise<Buffer>((resolve) => {
    server.once('connection', (socket) => {
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks)));
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    delete process.env.ESC_POS_PRINTER_HOST;
    delete process.env.ESC_POS_PRINTER_PORT;
    process.env.EPSON_PRINTER_HOST = '127.0.0.1';
    process.env.EPSON_PRINTER_PORT = String(address.port);

    await sendEscPosReceipt(Buffer.from('LEGACY RECEIPT'));
    assert.equal((await received).toString('utf8'), 'LEGACY RECEIPT');
  } finally {
    if (previousEscPosHost === undefined) delete process.env.ESC_POS_PRINTER_HOST;
    else process.env.ESC_POS_PRINTER_HOST = previousEscPosHost;
    if (previousEscPosPort === undefined) delete process.env.ESC_POS_PRINTER_PORT;
    else process.env.ESC_POS_PRINTER_PORT = previousEscPosPort;
    if (previousHost === undefined) delete process.env.EPSON_PRINTER_HOST;
    else process.env.EPSON_PRINTER_HOST = previousHost;
    if (previousPort === undefined) delete process.env.EPSON_PRINTER_PORT;
    else process.env.EPSON_PRINTER_PORT = previousPort;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

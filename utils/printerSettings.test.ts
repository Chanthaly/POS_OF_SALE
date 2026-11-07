import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePrinterInput } from './printerSettings.js';

test('parses USB printers without an IP address', () => {
  assert.deepEqual(parsePrinterInput({
    printer_name: 'Front counter',
    printer_type: 'thermal',
    connection_type: 'usb',
  }), {
    printerName: 'Front counter',
    printerType: 'thermal',
    connectionType: 'usb',
    ipAddress: null,
  });
});

test('parses Wi-Fi and LAN printers with IPv4 or IPv6 addresses', () => {
  assert.equal(parsePrinterInput({
    printer_name: 'Kitchen',
    printer_type: 'thermal',
    connection_type: 'wifi',
    ip_address: '192.168.1.20',
  })?.ipAddress, '192.168.1.20');
  assert.equal(parsePrinterInput({
    printer_name: 'Office',
    printer_type: 'laser',
    connection_type: 'lan',
    ip_address: '2001:db8::1',
  })?.ipAddress, '2001:db8::1');
});

test('rejects invalid names, printer types, connection types, and IP addresses', () => {
  const valid = {
    printer_name: 'Receipt printer',
    printer_type: 'thermal',
    connection_type: 'lan',
    ip_address: '192.168.1.20',
  };
  assert.equal(parsePrinterInput({ ...valid, printer_name: ' ' }), null);
  assert.equal(parsePrinterInput({ ...valid, printer_name: 'p'.repeat(101) }), null);
  assert.equal(parsePrinterInput({ ...valid, printer_type: 'dot_matrix' }), null);
  assert.equal(parsePrinterInput({ ...valid, connection_type: 'bluetooth' }), null);
  assert.equal(parsePrinterInput({ ...valid, ip_address: 'printer.local' }), null);
  assert.equal(parsePrinterInput({ ...valid, connection_type: 'usb' }), null);
});

# Branch printer inventory and receipt printing

Apply `db/printer-schema.sql` to create the branch-level printer inventory.
The authenticated inventory endpoints are:

- `GET /api/printers?bran_id=1`
- `GET /api/printers/:printer_id`
- `POST /api/printers`
- `PUT /api/printers/:printer_id`
- `DELETE /api/printers/:printer_id`

Create requests accept `bran_id`, `printer_name`, `printer_type`,
`connection_type`, and `ip_address`:

```json
{
  "bran_id": 1,
  "printer_name": "Front counter",
  "printer_type": "thermal",
  "connection_type": "wifi",
  "ip_address": "192.168.1.50"
}
```

`printer_type` can be `thermal`, `laser`, or `inkjet`. `connection_type` can be
`usb`, `wifi`, or `lan`. USB inventory entries have no IP address. Wi-Fi and
LAN entries require an IPv4 or IPv6 address. Non-superusers use their company
from the login token; superusers must send `company_id` in query parameters or
the request body. Managers, cashiers, and staff are restricted to their
assigned branch.

Sales and reprint endpoints use `@node-escpos/core` with its network adapter to
send ESC/POS data over TCP. They select the
lowest-ID thermal Wi-Fi/LAN printer registered for the sale's branch, using
TCP port `9100`. The POS server must be able to reach that address through its
local network and firewall. If no compatible inventory printer exists, the
server-wide `ESC_POS_PRINTER_HOST` / `ESC_POS_PRINTER_PORT` or
`EPSON_PRINTER_HOST` / `EPSON_PRINTER_PORT` settings remain available as a
fallback.

USB printers can be registered as inventory, but USB receipt printing from a
cashier's computer is not implemented in this backend. It requires a local
printing bridge on that computer.

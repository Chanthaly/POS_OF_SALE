CREATE TABLE IF NOT EXISTS printers (
  printer_id INT NOT NULL AUTO_INCREMENT,
  printer_name VARCHAR(100) NOT NULL,
  printer_type ENUM('thermal', 'laser', 'inkjet') NOT NULL,
  connection_type ENUM('usb', 'wifi', 'lan') NOT NULL,
  ip_address VARCHAR(45) NULL,
  bran_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (printer_id),
  KEY idx_printers_branch (bran_id),
  CONSTRAINT fk_printers_branch
    FOREIGN KEY (bran_id) REFERENCES branc (bran_id),
  CONSTRAINT chk_printer_connection_address CHECK (
    (connection_type = 'usb' AND ip_address IS NULL)
    OR (connection_type IN ('wifi', 'lan') AND ip_address IS NOT NULL)
  )
);

-- Upgrade the legacy sales tables (invoice_no, final_amount) to the current sale API schema.
-- Run once, after taking a database backup.
ALTER TABLE sales
  MODIFY COLUMN invoice_no VARCHAR(50) NULL,
  ADD COLUMN company_id INT NULL AFTER sale_id,
  ADD COLUMN subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER user_id,
  ADD COLUMN discount_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER subtotal,
  ADD COLUMN discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER discount_rate,
  ADD COLUMN taxable_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER discount_amount,
  ADD COLUMN vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER taxable_amount,
  ADD COLUMN idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN idempotency_hash CHAR(64) NULL,
  ADD COLUMN idempotency_response JSON NULL;

UPDATE sales s
INNER JOIN branc b ON b.bran_id = s.bran_id
SET s.company_id = b.company_id,
    s.subtotal = COALESCE(s.total_amount, 0.00),
    s.discount_amount = COALESCE(s.discount, 0.00),
    s.taxable_amount = GREATEST(COALESCE(s.final_amount, 0.00) - COALESCE(s.vat_amount, 0.00), 0.00),
    s.discount_rate = CASE
      WHEN COALESCE(s.total_amount, 0.00) > 0
      THEN ROUND(COALESCE(s.discount, 0.00) * 100 / s.total_amount, 2)
      ELSE 0.00
    END,
    s.vat_rate = CASE
      WHEN GREATEST(COALESCE(s.final_amount, 0.00) - COALESCE(s.vat_amount, 0.00), 0.00) > 0
      THEN ROUND(COALESCE(s.vat_amount, 0.00) * 100 /
        GREATEST(s.final_amount - COALESCE(s.vat_amount, 0.00), 0.00), 2)
      ELSE 0.00
    END;

ALTER TABLE sales
  MODIFY COLUMN company_id INT NOT NULL,
  MODIFY COLUMN vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD KEY idx_sales_company_date (company_id, created_at),
  ADD KEY idx_sales_branch_date (bran_id, created_at),
  ADD UNIQUE KEY uq_sales_user_idempotency (user_id, idempotency_key),
  ADD CONSTRAINT fk_sales_company
    FOREIGN KEY (company_id) REFERENCES company (company_id);

ALTER TABLE sale_items
  ADD COLUMN sale_unit ENUM('item', 'pack') NOT NULL DEFAULT 'item',
  ADD COLUMN stock_quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN line_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  MODIFY COLUMN vat_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  MODIFY COLUMN vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00;

CREATE TABLE IF NOT EXISTS stock_movements (
  movement_id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  p_id INT NOT NULL,
  user_id INT NOT NULL,
  quantity_change INT NOT NULL,
  stock_before INT NOT NULL,
  stock_after INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stock_movements_sale (sale_id),
  KEY idx_stock_movements_product_date (p_id, created_at),
  CONSTRAINT fk_stock_movements_sale
    FOREIGN KEY (sale_id) REFERENCES sales (sale_id),
  CONSTRAINT fk_stock_movements_product
    FOREIGN KEY (p_id) REFERENCES product (p_id),
  CONSTRAINT fk_stock_movements_user
    FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT chk_stock_movements_change
    CHECK (quantity_change <> 0 AND stock_before >= 0 AND stock_after >= 0
      AND stock_before + quantity_change = stock_after)
);

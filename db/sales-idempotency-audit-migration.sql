ALTER TABLE sales
  ADD COLUMN idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN idempotency_hash CHAR(64) NULL,
  ADD COLUMN idempotency_response JSON NULL,
  ADD UNIQUE KEY uq_sales_user_idempotency (user_id, idempotency_key);

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

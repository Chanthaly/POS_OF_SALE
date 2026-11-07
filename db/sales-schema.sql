-- Apply customer-loyalty-schema.sql before creating sales so its customer FK is available.
CREATE TABLE IF NOT EXISTS sales (
  sale_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  bran_id INT NOT NULL,
  user_id INT NOT NULL,
  customer_id INT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  discount_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  taxable_amount DECIMAL(12, 2) NOT NULL,
  vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  vat_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(12, 2) NOT NULL,
  idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_hash CHAR(64) NULL,
  idempotency_response JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sales_company_date (company_id, created_at),
  KEY idx_sales_branch_date (bran_id, created_at),
  KEY idx_sales_customer_company_date (customer_id, company_id, created_at),
  UNIQUE KEY uq_sales_user_idempotency (user_id, idempotency_key),
  CONSTRAINT fk_sales_company
    FOREIGN KEY (company_id) REFERENCES company (company_id),
  CONSTRAINT fk_sales_branch
    FOREIGN KEY (bran_id) REFERENCES branc (bran_id),
  CONSTRAINT fk_sales_user
    FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_sales_customer_company
    FOREIGN KEY (customer_id, company_id) REFERENCES customers (customer_id, company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_sales_amounts
    CHECK (subtotal >= 0 AND discount_amount >= 0 AND taxable_amount >= 0
      AND vat_amount >= 0 AND total_amount >= 0),
  CONSTRAINT chk_sales_rates
    CHECK (discount_rate >= 0 AND discount_rate <= 100 AND vat_rate >= 0 AND vat_rate <= 100)
);

CREATE TABLE IF NOT EXISTS sale_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  p_id INT NOT NULL,
  sale_unit ENUM('item', 'pack') NOT NULL,
  quantity INT NOT NULL,
  stock_quantity INT NOT NULL,
  price_per_unit DECIMAL(12, 2) NOT NULL,
  line_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  total_item_amount DECIMAL(12, 2) NOT NULL,
  vat_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  KEY idx_sale_items_sale_id (sale_id),
  KEY idx_sale_items_product_id (p_id),
  CONSTRAINT fk_sale_items_sale
    FOREIGN KEY (sale_id) REFERENCES sales (sale_id),
  CONSTRAINT fk_sale_items_product
    FOREIGN KEY (p_id) REFERENCES product (p_id),
  CONSTRAINT chk_sale_items_quantity
    CHECK (quantity > 0 AND stock_quantity > 0),
  CONSTRAINT chk_sale_items_amounts
    CHECK (price_per_unit >= 0 AND line_discount_amount >= 0
      AND total_item_amount >= 0 AND vat_amount >= 0),
  CONSTRAINT chk_sale_items_vat_rate
    CHECK (vat_rate >= 0 AND vat_rate <= 100)
);

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

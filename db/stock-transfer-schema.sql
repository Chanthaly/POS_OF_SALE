CREATE TABLE product_size (
  product_size_id INT AUTO_INCREMENT PRIMARY KEY,
  size_value DECIMAL(10, 3) NOT NULL,
  size_unit VARCHAR(8) NOT NULL,
  UNIQUE KEY uq_product_size_value_unit (size_value, size_unit),
  CONSTRAINT chk_product_size_value CHECK (size_value > 0),
  CONSTRAINT chk_product_size_unit CHECK (size_unit IN ('ml', 'l', 'mm'))
);

CREATE TABLE product (
  p_id INT AUTO_INCREMENT PRIMARY KEY,
  p_name VARCHAR(50) NOT NULL,
  p_code VARCHAR(60) NOT NULL,
  p_img VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bran_id INT NOT NULL,
  pty_id INT NOT NULL,
  items_per_pack INT NOT NULL DEFAULT 24,
  product_size_id INT NULL,
  UNIQUE KEY uq_product_branch_code (bran_id, p_code),
  KEY idx_product_size (product_size_id),
  CONSTRAINT fk_product_size FOREIGN KEY (product_size_id) REFERENCES product_size (product_size_id),
  CONSTRAINT fk_product_branch FOREIGN KEY (bran_id) REFERENCES branc (bran_id)
);

CREATE TABLE p_stock (
  stock_id INT AUTO_INCREMENT PRIMARY KEY,
  stock_amount INT NOT NULL DEFAULT 0,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  p_id INT NOT NULL,
  UNIQUE KEY uq_p_stock_product (p_id),
  CONSTRAINT fk_p_stock_user FOREIGN KEY (user_id) REFERENCES users (user_id),
  CONSTRAINT fk_p_stock_product FOREIGN KEY (p_id) REFERENCES product (p_id),
  CONSTRAINT chk_p_stock_amount CHECK (stock_amount >= 0)
);

CREATE TABLE p_type (
  Ptype_id INT AUTO_INCREMENT PRIMARY KEY,
  Ptype_name VARCHAR(34) NOT NULL,
  p_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_p_type_product FOREIGN KEY (p_id) REFERENCES product (p_id)
);

CREATE TABLE p_price (
  price_id INT AUTO_INCREMENT PRIMARY KEY,
  p_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost_price_item DECIMAL(10, 2) NOT NULL,
  cost_price_pack DECIMAL(10, 2) NOT NULL,
  sale_price_pack DECIMAL(10, 2) NOT NULL,
  sale_price_items DECIMAL(10, 2) NOT NULL,
  CONSTRAINT fk_p_price_product FOREIGN KEY (p_id) REFERENCES product (p_id),
  CONSTRAINT chk_p_price_cost_item CHECK (cost_price_item >= 0),
  CONSTRAINT chk_p_price_cost_pack CHECK (cost_price_pack >= 0),
  CONSTRAINT chk_p_price_sale_pack CHECK (sale_price_pack >= 0),
  CONSTRAINT chk_p_price_sale_items CHECK (sale_price_items >= 0)
);

CREATE TABLE st_transfers (
  tr_id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_no VARCHAR(60) NOT NULL UNIQUE,
  from_branch_id INT NOT NULL,
  to_branch_id INT NOT NULL,
  transferred_by INT NOT NULL,
  received_by INT NULL,
  status ENUM('panding', 'in_transit', 'received', 'cancelled') NOT NULL DEFAULT 'panding',
  transfer_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note_dct VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transfer_from_branch FOREIGN KEY (from_branch_id) REFERENCES branc (bran_id),
  CONSTRAINT fk_transfer_to_branch FOREIGN KEY (to_branch_id) REFERENCES branc (bran_id),
  CONSTRAINT fk_transfer_sender FOREIGN KEY (transferred_by) REFERENCES users (user_id),
  CONSTRAINT fk_transfer_receiver FOREIGN KEY (received_by) REFERENCES users (user_id)
);

CREATE TABLE IF NOT EXISTS st_transfer_daily_sequence (
  transfer_day DATE PRIMARY KEY,
  last_number INT UNSIGNED NOT NULL
);

CREATE TABLE st_transers_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  received_quantity INT NOT NULL DEFAULT 0,
  note VARCHAR(40) NULL,
  CONSTRAINT fk_transfer_item_transfer FOREIGN KEY (transfer_id) REFERENCES st_transfers (tr_id) ON DELETE CASCADE,
  CONSTRAINT fk_transfer_item_product FOREIGN KEY (product_id) REFERENCES product (p_id),
  CONSTRAINT chk_transfer_item_quantity CHECK (quantity > 0),
  UNIQUE KEY uq_transfer_product (transfer_id, product_id)
);
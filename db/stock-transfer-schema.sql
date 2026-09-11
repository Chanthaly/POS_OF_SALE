CREATE TABLE product (
  p_id INT AUTO_INCREMENT PRIMARY KEY,
  p_name VARCHAR(50) NOT NULL,
  p_code VARCHAR(60) NOT NULL,
  p_img VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bran_id INT NOT NULL,
  pty_id INT NOT NULL,
  UNIQUE KEY uq_product_branch_code (bran_id, p_code),
  CONSTRAINT fk_product_branch FOREIGN KEY (bran_id) REFERENCES branc (bran_id)
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
  note VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transfer_from_branch FOREIGN KEY (from_branch_id) REFERENCES branc (bran_id),
  CONSTRAINT fk_transfer_to_branch FOREIGN KEY (to_branch_id) REFERENCES branc (bran_id),
  CONSTRAINT fk_transfer_sender FOREIGN KEY (transferred_by) REFERENCES users (user_id),
  CONSTRAINT fk_transfer_receiver FOREIGN KEY (received_by) REFERENCES users (user_id)
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
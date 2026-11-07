CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  phone_number VARCHAR(30) NOT NULL,
  email VARCHAR(254) NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customers_company_phone (company_id, phone_number),
  UNIQUE KEY uq_customers_id_company (customer_id, company_id),
  CONSTRAINT fk_customers_company
    FOREIGN KEY (company_id) REFERENCES company (company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS loyalty_programs (
  program_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  earn_amount DECIMAL(15, 2) NOT NULL DEFAULT 10000.00,
  earn_points INT NOT NULL DEFAULT 1,
  minimum_purchase DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_programs_company (company_id),
  CONSTRAINT fk_loyalty_programs_company
    FOREIGN KEY (company_id) REFERENCES company (company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_loyalty_program_earn_amount CHECK (earn_amount > 0),
  CONSTRAINT chk_loyalty_program_earn_points CHECK (earn_points > 0),
  CONSTRAINT chk_loyalty_program_minimum_purchase CHECK (minimum_purchase >= 0)
);

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  reward_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  product_id INT NULL,
  reward_name VARCHAR(150) NOT NULL,
  reward_type ENUM('discount', 'product') NOT NULL,
  points_cost INT NOT NULL,
  discount_amount DECIMAL(15, 2) NULL,
  stock_quantity INT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_rewards_id_company (reward_id, company_id),
  KEY idx_loyalty_rewards_company_status (company_id, status),
  CONSTRAINT fk_loyalty_rewards_company
    FOREIGN KEY (company_id) REFERENCES company (company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_rewards_product
    FOREIGN KEY (product_id) REFERENCES product (p_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_loyalty_rewards_points_cost CHECK (points_cost > 0),
  CONSTRAINT chk_loyalty_rewards_stock CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  CONSTRAINT chk_loyalty_rewards_value CHECK (
    (reward_type = 'discount' AND discount_amount IS NOT NULL AND discount_amount > 0 AND product_id IS NULL)
    OR (reward_type = 'product' AND discount_amount IS NULL AND product_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  transaction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  customer_id INT NOT NULL,
  bran_id INT NULL,
  user_id INT NULL,
  transaction_type ENUM('earn', 'redeem', 'adjustment', 'expiry', 'reversal') NOT NULL,
  points_change INT NOT NULL,
  purchase_amount DECIMAL(15, 2) NULL,
  reference_type VARCHAR(30) NULL,
  reference_id BIGINT NULL,
  idempotency_key VARCHAR(100) NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_transactions_company_idempotency (company_id, idempotency_key),
  UNIQUE KEY uq_loyalty_transactions_id_company_customer (transaction_id, company_id, customer_id),
  KEY idx_loyalty_transactions_customer_date (company_id, customer_id, created_at),
  KEY idx_loyalty_transactions_reference (company_id, reference_type, reference_id),
  CONSTRAINT fk_loyalty_transactions_customer
    FOREIGN KEY (customer_id, company_id) REFERENCES customers (customer_id, company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_transactions_company
    FOREIGN KEY (company_id) REFERENCES company (company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_transactions_branch
    FOREIGN KEY (bran_id) REFERENCES branc (bran_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_transactions_user
    FOREIGN KEY (user_id) REFERENCES users (user_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_loyalty_transactions_points CHECK (points_change <> 0),
  CONSTRAINT chk_loyalty_transactions_direction CHECK (
    (transaction_type = 'earn' AND points_change > 0)
    OR (transaction_type IN ('redeem', 'expiry') AND points_change < 0)
    OR transaction_type IN ('adjustment', 'reversal')
  ),
  CONSTRAINT chk_loyalty_transactions_purchase_amount
    CHECK (purchase_amount IS NULL OR purchase_amount >= 0)
);

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  redemption_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  customer_id INT NOT NULL,
  reward_id INT NOT NULL,
  points_transaction_id BIGINT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  points_spent INT NOT NULL,
  redemption_code VARCHAR(64) NULL,
  status ENUM('issued', 'fulfilled', 'cancelled') NOT NULL DEFAULT 'issued',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  UNIQUE KEY uq_loyalty_redemptions_transaction (points_transaction_id),
  UNIQUE KEY uq_loyalty_redemptions_company_code (company_id, redemption_code),
  KEY idx_loyalty_redemptions_customer_date (company_id, customer_id, created_at),
  CONSTRAINT fk_loyalty_redemptions_customer
    FOREIGN KEY (customer_id, company_id) REFERENCES customers (customer_id, company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_redemptions_reward
    FOREIGN KEY (reward_id, company_id) REFERENCES loyalty_rewards (reward_id, company_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_redemptions_points_transaction
    FOREIGN KEY (points_transaction_id, company_id, customer_id)
    REFERENCES loyalty_transactions (transaction_id, company_id, customer_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_loyalty_redemptions_quantity CHECK (quantity > 0),
  CONSTRAINT chk_loyalty_redemptions_points_spent CHECK (points_spent > 0)
);

INSERT INTO loyalty_programs (company_id)
SELECT company_id
FROM company
ON DUPLICATE KEY UPDATE company_id = loyalty_programs.company_id;

CREATE TABLE IF NOT EXISTS product_size (
  product_size_id INT AUTO_INCREMENT PRIMARY KEY,
  size_value DECIMAL(10, 3) NOT NULL,
  size_unit VARCHAR(8) NOT NULL,
  UNIQUE KEY uq_product_size_value_unit (size_value, size_unit),
  CONSTRAINT chk_product_size_value CHECK (size_value > 0),
  CONSTRAINT chk_product_size_unit CHECK (size_unit IN ('ml', 'l', 'mm'))
);

INSERT INTO product_size (size_value, size_unit)
VALUES (12, 'ml'), (1, 'l'), (80, 'mm')
ON DUPLICATE KEY UPDATE size_value = VALUES(size_value);

SET @product_size_id_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product'
    AND COLUMN_NAME = 'product_size_id'
);

SET @add_product_size_id_sql = IF(
  @product_size_id_exists = 0,
  'ALTER TABLE product ADD COLUMN product_size_id INT NULL, ADD INDEX idx_product_size (product_size_id)',
  'SELECT 1'
);

PREPARE add_product_size_id_statement FROM @add_product_size_id_sql;
EXECUTE add_product_size_id_statement;
DEALLOCATE PREPARE add_product_size_id_statement;

SET @product_size_fk_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product'
    AND COLUMN_NAME = 'product_size_id'
    AND REFERENCED_TABLE_NAME = 'product_size'
);

SET @add_product_size_fk_sql = IF(
  @product_size_fk_exists = 0,
  'ALTER TABLE product ADD CONSTRAINT fk_product_size FOREIGN KEY (product_size_id) REFERENCES product_size (product_size_id)',
  'SELECT 1'
);

PREPARE add_product_size_fk_statement FROM @add_product_size_fk_sql;
EXECUTE add_product_size_fk_statement;
DEALLOCATE PREPARE add_product_size_fk_statement;

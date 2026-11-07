SET @items_per_pack_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'product'
    AND COLUMN_NAME = 'items_per_pack'
);

SET @add_items_per_pack_sql = IF(
  @items_per_pack_exists = 0,
  'ALTER TABLE product ADD COLUMN items_per_pack INT NOT NULL DEFAULT 24',
  'SELECT 1'
);

PREPARE add_items_per_pack_statement FROM @add_items_per_pack_sql;
EXECUTE add_items_per_pack_statement;
DEALLOCATE PREPARE add_items_per_pack_statement;

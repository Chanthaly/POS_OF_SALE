-- Run after customer-loyalty-schema.sql. Safe to rerun; existing sales remain unassigned.
SET @sales_customer_schema = DATABASE();

SET @sales_customer_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @sales_customer_schema
     AND TABLE_NAME = 'sales'
     AND COLUMN_NAME = 'customer_id') = 0,
  'ALTER TABLE sales ADD COLUMN customer_id INT NULL AFTER user_id',
  'SELECT ''sales.customer_id already exists'' AS migration_status'
);
PREPARE sales_customer_stmt FROM @sales_customer_ddl;
EXECUTE sales_customer_stmt;
DEALLOCATE PREPARE sales_customer_stmt;

SET @sales_customer_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @sales_customer_schema
     AND TABLE_NAME = 'sales'
     AND INDEX_NAME = 'idx_sales_customer_company_date') = 0,
  'ALTER TABLE sales ADD KEY idx_sales_customer_company_date (customer_id, company_id, created_at)',
  'SELECT ''idx_sales_customer_company_date already exists'' AS migration_status'
);
PREPARE sales_customer_stmt FROM @sales_customer_ddl;
EXECUTE sales_customer_stmt;
DEALLOCATE PREPARE sales_customer_stmt;

SET @sales_customer_ddl = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @sales_customer_schema
     AND TABLE_NAME = 'sales'
     AND CONSTRAINT_NAME = 'fk_sales_customer_company'
     AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 0,
  'ALTER TABLE sales ADD CONSTRAINT fk_sales_customer_company
   FOREIGN KEY (customer_id, company_id) REFERENCES customers (customer_id, company_id)
   ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT ''fk_sales_customer_company already exists'' AS migration_status'
);
PREPARE sales_customer_stmt FROM @sales_customer_ddl;
EXECUTE sales_customer_stmt;
DEALLOCATE PREPARE sales_customer_stmt;

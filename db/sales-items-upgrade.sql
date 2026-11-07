ALTER TABLE sale_items
  ADD COLUMN sale_unit ENUM('item', 'pack') NOT NULL DEFAULT 'item',
  ADD COLUMN stock_quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN line_discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD CONSTRAINT fk_sale_items_sale
    FOREIGN KEY (sale_id) REFERENCES sales (sale_id);

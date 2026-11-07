CREATE TABLE IF NOT EXISTS tax (
    tax_id INT AUTO_INCREMENT PRIMARY KEY,
    company_id INT NOT NULL,
    tax_name VARCHAR(100) NOT NULL,
    tax_code VARCHAR(50) NULL,
    tax_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    tax_type ENUM('VAT', 'NO_TAX', 'OTHER') NOT NULL DEFAULT 'VAT',
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    status TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tax_company
        FOREIGN KEY (company_id)
        REFERENCES company(company_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT chk_tax_rate
        CHECK (tax_rate >= 0 AND tax_rate <= 100),
    INDEX idx_tax_company (company_id),
    INDEX idx_tax_status (company_id, status)
);

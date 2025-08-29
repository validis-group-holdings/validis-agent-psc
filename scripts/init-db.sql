-- Create validis_dev database
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'validis_dev')
BEGIN
    CREATE DATABASE validis_dev;
END
GO

USE validis_dev;
GO

-- Create upload table (core table for all queries)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'upload')
BEGIN
    CREATE TABLE dbo.upload (
        upload_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        client_id VARCHAR(100) NOT NULL,
        company_id VARCHAR(100) NOT NULL,
        upload_date DATETIME DEFAULT GETDATE(),
        creation_date DATETIME DEFAULT GETDATE(),
        status VARCHAR(50) DEFAULT 'COMPLETED',
        period_start DATE,
        period_end DATE,
        upload_type VARCHAR(50),
        created_by VARCHAR(100),
        CONSTRAINT idx_upload_client_date CLUSTERED (upload_id, client_id, creation_date DESC)
    );
    
    -- Create indexes for performance
    CREATE NONCLUSTERED INDEX idx_upload_client ON dbo.upload(client_id);
    CREATE NONCLUSTERED INDEX idx_upload_status ON dbo.upload(status);
    CREATE NONCLUSTERED INDEX idx_upload_date ON dbo.upload(creation_date DESC);
END
GO

-- Create journal_entries table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'journal_entries')
BEGIN
    CREATE TABLE dbo.journal_entries (
        entry_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        upload_id UNIQUEIDENTIFIER NOT NULL,
        entry_date DATETIME,
        account_code VARCHAR(50),
        account_name VARCHAR(200),
        description VARCHAR(500),
        amount DECIMAL(18,2),
        debit DECIMAL(18,2),
        credit DECIMAL(18,2),
        created_by VARCHAR(100),
        created_date DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (upload_id) REFERENCES dbo.upload(upload_id)
    );
    
    CREATE NONCLUSTERED INDEX idx_je_upload ON dbo.journal_entries(upload_id);
    CREATE NONCLUSTERED INDEX idx_je_amount ON dbo.journal_entries(amount);
END
GO

-- Create company table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'company')
BEGIN
    CREATE TABLE dbo.company (
        company_id VARCHAR(100) PRIMARY KEY,
        upload_id UNIQUEIDENTIFIER NOT NULL,
        client_id VARCHAR(100) NOT NULL,
        company_name VARCHAR(200),
        industry VARCHAR(100),
        fiscal_year_end DATE,
        created_date DATETIME DEFAULT GETDATE(),
        FOREIGN KEY (upload_id) REFERENCES dbo.upload(upload_id)
    );
    
    CREATE NONCLUSTERED INDEX idx_company_upload ON dbo.company(upload_id);
    CREATE NONCLUSTERED INDEX idx_company_client ON dbo.company(client_id);
END
GO

-- Create trial_balance table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'trial_balance')
BEGIN
    CREATE TABLE dbo.trial_balance (
        tb_id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        upload_id UNIQUEIDENTIFIER NOT NULL,
        account_code VARCHAR(50),
        account_name VARCHAR(200),
        account_type VARCHAR(50),
        beginning_balance DECIMAL(18,2),
        debit_movement DECIMAL(18,2),
        credit_movement DECIMAL(18,2),
        ending_balance DECIMAL(18,2),
        period_date DATE,
        FOREIGN KEY (upload_id) REFERENCES dbo.upload(upload_id)
    );
    
    CREATE NONCLUSTERED INDEX idx_tb_upload ON dbo.trial_balance(upload_id);
END
GO

-- Insert test data
-- Test clients
INSERT INTO dbo.upload (client_id, company_id, status, period_start, period_end, upload_type)
VALUES 
    ('test-client-001', 'COMP001', 'COMPLETED', '2024-01-01', '2024-12-31', 'ANNUAL'),
    ('test-client-001', 'COMP002', 'COMPLETED', '2024-01-01', '2024-12-31', 'ANNUAL'),
    ('test-client-002', 'COMP003', 'COMPLETED', '2024-01-01', '2024-12-31', 'ANNUAL');
GO

-- Insert test companies
INSERT INTO dbo.company (company_id, upload_id, client_id, company_name, industry)
SELECT 
    'COMP001', upload_id, 'test-client-001', 'Acme Corporation', 'Manufacturing'
FROM dbo.upload 
WHERE company_id = 'COMP001' AND client_id = 'test-client-001';

INSERT INTO dbo.company (company_id, upload_id, client_id, company_name, industry)
SELECT 
    'COMP002', upload_id, 'test-client-001', 'Beta Industries', 'Technology'
FROM dbo.upload 
WHERE company_id = 'COMP002' AND client_id = 'test-client-001';

INSERT INTO dbo.company (company_id, upload_id, client_id, company_name, industry)
SELECT 
    'COMP003', upload_id, 'test-client-002', 'Gamma Services', 'Consulting'
FROM dbo.upload 
WHERE company_id = 'COMP003' AND client_id = 'test-client-002';
GO

-- Insert sample journal entries
INSERT INTO dbo.journal_entries (upload_id, entry_date, account_code, account_name, description, amount, debit, credit)
SELECT 
    upload_id, 
    '2024-06-15', 
    '1000', 
    'Cash', 
    'Customer payment received', 
    10000.00,
    10000.00,
    0
FROM dbo.upload 
WHERE company_id = 'COMP001';

INSERT INTO dbo.journal_entries (upload_id, entry_date, account_code, account_name, description, amount, debit, credit)
SELECT 
    upload_id, 
    '2024-06-30', 
    '5000', 
    'Revenue', 
    'Monthly sales revenue', 
    25000.00,
    0,
    25000.00
FROM dbo.upload 
WHERE company_id = 'COMP001';
GO

PRINT 'Database initialization completed successfully';
# Database Schema Reference

## IMPORTANT: Use these actual table names, not made-up ones!

## Core Tables

### upload
- Primary key: upload_id (UNIQUEIDENTIFIER)
- Key field: client_id (VARCHAR(36)) - CRITICAL for data isolation
- All queries MUST filter by client_id through this table

### company
- Primary key: uploadId
- Links to: upload, currency, country
- Contains company registration and contact details

### account
- Primary key: uploadId, id
- Contains chart of accounts
- Fields: code, name, primaryCategoryId, currencyId, opening, closing

## Transaction Tables

### transactionHeader
- Primary key: uploadId, id
- Contains: transactionDate, description, financialPeriodId, transactionTypeId
- NOT "journal_entries" - use transactionHeader!

### transactionLine
- Primary key: uploadId, id
- Links to: transactionHeader (headerId), account (accountId)
- Contains: baseValue, transactionValue, reportingValue

## Sales (AR) Tables

### saleHeader
- Sales invoice headers
- Links to: upload, customer

### saleLine
- Sales invoice line items
- Links to: saleHeader

### saleTx
- Sales transactions

### saleAged
- Aged receivables analysis

## Purchase (AP) Tables

### purchaseHeader
- Purchase invoice headers
- Links to: upload, supplier

### purchaseLine
- Purchase invoice line items
- Links to: purchaseHeader

### purchaseTx
- Purchase transactions

### purchaseAged
- Aged payables analysis

## Customer & Supplier Tables

### customer
- Customer master data

### supplier
- Supplier master data

## Financial Period Tables

### financialYear
- Primary key: uploadId, id
- Contains: yearNumber, startDate, endDate

### financialPeriod
- Primary key: uploadId, id
- Links to: financialYear
- Contains: periodNumber, startDate, endDate, statusId

## Reference Tables

### currency
- id, code, name

### country
- id, code, name

### tax
- Tax codes and rates

### transactionType
- Types: Journal Entry, Invoice, Payment, Credit Note

### primaryCategory
- Categories: Asset, Liability, Equity, Revenue, Expense

## CRITICAL RULES

1. **NEVER use "journal_entries"** - use transactionHeader instead
2. **ALWAYS join through upload table** for client_id filtering
3. **Use actual column names** - check schema before writing queries
4. **AR data is in sale* tables**, not "receivables"
5. **AP data is in purchase* tables**, not "payables"
6. **Trial balance is NOT a table** - it's calculated from transactionLine

## Common Query Patterns

### Get transactions with client isolation:
```sql
SELECT th.* 
FROM transactionHeader th
INNER JOIN upload u ON th.uploadId = u.upload_id
WHERE u.client_id = @clientId
```

### Get sales invoices:
```sql
SELECT sh.*
FROM saleHeader sh
INNER JOIN upload u ON sh.uploadId = u.upload_id
WHERE u.client_id = @clientId
```

### Get purchase invoices:
```sql
SELECT ph.*
FROM purchaseHeader ph
INNER JOIN upload u ON ph.uploadId = u.upload_id
WHERE u.client_id = @clientId
```

### Get account balances:
```sql
SELECT 
  a.code,
  a.name,
  a.opening,
  a.closing
FROM account a
INNER JOIN upload u ON a.uploadId = u.upload_id
WHERE u.client_id = @clientId
```
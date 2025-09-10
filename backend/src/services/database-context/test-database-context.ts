import { databaseContextManager } from "./index";
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

/**
 * Mock database schema for testing when no database connection is available
 */
export function getMockDatabaseSchema() {
  return {
    tables: new Map([
      ['dbo.upload', {
        tableName: 'upload',
        schemaName: 'dbo',
        columns: [
          { columnName: 'upload_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'client_id', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'sme_id', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'company_name', dataType: 'nvarchar', maxLength: 255, isNullable: false },
          { columnName: 'upload_date', dataType: 'datetime', isNullable: false },
          { columnName: 'financial_period_id', dataType: 'int', isNullable: true },
          { columnName: 'status', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'created_date', dataType: 'datetime', isNullable: false },
          { columnName: 'created_by', dataType: 'nvarchar', maxLength: 100, isNullable: true }
        ],
        primaryKeys: ['upload_id'],
        foreignKeys: [],
        indexes: [
          { indexName: 'PK_upload', tableName: 'dbo.upload', columns: ['upload_id'], isUnique: true, isClustered: true, isPrimaryKey: true },
          { indexName: 'IX_upload_client_sme', tableName: 'dbo.upload', columns: ['client_id', 'sme_id'], isUnique: false, isClustered: false, isPrimaryKey: false }
        ],
        rowCount: 15000,
        description: 'Company data uploads with metadata about each financial data import'
      }],
      ['dbo.transactionHeader', {
        tableName: 'transactionHeader',
        schemaName: 'dbo',
        columns: [
          { columnName: 'transaction_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'transaction_date', dataType: 'date', isNullable: false },
          { columnName: 'description', dataType: 'nvarchar', maxLength: 500, isNullable: true },
          { columnName: 'reference', dataType: 'nvarchar', maxLength: 100, isNullable: true },
          { columnName: 'entry_type', dataType: 'nvarchar', maxLength: 50, isNullable: true },
          { columnName: 'created_date', dataType: 'datetime', isNullable: false },
          { columnName: 'created_by', dataType: 'nvarchar', maxLength: 100, isNullable: true }
        ],
        primaryKeys: ['transaction_id'],
        foreignKeys: [
          { constraintName: 'FK_transactionHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.transactionHeader', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_transactionHeader', tableName: 'dbo.transactionHeader', columns: ['transaction_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_transactionHeader_uploadId', tableName: 'dbo.transactionHeader', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 2500000,
        description: 'General ledger transaction headers containing summary information'
      }],
      ['dbo.transactionLine', {
        tableName: 'transactionLine',
        schemaName: 'dbo',
        columns: [
          { columnName: 'line_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'transaction_id', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'account_code', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'account_name', dataType: 'nvarchar', maxLength: 255, isNullable: true },
          { columnName: 'account_type', dataType: 'nvarchar', maxLength: 50, isNullable: true },
          { columnName: 'amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'line_description', dataType: 'nvarchar', maxLength: 500, isNullable: true }
        ],
        primaryKeys: ['line_id'],
        foreignKeys: [
          { constraintName: 'FK_transactionLine_transactionHeader', parentTable: 'dbo.transactionHeader', parentColumn: 'transaction_id', childTable: 'dbo.transactionLine', childColumn: 'transaction_id' },
          { constraintName: 'FK_transactionLine_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.transactionLine', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_transactionLine', tableName: 'dbo.transactionLine', columns: ['line_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_transactionLine_uploadId', tableName: 'dbo.transactionLine', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 8000000,
        description: 'General ledger transaction line items with account details'
      }],
      ['dbo.saleHeader', {
        tableName: 'saleHeader',
        schemaName: 'dbo',
        columns: [
          { columnName: 'sale_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'invoice_number', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'invoice_date', dataType: 'date', isNullable: false },
          { columnName: 'due_date', dataType: 'date', isNullable: true },
          { columnName: 'customer_id', dataType: 'int', isNullable: true },
          { columnName: 'customer_name', dataType: 'nvarchar', maxLength: 255, isNullable: false },
          { columnName: 'gross_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'net_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'tax_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'outstanding_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'status', dataType: 'nvarchar', maxLength: 20, isNullable: false },
          { columnName: 'payment_date', dataType: 'date', isNullable: true },
          { columnName: 'delivery_date', dataType: 'date', isNullable: true },
          { columnName: 'description', dataType: 'nvarchar', maxLength: 500, isNullable: true }
        ],
        primaryKeys: ['sale_id'],
        foreignKeys: [
          { constraintName: 'FK_saleHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.saleHeader', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_saleHeader', tableName: 'dbo.saleHeader', columns: ['sale_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_saleHeader_uploadId', tableName: 'dbo.saleHeader', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 500000,
        description: 'Sales/accounts receivable invoice headers'
      }],
      ['dbo.saleLine', {
        tableName: 'saleLine',
        schemaName: 'dbo',
        columns: [
          { columnName: 'sale_line_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'sale_id', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'product_code', dataType: 'nvarchar', maxLength: 50, isNullable: true },
          { columnName: 'description', dataType: 'nvarchar', maxLength: 500, isNullable: true },
          { columnName: 'quantity', dataType: 'decimal', precision: 18, scale: 4, isNullable: false },
          { columnName: 'unit_price', dataType: 'decimal', precision: 18, scale: 4, isNullable: false },
          { columnName: 'net_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'tax_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'gross_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false }
        ],
        primaryKeys: ['sale_line_id'],
        foreignKeys: [
          { constraintName: 'FK_saleLine_saleHeader', parentTable: 'dbo.saleHeader', parentColumn: 'sale_id', childTable: 'dbo.saleLine', childColumn: 'sale_id' },
          { constraintName: 'FK_saleLine_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.saleLine', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_saleLine', tableName: 'dbo.saleLine', columns: ['sale_line_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_saleLine_uploadId', tableName: 'dbo.saleLine', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 1500000,
        description: 'Sales/accounts receivable invoice line items'
      }],
      ['dbo.purchaseHeader', {
        tableName: 'purchaseHeader',
        schemaName: 'dbo',
        columns: [
          { columnName: 'purchase_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'invoice_number', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'invoice_date', dataType: 'date', isNullable: false },
          { columnName: 'due_date', dataType: 'date', isNullable: true },
          { columnName: 'supplier_id', dataType: 'int', isNullable: true },
          { columnName: 'supplier_name', dataType: 'nvarchar', maxLength: 255, isNullable: false },
          { columnName: 'gross_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'net_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'tax_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'outstanding_amount', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'status', dataType: 'nvarchar', maxLength: 20, isNullable: false },
          { columnName: 'payment_date', dataType: 'date', isNullable: true },
          { columnName: 'description', dataType: 'nvarchar', maxLength: 500, isNullable: true }
        ],
        primaryKeys: ['purchase_id'],
        foreignKeys: [
          { constraintName: 'FK_purchaseHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.purchaseHeader', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_purchaseHeader', tableName: 'dbo.purchaseHeader', columns: ['purchase_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_purchaseHeader_uploadId', tableName: 'dbo.purchaseHeader', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 450000,
        description: 'Purchase/accounts payable invoice headers'
      }],
      ['dbo.trialBalance', {
        tableName: 'trialBalance',
        schemaName: 'dbo',
        columns: [
          { columnName: 'tb_id', dataType: 'int', isNullable: false, isPrimaryKey: true, isIdentity: true },
          { columnName: 'uploadId', dataType: 'int', isNullable: false, isForeignKey: true },
          { columnName: 'account_code', dataType: 'nvarchar', maxLength: 50, isNullable: false },
          { columnName: 'account_name', dataType: 'nvarchar', maxLength: 255, isNullable: true },
          { columnName: 'account_type', dataType: 'nvarchar', maxLength: 50, isNullable: true },
          { columnName: 'balance', dataType: 'decimal', precision: 18, scale: 2, isNullable: false },
          { columnName: 'balance_type', dataType: 'nvarchar', maxLength: 10, isNullable: true },
          { columnName: 'period_id', dataType: 'int', isNullable: true }
        ],
        primaryKeys: ['tb_id'],
        foreignKeys: [
          { constraintName: 'FK_trialBalance_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.trialBalance', childColumn: 'uploadId' }
        ],
        indexes: [
          { indexName: 'PK_trialBalance', tableName: 'dbo.trialBalance', columns: ['tb_id'], isUnique: true, isClustered: false, isPrimaryKey: true },
          { indexName: 'IX_trialBalance_uploadId', tableName: 'dbo.trialBalance', columns: ['uploadId'], isUnique: false, isClustered: true, isPrimaryKey: false }
        ],
        rowCount: 250000,
        description: 'Trial balance snapshot at specific periods'
      }]
    ]),
    relationships: [
      { constraintName: 'FK_transactionHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.transactionHeader', childColumn: 'uploadId' },
      { constraintName: 'FK_transactionLine_transactionHeader', parentTable: 'dbo.transactionHeader', parentColumn: 'transaction_id', childTable: 'dbo.transactionLine', childColumn: 'transaction_id' },
      { constraintName: 'FK_transactionLine_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.transactionLine', childColumn: 'uploadId' },
      { constraintName: 'FK_saleHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.saleHeader', childColumn: 'uploadId' },
      { constraintName: 'FK_saleLine_saleHeader', parentTable: 'dbo.saleHeader', parentColumn: 'sale_id', childTable: 'dbo.saleLine', childColumn: 'sale_id' },
      { constraintName: 'FK_saleLine_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.saleLine', childColumn: 'uploadId' },
      { constraintName: 'FK_purchaseHeader_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.purchaseHeader', childColumn: 'uploadId' },
      { constraintName: 'FK_trialBalance_upload', parentTable: 'dbo.upload', parentColumn: 'upload_id', childTable: 'dbo.trialBalance', childColumn: 'uploadId' }
    ],
    version: '1.0.0',
    loadedAt: new Date()
  };
}

/**
 * Test the database context system
 */
export async function testDatabaseContext() {
  logger.info("=== Testing Database Context System ===");

  try {
    // Test with mock data (no database connection required)
    logger.info("\n1. Testing with mock data...");
    const mockSchema = getMockDatabaseSchema();
    logger.info(`✓ Mock schema created with ${mockSchema.tables.size} tables`);

    // Log table information
    logger.info("\n2. Tables in mock schema:");
    for (const [name, table] of mockSchema.tables) {
      logger.info(`   - ${name}: ${table.columns.length} columns, ${table.rowCount} rows`);
    }

    // Log relationships
    logger.info(`\n3. Relationships: ${mockSchema.relationships.length} foreign keys defined`);
    mockSchema.relationships.slice(0, 3).forEach(rel => {
      logger.info(`   - ${rel.childTable}.${rel.childColumn} -> ${rel.parentTable}.${rel.parentColumn}`);
    });

    // Test context builder with mock schema
    logger.info("\n4. Testing context builder...");
    const { ContextBuilder } = await import("./contextBuilder");
    const contextBuilder = new ContextBuilder();
    const context = contextBuilder.buildContext(mockSchema);
    logger.info(`✓ Context built successfully`);

    // Log context information
    logger.info("\n5. Context summary:");
    logger.info(`   - Tables: ${Object.keys(context.tables).length}`);
    logger.info(`   - Business Rules: ${context.businessRules.length}`);
    logger.info(`   - Lending Templates: ${context.queryTemplates.lending.length}`);
    logger.info(`   - Audit Templates: ${context.queryTemplates.audit.length}`);
    logger.info(`   - Best Practices: ${context.bestPractices.length}`);

    // Show critical performance notes
    logger.info("\n6. Critical Performance Notes:");
    context.criticalPerformanceNotes.slice(0, 3).forEach(note => {
      logger.info(`   - ${note}`);
    });

    // Show sample business rules
    logger.info("\n7. Sample Business Rules:");
    context.businessRules.slice(0, 3).forEach(rule => {
      logger.info(`   - ${rule.name} (${rule.category}): ${rule.description}`);
    });

    // Show sample query templates
    logger.info("\n8. Sample Query Templates:");
    logger.info("   Lending:");
    context.queryTemplates.lending.slice(0, 2).forEach(template => {
      logger.info(`     - ${template.name}: ${template.description}`);
    });
    logger.info("   Audit:");
    context.queryTemplates.audit.slice(0, 2).forEach(template => {
      logger.info(`     - ${template.name}: ${template.description}`);
    });

    // Test markdown export
    logger.info("\n9. Testing markdown export...");
    const markdown = contextBuilder.exportAsMarkdown(context);
    logger.info(`✓ Markdown documentation generated (${markdown.length} characters)`);

    logger.info("\n=== All tests passed successfully! ===");

    // Attempt to test with real database if available
    logger.info("\n10. Attempting to connect to real database...");
    try {
      await databaseContextManager.initialize();
      logger.info("✓ Successfully connected to database and loaded real schema");

      const realContext = databaseContextManager.getContext();
      if (realContext) {
        logger.info(`   - Real database has ${Object.keys(realContext.tables).length} tables`);
      }
    } catch (dbError) {
      logger.warn("⚠ Could not connect to database (this is expected if database is not configured)");
      logger.info("  The system will work with mock data when database is unavailable");
    }

  } catch (error) {
    logger.error("Test failed:", error);
    throw error;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDatabaseContext()
    .then(() => {
      logger.info("\nTests completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("\nTests failed:", error);
      process.exit(1);
    });
}

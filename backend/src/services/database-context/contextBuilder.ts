import {
  DatabaseSchema,
  TableSchema,
  ForeignKeyRelation,
} from "./schemaLoader";
import { BusinessRule, getBusinessRules } from "./businessRules";
import { getSampleQueries, QueryTemplate } from "./sampleQueries";
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
});

export interface TableContext {
  tableName: string;
  description: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    description?: string;
  }>;
  primaryKey: string[];
  relationships: Array<{
    type: "parent" | "child";
    relatedTable: string;
    localColumn: string;
    foreignColumn: string;
  }>;
  indexes: Array<{
    name: string;
    columns: string[];
    isClustered: boolean;
    isUnique: boolean;
  }>;
  rowCount: number;
  businessRules?: BusinessRule[];
  sampleQueries?: QueryTemplate[];
}

export interface DatabaseContext {
  overview: string;
  criticalPerformanceNotes: string[];
  tables: Record<string, TableContext>;
  relationships: Array<{
    parent: string;
    child: string;
    column: string;
  }>;
  businessRules: BusinessRule[];
  queryTemplates: {
    lending: QueryTemplate[];
    audit: QueryTemplate[];
  };
  bestPractices: string[];
}

export class ContextBuilder {
  /**
   * Build comprehensive database context from schema
   */
  buildContext(schema: DatabaseSchema): DatabaseContext {
    logger.info("Building database context from schema...");

    const tables: Record<string, TableContext> = {};

    // Build context for each table
    for (const [fullName, tableSchema] of schema.tables) {
      tables[fullName] = this.buildTableContext(
        tableSchema,
        schema.relationships,
      );
    }

    // Get business rules and sample queries
    const businessRules = getBusinessRules();
    const queryTemplates = getSampleQueries();

    const context: DatabaseContext = {
      overview: this.buildOverview(schema),
      criticalPerformanceNotes: this.getCriticalPerformanceNotes(),
      tables,
      relationships: this.buildRelationshipSummary(schema.relationships),
      businessRules,
      queryTemplates,
      bestPractices: this.getBestPractices(),
    };

    logger.info("Database context built successfully");
    return context;
  }

  /**
   * Build context for a single table
   */
  private buildTableContext(
    table: TableSchema,
    allRelationships: ForeignKeyRelation[],
  ): TableContext {
    const fullTableName = `${table.schemaName}.${table.tableName}`;

    // Find relationships for this table
    const parentRelations = allRelationships.filter(
      (fk) => fk.childTable === fullTableName,
    );
    const childRelations = allRelationships.filter(
      (fk) => fk.parentTable === fullTableName,
    );

    const relationships = [
      ...parentRelations.map((fk) => ({
        type: "parent" as const,
        relatedTable: fk.parentTable,
        localColumn: fk.childColumn,
        foreignColumn: fk.parentColumn,
      })),
      ...childRelations.map((fk) => ({
        type: "child" as const,
        relatedTable: fk.childTable,
        localColumn: fk.parentColumn,
        foreignColumn: fk.childColumn,
      })),
    ];

    // Get relevant business rules for this table
    const businessRules = getBusinessRules().filter((rule) =>
      rule.tables.includes(table.tableName),
    );

    // Get relevant sample queries
    const allQueries = getSampleQueries();
    const relevantQueries = [
      ...allQueries.lending.filter((q) =>
        q.involvedTables.some((t) => t.includes(table.tableName)),
      ),
      ...allQueries.audit.filter((q) =>
        q.involvedTables.some((t) => t.includes(table.tableName)),
      ),
    ];

    return {
      tableName: fullTableName,
      description:
        table.description || this.generateTableDescription(table.tableName),
      columns: table.columns.map((col) => ({
        name: col.columnName,
        type: this.formatDataType(col),
        nullable: col.isNullable,
        description: this.getColumnDescription(table.tableName, col.columnName),
      })),
      primaryKey: table.primaryKeys,
      relationships,
      indexes: table.indexes.map((idx) => ({
        name: idx.indexName,
        columns: idx.columns,
        isClustered: idx.isClustered,
        isUnique: idx.isUnique,
      })),
      rowCount: table.rowCount || 0,
      businessRules: businessRules.length > 0 ? businessRules : undefined,
      sampleQueries: relevantQueries.length > 0 ? relevantQueries : undefined,
    };
  }

  /**
   * Build overview of the database
   */
  private buildOverview(schema: DatabaseSchema): string {
    const tableCount = schema.tables.size;

    return `
Financial Data Warehouse Schema Overview:
- Total Tables: ${tableCount}
- Total Relationships: ${schema.relationships.length}
- Schema Version: ${schema.version}
- Last Updated: ${schema.loadedAt.toISOString()}

Core Business Entities:
- Upload: Company data uploads tracking
- Transaction (Header/Line): General ledger entries
- Sale (Header/Line): Accounts receivable/sales invoices
- Purchase (Header/Line): Accounts payable/purchase invoices
- Trial Balance: Period-end balances
- Aged Analysis: AR/AP aging buckets

Key Concepts:
- uploadId: Clustered index for all transaction tables (CRITICAL for performance)
- client_id: Multi-tenant isolation (REQUIRED in all queries)
- sme_id: Company identifier within a client
- financialPeriodId: Consistent period comparisons
    `.trim();
  }

  /**
   * Get critical performance notes
   */
  private getCriticalPerformanceNotes(): string[] {
    return [
      "ALWAYS filter by uploadId first - it's the clustered index on all transaction tables",
      "Include client_id in WHERE clause for multi-tenant isolation",
      "Use TOP or OFFSET-FETCH for large result sets (limit to 5000 rows initially)",
      "For portfolio queries, limit to uploads from last 3 months",
      "Join transaction tables on uploadId before other conditions",
      "Use WITH (NOLOCK) for read-only analytical queries",
      "Avoid functions in WHERE clauses on indexed columns",
      "Use EXISTS instead of IN for subqueries with large result sets",
    ];
  }

  /**
   * Build relationship summary
   */
  private buildRelationshipSummary(relationships: ForeignKeyRelation[]): Array<{
    parent: string;
    child: string;
    column: string;
  }> {
    return relationships.map((fk) => ({
      parent: fk.parentTable,
      child: fk.childTable,
      column: fk.parentColumn,
    }));
  }

  /**
   * Get best practices for querying
   */
  private getBestPractices(): string[] {
    return [
      "Query Pattern: Always start with upload table to get latest uploadId for a company",
      "Multi-tenancy: Include 'WHERE client_id = @clientId' in all queries",
      "Performance: Use uploadId as primary filter for transaction tables",
      "Aggregations: Pre-aggregate at CTE level before final SELECT",
      "Date Filters: Use financialPeriodId for period comparisons",
      "Company Matching: Use exact match on company name from upload table",
      "Result Limits: Apply TOP 5000 or pagination for large results",
      "Index Usage: Check execution plan to ensure index seeks not scans",
      "Parameter Safety: Use parameterized queries to prevent SQL injection",
      "Transaction Isolation: Use READ UNCOMMITTED for analytical queries",
    ];
  }

  /**
   * Format data type for display
   */
  private formatDataType(column: any): string {
    let type = column.dataType;

    if (column.maxLength && column.dataType.includes("char")) {
      type += `(${column.maxLength === -1 ? "MAX" : column.maxLength})`;
    } else if (column.precision && column.scale !== undefined) {
      type += `(${column.precision},${column.scale})`;
    } else if (column.precision) {
      type += `(${column.precision})`;
    }

    return type;
  }

  /**
   * Generate description for table based on name
   */
  private generateTableDescription(tableName: string): string {
    const descriptions: Record<string, string> = {
      upload: "Tracks all data uploads from companies with metadata",
      transactionHeader: "General ledger transaction headers",
      transactionLine: "General ledger transaction details",
      saleHeader: "Sales invoice headers (AR)",
      saleLine: "Sales invoice line items",
      purchaseHeader: "Purchase invoice headers (AP)",
      purchaseLine: "Purchase invoice line items",
      trialBalance: "Period-end account balances",
      saleAged: "Accounts receivable aging analysis",
      purchaseAged: "Accounts payable aging analysis",
      company: "Company/SME master data",
      customer: "Customer master records",
      supplier: "Supplier/vendor master records",
      chartOfAccounts: "Chart of accounts structure",
      financialPeriod: "Financial period definitions",
    };

    return descriptions[tableName] || `Table containing ${tableName} data`;
  }

  /**
   * Get column description based on common patterns
   */
  private getColumnDescription(_tableName: string, columnName: string): string {
    const commonColumns: Record<string, string> = {
      uploadId: "Unique identifier for data upload batch (clustered index)",
      client_id: "Client identifier for multi-tenant isolation",
      clientId: "Client identifier for multi-tenant isolation",
      sme_id: "Small/Medium Enterprise (company) identifier",
      smeId: "Small/Medium Enterprise (company) identifier",
      company_id: "Company identifier",
      companyId: "Company identifier",
      transactionId: "Unique transaction identifier",
      invoiceId: "Unique invoice identifier",
      customerId: "Customer identifier",
      supplierId: "Supplier/vendor identifier",
      accountCode: "General ledger account code",
      amount: "Transaction amount",
      balance: "Account balance",
      description: "Transaction or item description",
      reference: "External reference number",
      date: "Transaction or document date",
      dueDate: "Payment due date",
      createdDate: "Record creation timestamp",
      createdBy: "User who created the record",
      modifiedDate: "Last modification timestamp",
      modifiedBy: "User who last modified the record",
      status: "Current status of the record",
      isActive: "Whether the record is active",
      isDeleted: "Soft delete flag",
      currency: "Currency code (e.g., GBP, USD)",
      exchangeRate: "Currency exchange rate",
      taxRate: "Tax/VAT rate",
      taxAmount: "Tax/VAT amount",
      netAmount: "Amount excluding tax",
      grossAmount: "Amount including tax",
      financialPeriodId:
        "Financial period identifier for consistent comparisons",
      periodStart: "Start date of financial period",
      periodEnd: "End date of financial period",
      ageBucket: "Aging bucket (Current, 30, 60, 90, 120+ days)",
      daysPastDue: "Number of days past due date",
    };

    // Check for exact match
    if (commonColumns[columnName]) {
      return commonColumns[columnName];
    }

    // Check for pattern matches
    if (columnName.toLowerCase().includes("amount")) {
      return "Monetary amount value";
    }
    if (columnName.toLowerCase().includes("date")) {
      return "Date/timestamp value";
    }
    if (
      columnName.toLowerCase().includes("_id") ||
      columnName.toLowerCase().endsWith("id")
    ) {
      return "Unique identifier";
    }
    if (columnName.toLowerCase().includes("name")) {
      return "Name or description";
    }
    if (columnName.toLowerCase().includes("code")) {
      return "Classification or reference code";
    }
    if (columnName.toLowerCase().startsWith("is")) {
      return "Boolean flag indicator";
    }

    return "";
  }

  /**
   * Export context as markdown for documentation
   */
  exportAsMarkdown(context: DatabaseContext): string {
    let markdown = "# Database Context Documentation\n\n";

    markdown += "## Overview\n" + context.overview + "\n\n";

    markdown += "## Critical Performance Notes\n";
    context.criticalPerformanceNotes.forEach((note) => {
      markdown += `- ${note}\n`;
    });
    markdown += "\n";

    markdown += "## Tables\n\n";
    for (const [name, table] of Object.entries(context.tables)) {
      markdown += `### ${name}\n`;
      markdown += `${table.description}\n\n`;
      markdown += "**Columns:**\n";
      table.columns.forEach((col) => {
        markdown += `- \`${col.name}\` (${col.type}${col.nullable ? ", nullable" : ""})`;
        if (col.description) markdown += `: ${col.description}`;
        markdown += "\n";
      });
      markdown += "\n";

      if (table.primaryKey.length > 0) {
        markdown += `**Primary Key:** ${table.primaryKey.join(", ")}\n\n`;
      }

      if (table.relationships.length > 0) {
        markdown += "**Relationships:**\n";
        table.relationships.forEach((rel) => {
          markdown += `- ${rel.type === "parent" ? "References" : "Referenced by"} ${rel.relatedTable} via ${rel.localColumn}\n`;
        });
        markdown += "\n";
      }

      if (table.indexes.length > 0) {
        markdown += "**Indexes:**\n";
        table.indexes.forEach((idx) => {
          markdown += `- ${idx.name} (${idx.columns.join(", ")})`;
          if (idx.isClustered) markdown += " [CLUSTERED]";
          if (idx.isUnique) markdown += " [UNIQUE]";
          markdown += "\n";
        });
        markdown += "\n";
      }
    }

    markdown += "## Best Practices\n";
    context.bestPractices.forEach((practice) => {
      markdown += `- ${practice}\n`;
    });

    return markdown;
  }
}

export default ContextBuilder;

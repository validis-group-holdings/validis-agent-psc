import sql from "mssql";
import { getPool } from "../../config/database";
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

export interface TableColumn {
  columnName: string;
  dataType: string;
  isNullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  isIdentity?: boolean;
  isComputed?: boolean;
}

export interface ForeignKeyRelation {
  constraintName: string;
  parentTable: string;
  parentColumn: string;
  childTable: string;
  childColumn: string;
  deleteRule?: string;
  updateRule?: string;
}

export interface IndexInfo {
  indexName: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
  isClustered: boolean;
  isPrimaryKey: boolean;
  includeColumns?: string[];
}

export interface TableSchema {
  tableName: string;
  schemaName: string;
  columns: TableColumn[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyRelation[];
  indexes: IndexInfo[];
  rowCount?: number;
  description?: string;
}

export interface DatabaseSchema {
  tables: Map<string, TableSchema>;
  relationships: ForeignKeyRelation[];
  version: string;
  loadedAt: Date;
}

export class SchemaLoader {
  private pool: sql.ConnectionPool | null = null;

  constructor() {}

  /**
   * Initialize the schema loader with database connection
   */
  async initialize(): Promise<void> {
    try {
      this.pool = getPool();
      logger.info("SchemaLoader initialized with database connection");
    } catch (error) {
      logger.error("Failed to initialize SchemaLoader:", error);
      throw error;
    }
  }

  /**
   * Load complete database schema from INFORMATION_SCHEMA
   */
  async loadDatabaseSchema(): Promise<DatabaseSchema> {
    if (!this.pool) {
      throw new Error("SchemaLoader not initialized. Call initialize() first.");
    }

    logger.info("Loading database schema...");

    try {
      const tables = await this.loadTables();
      const relationships = await this.loadForeignKeys();

      // Load additional details for each table
      for (const [, table] of tables) {
        table.columns = await this.loadTableColumns(
          table.schemaName,
          table.tableName,
        );
        table.primaryKeys = await this.loadPrimaryKeys(
          table.schemaName,
          table.tableName,
        );
        table.foreignKeys = relationships.filter(
          (fk) => fk.childTable === `${table.schemaName}.${table.tableName}`,
        );
        table.indexes = await this.loadIndexes(
          table.schemaName,
          table.tableName,
        );
        table.rowCount = await this.getTableRowCount(
          table.schemaName,
          table.tableName,
        );
      }

      const schema: DatabaseSchema = {
        tables,
        relationships,
        version: "1.0.0",
        loadedAt: new Date(),
      };

      logger.info(`Successfully loaded schema for ${tables.size} tables`);
      return schema;
    } catch (error) {
      logger.error("Failed to load database schema:", error);
      throw error;
    }
  }

  /**
   * Load all tables from the database
   */
  private async loadTables(): Promise<Map<string, TableSchema>> {
    const query = `
      SELECT
        TABLE_SCHEMA as schemaName,
        TABLE_NAME as tableName,
        TABLE_TYPE as tableType
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `;

    const result = await this.pool!.request().query(query);
    const tables = new Map<string, TableSchema>();

    for (const row of result.recordset) {
      const fullName = `${row.schemaName}.${row.tableName}`;
      tables.set(fullName, {
        tableName: row.tableName,
        schemaName: row.schemaName,
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
        description: this.getTableDescription(row.tableName),
      });
    }

    return tables;
  }

  /**
   * Load columns for a specific table
   */
  private async loadTableColumns(
    schemaName: string,
    tableName: string,
  ): Promise<TableColumn[]> {
    const query = `
      SELECT
        c.COLUMN_NAME as columnName,
        c.DATA_TYPE as dataType,
        c.IS_NULLABLE as isNullable,
        c.CHARACTER_MAXIMUM_LENGTH as maxLength,
        c.NUMERIC_PRECISION as precision,
        c.NUMERIC_SCALE as scale,
        c.COLUMN_DEFAULT as defaultValue,
        COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as isIdentity,
        COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsComputed') as isComputed
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = @schemaName
        AND c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `;

    const result = await this.pool!.request()
      .input("schemaName", sql.NVarChar, schemaName)
      .input("tableName", sql.NVarChar, tableName)
      .query(query);

    return result.recordset.map((row) => ({
      columnName: row.columnName,
      dataType: row.dataType,
      isNullable: row.isNullable === "YES",
      maxLength: row.maxLength,
      precision: row.precision,
      scale: row.scale,
      defaultValue: row.defaultValue,
      isIdentity: row.isIdentity === 1,
      isComputed: row.isComputed === 1,
    }));
  }

  /**
   * Load primary keys for a table
   */
  private async loadPrimaryKeys(
    schemaName: string,
    tableName: string,
  ): Promise<string[]> {
    const query = `
      SELECT
        kcu.COLUMN_NAME as columnName
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_SCHEMA = @schemaName
        AND tc.TABLE_NAME = @tableName
      ORDER BY kcu.ORDINAL_POSITION
    `;

    const result = await this.pool!.request()
      .input("schemaName", sql.NVarChar, schemaName)
      .input("tableName", sql.NVarChar, tableName)
      .query(query);

    return result.recordset.map((row) => row.columnName);
  }

  /**
   * Load all foreign key relationships
   */
  private async loadForeignKeys(): Promise<ForeignKeyRelation[]> {
    const query = `
      SELECT
        fk.name as constraintName,
        SCHEMA_NAME(parent.schema_id) + '.' + parent.name as parentTable,
        COL_NAME(fkc.parent_object_id, fkc.parent_column_id) as parentColumn,
        SCHEMA_NAME(child.schema_id) + '.' + child.name as childTable,
        COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) as childColumn,
        fk.delete_referential_action_desc as deleteRule,
        fk.update_referential_action_desc as updateRule
      FROM sys.foreign_keys fk
      INNER JOIN sys.foreign_key_columns fkc
        ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.objects parent
        ON fkc.parent_object_id = parent.object_id
      INNER JOIN sys.objects child
        ON fkc.referenced_object_id = child.object_id
      WHERE parent.type = 'U' AND child.type = 'U'
      ORDER BY fk.name
    `;

    const result = await this.pool!.request().query(query);

    return result.recordset.map((row) => ({
      constraintName: row.constraintName,
      parentTable: row.parentTable,
      parentColumn: row.parentColumn,
      childTable: row.childTable,
      childColumn: row.childColumn,
      deleteRule: row.deleteRule,
      updateRule: row.updateRule,
    }));
  }

  /**
   * Load indexes for a table
   */
  private async loadIndexes(
    schemaName: string,
    tableName: string,
  ): Promise<IndexInfo[]> {
    const query = `
      SELECT
        i.name as indexName,
        i.is_unique as isUnique,
        i.type_desc as indexType,
        i.is_primary_key as isPrimaryKey,
        STUFF((
          SELECT ',' + COL_NAME(ic.object_id, ic.column_id)
          FROM sys.index_columns ic
          WHERE ic.object_id = i.object_id
            AND ic.index_id = i.index_id
            AND ic.is_included_column = 0
          ORDER BY ic.key_ordinal
          FOR XML PATH('')
        ), 1, 1, '') as keyColumns,
        STUFF((
          SELECT ',' + COL_NAME(ic.object_id, ic.column_id)
          FROM sys.index_columns ic
          WHERE ic.object_id = i.object_id
            AND ic.index_id = i.index_id
            AND ic.is_included_column = 1
          ORDER BY ic.index_column_id
          FOR XML PATH('')
        ), 1, 1, '') as includeColumns
      FROM sys.indexes i
      INNER JOIN sys.objects o
        ON i.object_id = o.object_id
      INNER JOIN sys.schemas s
        ON o.schema_id = s.schema_id
      WHERE o.type = 'U'
        AND s.name = @schemaName
        AND o.name = @tableName
        AND i.name IS NOT NULL
      ORDER BY i.index_id
    `;

    const result = await this.pool!.request()
      .input("schemaName", sql.NVarChar, schemaName)
      .input("tableName", sql.NVarChar, tableName)
      .query(query);

    return result.recordset.map((row) => ({
      indexName: row.indexName,
      tableName: `${schemaName}.${tableName}`,
      columns: row.keyColumns ? row.keyColumns.split(",") : [],
      isUnique: row.isUnique,
      isClustered: row.indexType === "CLUSTERED",
      isPrimaryKey: row.isPrimaryKey,
      includeColumns: row.includeColumns ? row.includeColumns.split(",") : [],
    }));
  }

  /**
   * Get row count for a table (with timeout for large tables)
   */
  private async getTableRowCount(
    schemaName: string,
    tableName: string,
  ): Promise<number> {
    try {
      const query = `
        SELECT SUM(p.rows) as rowCount
        FROM sys.partitions p
        INNER JOIN sys.objects o ON p.object_id = o.object_id
        INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
        WHERE o.type = 'U'
          AND s.name = @schemaName
          AND o.name = @tableName
          AND p.index_id IN (0, 1)
      `;

      const result = await this.pool!.request()
        .input("schemaName", sql.NVarChar, schemaName)
        .input("tableName", sql.NVarChar, tableName)
        .query(query);

      return result.recordset[0]?.rowCount || 0;
    } catch (error) {
      logger.warn(
        `Failed to get row count for ${schemaName}.${tableName}:`,
        error,
      );
      return -1;
    }
  }

  /**
   * Get business description for known tables
   */
  private getTableDescription(tableName: string): string {
    const descriptions: Record<string, string> = {
      upload:
        "Company data uploads with metadata about each financial data import",
      transactionHeader:
        "General ledger transaction headers containing summary information",
      transactionLine:
        "General ledger transaction line items with account details",
      saleHeader: "Sales/accounts receivable invoice headers",
      saleLine: "Sales/accounts receivable invoice line items",
      purchaseHeader: "Purchase/accounts payable invoice headers",
      purchaseLine: "Purchase/accounts payable invoice line items",
      saleAged: "Aged accounts receivable analysis",
      purchaseAged: "Aged accounts payable analysis",
      trialBalance: "Trial balance snapshot at specific periods",
      chartOfAccounts: "Chart of accounts master data",
      customer: "Customer master data",
      supplier: "Supplier/vendor master data",
      company: "Company/SME master data",
      financialPeriod: "Financial period definitions",
    };

    return descriptions[tableName] || "";
  }

  /**
   * Load schema for specific tables only
   */
  async loadTablesSchema(
    tableNames: string[],
  ): Promise<Map<string, TableSchema>> {
    if (!this.pool) {
      throw new Error("SchemaLoader not initialized. Call initialize() first.");
    }

    const tables = new Map<string, TableSchema>();

    for (const fullTableName of tableNames) {
      const [schemaName, tableName] = fullTableName.includes(".")
        ? fullTableName.split(".")
        : ["dbo", fullTableName];

      const table: TableSchema = {
        tableName,
        schemaName,
        columns: await this.loadTableColumns(schemaName, tableName),
        primaryKeys: await this.loadPrimaryKeys(schemaName, tableName),
        foreignKeys: [],
        indexes: await this.loadIndexes(schemaName, tableName),
        rowCount: await this.getTableRowCount(schemaName, tableName),
        description: this.getTableDescription(tableName),
      };

      tables.set(fullTableName, table);
    }

    return tables;
  }
}

export default SchemaLoader;

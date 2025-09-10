import { SchemaLoader, DatabaseSchema, TableSchema } from "./schemaLoader";
import { ContextBuilder, DatabaseContext } from "./contextBuilder";
import { getBusinessRules, BusinessRule } from "./businessRules";
import { getSampleQueries, QueryTemplate } from "./sampleQueries";
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

export interface DatabaseContextService {
  schema: DatabaseSchema | null;
  context: DatabaseContext | null;
  isInitialized: boolean;
  lastUpdated: Date | null;
}

class DatabaseContextManager {
  private schemaLoader: SchemaLoader;
  private contextBuilder: ContextBuilder;
  private schema: DatabaseSchema | null = null;
  private context: DatabaseContext | null = null;
  private isInitialized: boolean = false;
  private lastUpdated: Date | null = null;

  constructor() {
    this.schemaLoader = new SchemaLoader();
    this.contextBuilder = new ContextBuilder();
  }

  /**
   * Initialize the database context system
   */
  async initialize(): Promise<void> {
    try {
      logger.info("Initializing Database Context System...");

      // Initialize schema loader with database connection
      await this.schemaLoader.initialize();

      // Load the database schema
      await this.loadSchema();

      // Build the context
      this.buildContext();

      this.isInitialized = true;
      this.lastUpdated = new Date();

      logger.info("Database Context System initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Database Context System:", error);
      throw error;
    }
  }

  /**
   * Load or reload the database schema
   */
  async loadSchema(tableNames?: string[]): Promise<DatabaseSchema> {
    try {
      if (tableNames && tableNames.length > 0) {
        // Load specific tables only
        logger.info(`Loading schema for ${tableNames.length} specific tables...`);
        const tables = await this.schemaLoader.loadTablesSchema(tableNames);

        // If we have existing schema, merge the new tables
        if (this.schema) {
          for (const [name, table] of tables) {
            this.schema.tables.set(name, table);
          }
          this.schema.loadedAt = new Date();
        } else {
          // Create new schema with just these tables
          this.schema = {
            tables,
            relationships: [],
            version: "1.0.0",
            loadedAt: new Date()
          };
        }
      } else {
        // Load complete schema
        logger.info("Loading complete database schema...");
        this.schema = await this.schemaLoader.loadDatabaseSchema();
      }

      logger.info(`Schema loaded with ${this.schema.tables.size} tables`);
      return this.schema;
    } catch (error) {
      logger.error("Failed to load database schema:", error);
      throw error;
    }
  }

  /**
   * Build or rebuild the context from the current schema
   */
  buildContext(): DatabaseContext {
    if (!this.schema) {
      throw new Error("Schema not loaded. Call loadSchema() first.");
    }

    logger.info("Building database context...");
    this.context = this.contextBuilder.buildContext(this.schema);
    logger.info("Database context built successfully");

    return this.context;
  }

  /**
   * Get the current database schema
   */
  getSchema(): DatabaseSchema | null {
    return this.schema;
  }

  /**
   * Get the current database context
   */
  getContext(): DatabaseContext | null {
    return this.context;
  }

  /**
   * Get context for specific tables
   */
  getTableContext(tableName: string): any {
    if (!this.context) {
      throw new Error("Context not built. Call initialize() first.");
    }

    return this.context.tables[tableName];
  }

  /**
   * Get business rules
   */
  getBusinessRules(category?: string): BusinessRule[] {
    if (category) {
      return getBusinessRules().filter(rule => rule.category === category);
    }
    return getBusinessRules();
  }

  /**
   * Get sample queries
   */
  getSampleQueries(category?: 'lending' | 'audit'): QueryTemplate[] {
    const queries = getSampleQueries();
    if (category) {
      return queries[category];
    }
    return [...queries.lending, ...queries.audit];
  }

  /**
   * Export context as markdown documentation
   */
  exportContextAsMarkdown(): string {
    if (!this.context) {
      throw new Error("Context not built. Call initialize() first.");
    }

    return this.contextBuilder.exportAsMarkdown(this.context);
  }

  /**
   * Get context summary for agent consumption
   */
  getAgentContext(): any {
    if (!this.context) {
      throw new Error("Context not built. Call initialize() first.");
    }

    return {
      overview: this.context.overview,
      criticalNotes: this.context.criticalPerformanceNotes,
      tableCount: Object.keys(this.context.tables).length,
      businessRules: this.context.businessRules.length,
      queryTemplates: {
        lending: this.context.queryTemplates.lending.length,
        audit: this.context.queryTemplates.audit.length
      },
      bestPractices: this.context.bestPractices,
      lastUpdated: this.lastUpdated
    };
  }

  /**
   * Refresh the schema and context
   */
  async refresh(): Promise<void> {
    logger.info("Refreshing database context...");
    await this.loadSchema();
    this.buildContext();
    this.lastUpdated = new Date();
    logger.info("Database context refreshed successfully");
  }

  /**
   * Check if the context system is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.schema !== null && this.context !== null;
  }
}

// Create singleton instance
const databaseContextManager = new DatabaseContextManager();

// Export everything
export {
  databaseContextManager,
  DatabaseContextManager,
  SchemaLoader,
  ContextBuilder,
  DatabaseSchema,
  TableSchema,
  DatabaseContext,
  BusinessRule,
  QueryTemplate,
  getBusinessRules,
  getSampleQueries
};

// Default export
export default databaseContextManager;

import { getSampleQueries, QueryTemplate, getQueryTemplateById, getQueryTemplatesForTables } from './database-context/sampleQueries';
import { logger } from '../config/logger';

export interface TemplateFilter {
  category?: 'lending' | 'audit';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CategoryInfo {
  name: string;
  displayName: string;
  description: string;
  count: number;
  templates: string[]; // Template IDs
}

/**
 * Service for managing and retrieving query templates
 */
class TemplateService {
  private templates: Map<string, QueryTemplate>;
  private lastRefresh: Date;
  private readonly CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.templates = new Map();
    this.lastRefresh = new Date(0);
    this.loadTemplates();
  }

  /**
   * Load or refresh templates from the source
   */
  private loadTemplates(): void {
    try {
      const queries = getSampleQueries();
      this.templates.clear();

      // Load lending templates
      queries.lending.forEach(template => {
        this.templates.set(template.id, template);
      });

      // Load audit templates
      queries.audit.forEach(template => {
        this.templates.set(template.id, template);
      });

      this.lastRefresh = new Date();
      logger.info(`Loaded ${this.templates.size} query templates`);
    } catch (error) {
      logger.error('Failed to load templates:', error);
      throw error;
    }
  }

  /**
   * Check if templates need refresh
   */
  private checkRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefresh.getTime() > this.CACHE_TTL) {
      this.loadTemplates();
    }
  }

  /**
   * Get templates with optional filtering
   */
  async getTemplates(filter: TemplateFilter = {}): Promise<QueryTemplate[]> {
    this.checkRefresh();

    let templates = Array.from(this.templates.values());

    // Apply category filter
    if (filter.category) {
      templates = templates.filter(t => t.category === filter.category);
    }

    // Apply search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      templates = templates.filter(t =>
        t.name.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower) ||
        t.naturalLanguageExample.toLowerCase().includes(searchLower) ||
        t.involvedTables.some(table => table.toLowerCase().includes(searchLower))
      );
    }

    // Sort templates by category and then by name
    templates.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || templates.length;

    return templates.slice(offset, offset + limit);
  }

  /**
   * Get template count with optional filtering
   */
  async getTemplateCount(filter: TemplateFilter = {}): Promise<number> {
    this.checkRefresh();

    let templates = Array.from(this.templates.values());

    // Apply category filter
    if (filter.category) {
      templates = templates.filter(t => t.category === filter.category);
    }

    // Apply search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      templates = templates.filter(t =>
        t.name.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower) ||
        t.naturalLanguageExample.toLowerCase().includes(searchLower) ||
        t.involvedTables.some(table => table.toLowerCase().includes(searchLower))
      );
    }

    return templates.length;
  }

  /**
   * Get a specific template by ID
   */
  async getTemplateById(id: string): Promise<QueryTemplate | undefined> {
    this.checkRefresh();
    return this.templates.get(id) || getQueryTemplateById(id);
  }

  /**
   * Get templates that involve a specific table
   */
  async getTemplatesForTable(tableName: string): Promise<QueryTemplate[]> {
    this.checkRefresh();
    return getQueryTemplatesForTables([tableName]);
  }

  /**
   * Get category information
   */
  async getCategories(): Promise<CategoryInfo[]> {
    this.checkRefresh();

    const lendingTemplates = Array.from(this.templates.values())
      .filter(t => t.category === 'lending');

    const auditTemplates = Array.from(this.templates.values())
      .filter(t => t.category === 'audit');

    return [
      {
        name: 'lending',
        displayName: 'Lending & Portfolio Analysis',
        description: 'Templates for portfolio-level analysis, working capital assessment, and lending opportunities',
        count: lendingTemplates.length,
        templates: lendingTemplates.map(t => t.id),
      },
      {
        name: 'audit',
        displayName: 'Audit & Compliance',
        description: 'Templates for company-specific audit procedures, variance analysis, and compliance testing',
        count: auditTemplates.length,
        templates: auditTemplates.map(t => t.id),
      },
    ];
  }

  /**
   * Format template for API response
   */
  formatTemplateResponse(template: QueryTemplate): any {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      naturalLanguageExample: template.naturalLanguageExample,
      parameters: template.parameters,
      involvedTables: template.involvedTables,
      expectedColumns: template.expectedColumns,
      performanceNotes: template.performanceNotes,
      // Don't include the full SQL template in list responses for security
      sqlTemplateLength: template.sqlTemplate.length,
    };
  }

  /**
   * Format template with full SQL for detailed response
   */
  formatTemplateDetailResponse(template: QueryTemplate): any {
    return {
      ...this.formatTemplateResponse(template),
      sqlTemplate: template.sqlTemplate,
    };
  }

  /**
   * Validate template parameters
   */
  validateTemplateParameters(
    template: QueryTemplate,
    providedParams: Record<string, any>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of template.parameters) {
      const value = providedParams[param.name];

      // Check required parameters
      if (value === undefined || value === null) {
        if (!param.defaultValue) {
          errors.push(`Missing required parameter: ${param.name}`);
        }
        continue;
      }

      // Type validation
      switch (param.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push(`Parameter ${param.name} must be a string`);
          }
          break;
        case 'number':
          if (typeof value !== 'number' && isNaN(Number(value))) {
            errors.push(`Parameter ${param.name} must be a number`);
          }
          break;
        case 'date':
          if (isNaN(Date.parse(value))) {
            errors.push(`Parameter ${param.name} must be a valid date`);
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`Parameter ${param.name} must be a boolean`);
          }
          break;
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply parameters to a template SQL
   */
  applyTemplateParameters(
    template: QueryTemplate,
    params: Record<string, any>
  ): string {
    let sql = template.sqlTemplate;

    // Apply provided parameters and defaults
    for (const param of template.parameters) {
      const value = params[param.name] ?? param.defaultValue;
      const placeholder = `@${param.name}`;

      // Escape and format based on type
      let formattedValue: string;
      switch (param.type) {
        case 'string':
          formattedValue = `'${String(value).replace(/'/g, "''")}'`;
          break;
        case 'number':
          formattedValue = String(value);
          break;
        case 'date':
          formattedValue = `'${new Date(value).toISOString()}'`;
          break;
        case 'boolean':
          formattedValue = value ? '1' : '0';
          break;
        default:
          formattedValue = String(value);
      }

      sql = sql.replace(new RegExp(placeholder, 'g'), formattedValue);
    }

    return sql;
  }

  /**
   * Get template usage statistics
   */
  async getTemplateStats(): Promise<{
    totalTemplates: number;
    byCategory: Record<string, number>;
    byTable: Record<string, number>;
    avgParametersPerTemplate: number;
  }> {
    this.checkRefresh();

    const templates = Array.from(this.templates.values());
    const byCategory: Record<string, number> = {};
    const byTable: Record<string, number> = {};
    let totalParameters = 0;

    for (const template of templates) {
      // Count by category
      byCategory[template.category] = (byCategory[template.category] || 0) + 1;

      // Count by involved tables
      for (const table of template.involvedTables) {
        byTable[table] = (byTable[table] || 0) + 1;
      }

      // Count parameters
      totalParameters += template.parameters.length;
    }

    return {
      totalTemplates: templates.length,
      byCategory,
      byTable,
      avgParametersPerTemplate: templates.length > 0
        ? totalParameters / templates.length
        : 0,
    };
  }
}

// Create singleton instance
let templateServiceInstance: TemplateService | null = null;

/**
 * Get or create the template service instance
 */
export function getTemplateService(): TemplateService {
  if (!templateServiceInstance) {
    templateServiceInstance = new TemplateService();
  }
  return templateServiceInstance;
}

// Export types and service
export { TemplateService, QueryTemplate };
export default getTemplateService;

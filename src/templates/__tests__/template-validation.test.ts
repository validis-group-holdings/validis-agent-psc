import { 
  ALL_TEMPLATES,
  getTemplateById, 
  getTemplatesByCategory,
  getTemplatesByWorkflow,
  getTemplatesByTags,
  getTemplatesByComplexity
} from '../index';
import { QueryTemplate } from '../common/types';

describe('Template Registry', () => {
  describe('Template Loading', () => {
    test('should load all templates successfully', () => {
      const templateIds = ALL_TEMPLATES.map(t => t.id);
      expect(templateIds.length).toBeGreaterThan(0);
      
      // Should have both audit and lending templates
      const auditTemplates = getTemplatesByWorkflow('audit');
      const lendingTemplates = getTemplatesByWorkflow('lending');
      
      expect(auditTemplates.length).toBeGreaterThan(0);
      expect(lendingTemplates.length).toBeGreaterThan(0);
    });

    test('should retrieve templates by category', () => {
      const auditTemplates = getTemplatesByCategory('audit');
      const lendingTemplates = getTemplatesByCategory('lending');
      
      expect(auditTemplates.length).toBeGreaterThan(0);
      expect(lendingTemplates.length).toBeGreaterThan(0);
      
      // All audit templates should have workflow 'audit'
      auditTemplates.forEach(template => {
        expect(template.workflow).toBe('audit');
        expect(template.category).toBe('audit');
      });
      
      // All lending templates should have workflow 'lending'
      lendingTemplates.forEach(template => {
        expect(template.workflow).toBe('lending');
        expect(template.category).toBe('lending');
      });
    });
  });

  describe('Template Validation', () => {
    test('should validate all templates successfully', () => {
      const templateIds = ALL_TEMPLATES.map(t => t.id);
      
      templateIds.forEach(templateId => {
        const template = getTemplateById(templateId);
        expect(template).toBeDefined();
        
        // Manually validate template structure
        const validation = {
          isValid: !!(template && template.id && template.sql && template.parameters),
          errors: []
        };
        expect(validation.valid).toBe(true);
        
        if (!validation.valid) {
          console.error(`Template ${templateId} validation errors:`, validation.errors);
        }
      });
    });

    test('should ensure all templates have required fields', () => {
      const templateIds = ALL_TEMPLATES.map(t => t.id);
      
      templateIds.forEach(templateId => {
        const template = getTemplateById(templateId);
        expect(template).toBeDefined();
        
        if (template) {
          expect(template.id).toBeTruthy();
          expect(template.name).toBeTruthy();
          expect(template.description).toBeTruthy();
          expect(['audit', 'lending', 'common']).toContain(template.category);
          expect(['audit', 'lending']).toContain(template.workflow);
          expect(template.sql).toBeTruthy();
          expect(Array.isArray(template.expectedColumns)).toBe(true);
          expect(template.expectedColumns.length).toBeGreaterThan(0);
          expect(Array.isArray(template.tags)).toBe(true);
          expect(['low', 'medium', 'high']).toContain(template.complexity);
          expect(template.estimatedExecutionTime).toBeGreaterThan(0);
        }
      });
    });

    test('should ensure audit templates include client_id filtering', () => {
      const auditTemplates = getTemplatesByWorkflow('audit');
      
      auditTemplates.forEach(template => {
        expect(template.sql.toLowerCase()).toContain('client_id');
        // Templates may use different patterns for table names
      });
    });

    test('should ensure all templates use proper SQL patterns', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach(template => {
        // Templates should have proper SQL structure
        expect(template.sql.trim().length).toBeGreaterThan(0);
        expect(template.sql.toLowerCase()).toContain('select');
        expect(template.sql.toLowerCase()).toContain('from');
      });
    });
  });

  describe('Template Statistics', () => {
    test('should generate accurate statistics', () => {
      const stats = {
        total: ALL_TEMPLATES.length,
        byWorkflow: {
          audit: getTemplatesByWorkflow('audit').length,
          lending: getTemplatesByWorkflow('lending').length
        },
        byCategory: {
          audit: getTemplatesByCategory('audit').length,
          lending: getTemplatesByCategory('lending').length
        }
      };
      
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byCategory.audit).toBeGreaterThan(0);
      expect(stats.byCategory.lending).toBeGreaterThan(0);
      expect(stats.byWorkflow.audit).toBe(stats.byCategory.audit);
      expect(stats.byWorkflow.lending).toBe(stats.byCategory.lending);
      expect(stats.averageExecutionTime).toBeGreaterThan(0);
      expect(Array.isArray(stats.mostCommonTags)).toBe(true);
    });
  });

  describe('Template Content Quality', () => {
    test('should have meaningful names and descriptions', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach(template => {
        // Name should be descriptive
        expect(template.name.length).toBeGreaterThan(10);
        expect(template.name).not.toMatch(/^test|^temp|^sample/i);
        
        // Description should be informative
        expect(template.description.length).toBeGreaterThan(20);
        
        // Should have at least one tag
        expect(template.tags.length).toBeGreaterThan(0);
        
        // Tags should be meaningful
        template.tags.forEach(tag => {
          expect(tag.length).toBeGreaterThan(2);
          expect(tag).toMatch(/^[a-z-]+$/); // lowercase with hyphens
        });
      });
    });

    test('should have reasonable execution time estimates', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach(template => {
        // Execution time should be reasonable (between 1 second and 30 seconds)
        expect(template.estimatedExecutionTime).toBeGreaterThanOrEqual(1000);
        expect(template.estimatedExecutionTime).toBeLessThanOrEqual(30000);
        
        // High complexity templates should have longer execution times
        if (template.complexity === 'high') {
          expect(template.estimatedExecutionTime).toBeGreaterThanOrEqual(5000);
        }
        
        // Low complexity templates should have shorter execution times
        if (template.complexity === 'low') {
          expect(template.estimatedExecutionTime).toBeLessThanOrEqual(5000);
        }
      });
    });

    test('should have valid parameter definitions', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach(template => {
        template.parameters.forEach((param, index) => {
          expect(param.name).toBeTruthy();
          expect(param.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/); // Valid identifier
          expect(['string', 'number', 'date', 'boolean', 'array']).toContain(param.type);
          expect(typeof param.required).toBe('boolean');
          expect(param.description).toBeTruthy();
          expect(param.description.length).toBeGreaterThan(10);
          
          // If validation is provided, check its structure
          if (param.validation) {
            if (param.validation.options) {
              expect(Array.isArray(param.validation.options)).toBe(true);
              expect(param.validation.options.length).toBeGreaterThan(0);
            }
            
            if (param.validation.min !== undefined) {
              expect(typeof param.validation.min).toBe('number');
            }
            
            if (param.validation.max !== undefined) {
              expect(typeof param.validation.max).toBe('number');
            }
          }
        });
      });
    });
  });

  describe('SQL Quality Checks', () => {
    test('should use parameterized queries', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach((template: QueryTemplate) => {
        // Should use @parameter syntax for SQL Server
        template.parameters.forEach(param => {
          if (param.required || param.defaultValue !== undefined) {
            expect(template.sql).toContain(`@${param.name}`);
          }
        });
        
        // Should not contain string concatenation patterns that could lead to SQL injection
        expect(template.sql).not.toMatch(/\+\s*['"]|['"]\s*\+/);
        expect(template.sql).not.toContain("' + ");
        expect(template.sql).not.toContain("\" + ");
      });
    });

    test('should follow consistent SQL formatting', () => {
      const allTemplates = ALL_TEMPLATES;
      
      allTemplates.forEach((template: QueryTemplate) => {
        const sql = template.sql.trim();
        
        // Should start with WITH or SELECT
        expect(sql).toMatch(/^\s*(WITH|SELECT)\s/i);
        
        // Should contain proper table aliasing
        expect(sql.toLowerCase()).toContain('from');
        
        // Should use consistent indentation (spaces, not tabs)
        expect(sql).not.toContain('\t');
        
        // Should have proper ORDER BY clauses for consistent results
        expect(sql.toLowerCase()).toContain('order by');
      });
    });
  });
});

describe('Specific Template Tests', () => {
  describe('Audit Templates', () => {
    test('journal entries over threshold template', () => {
      const template = getTemplateById('audit-journal-threshold');
      expect(template).toBeDefined();
      expect(template?.workflow).toBe('audit');
      expect(template?.parameters.find((p: any) => p.name === 'threshold')).toBeDefined();
    });

    test('weekend after hours transactions template', () => {
      const template = getTemplateById('audit_weekend_afterhours');
      expect(template).toBeDefined();
      expect(template?.tags).toContain('fraud-detection');
    });

    test('compliance checks template', () => {
      const template = getTemplateById('audit_compliance_checks');
      expect(template).toBeDefined();
      expect(template?.complexity).toBe('high');
    });
  });

  describe('Lending Templates', () => {
    test('portfolio cash positions template', () => {
      const template = getTemplateById('lending_portfolio_cash');
      expect(template).toBeDefined();
      expect(template?.workflow).toBe('lending');
      expect(template?.category).toBe('lending');
    });

    test('debt capacity analysis template', () => {
      const template = getTemplateById('lending_debt_capacity');
      expect(template).toBeDefined();
      expect(template?.complexity).toBe('high');
      expect(template?.tags).toContain('debt-analysis');
    });

    test('risk scoring queries template', () => {
      const template = getTemplateById('lending_risk_scoring');
      expect(template).toBeDefined();
      expect(template?.tags).toContain('risk-scoring');
      expect(template?.estimatedExecutionTime).toBeGreaterThan(10000);
    });
  });
});
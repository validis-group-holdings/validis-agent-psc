/**
 * Test script for Lending and Audit agents
 */

import { lendingAgent } from './lending';
import { auditAgent } from './audit';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

async function testLendingAgent() {
  console.log('\n========================================');
  console.log('TESTING LENDING AGENT (Portfolio Queries)');
  console.log('========================================\n');

  const testQueries = [
    'Show me the top 20 asset-based finance opportunities across the portfolio',
    'Assess the accounts receivable quality and aging across my portfolio',
    'Analyze the cash position relative to operational needs for my portfolio companies',
    'Which companies in my portfolio have working capital strain?',
    'Show me companies with strong revenue growth in my portfolio'
  ];

  for (const query of testQueries) {
    console.log(`\n--- Testing: "${query}" ---\n`);

    try {
      const response = await lendingAgent.processQuery({
        naturalLanguageQuery: query,
        clientId: 'test-client-123',
        includeExplanation: true,
        maxResults: 20
      });

      console.log(`Confidence: ${(response.confidence * 100).toFixed(0)}%`);
      console.log(`Query Type: ${response.queryType}`);
      console.log(`Tables: ${response.involvedTables.join(', ')}`);
      console.log(`Columns: ${response.expectedColumns.slice(0, 5).join(', ')}...`);

      if (response.performanceNotes && response.performanceNotes.length > 0) {
        console.log('\nPerformance Notes:');
        response.performanceNotes.forEach(note => console.log(`  - ${note}`));
      }

      console.log('\nSQL Preview (first 500 chars):');
      console.log(response.sql.substring(0, 500) + '...');

      // Test with reasoning
      console.log('\n--- Testing with Chain of Thought ---');
      const reasoningResponse = await lendingAgent.generateWithReasoning(
        query,
        'test-client-123',
        false // Don't include full schema for brevity
      );

      console.log('Reasoning Preview:');
      console.log(reasoningResponse.reasoning.substring(0, 400) + '...');

    } catch (error) {
      console.error(`Failed: ${error}`);
    }
  }
}

async function testAuditAgent() {
  console.log('\n======================================');
  console.log('TESTING AUDIT AGENT (Company Queries)');
  console.log('======================================\n');

  const testQueries = [
    {
      query: 'Identify transactions more than 10% up or down versus prior period for ABC Company',
      company: 'ABC Company'
    },
    {
      query: 'Show me sales transactions greater than 10% of total sales for XYZ Corp',
      company: 'XYZ Corp'
    },
    {
      query: 'Identify receivables greater than 5% of total sales outstanding more than 120 days for Tech Solutions Ltd',
      company: 'Tech Solutions Ltd'
    },
    {
      query: 'Show me journal entries made after hours or on weekends for Finance Co',
      company: 'Finance Co'
    },
    {
      query: 'Find duplicate payments for Global Traders Inc',
      company: 'Global Traders Inc'
    }
  ];

  for (const test of testQueries) {
    console.log(`\n--- Testing: "${test.query}" ---\n`);

    try {
      const response = await auditAgent.processQuery({
        naturalLanguageQuery: test.query,
        clientId: 'test-client-123',
        companyName: test.company,
        includeExplanation: true,
        maxResults: 50,
        useLatestUpload: true
      });

      console.log(`Company: ${test.company}`);
      console.log(`Confidence: ${(response.confidence * 100).toFixed(0)}%`);
      console.log(`Query Type: ${response.queryType}`);
      console.log(`Tables: ${response.involvedTables.join(', ')}`);
      console.log(`Columns: ${response.expectedColumns.slice(0, 5).join(', ')}...`);

      if (response.auditRisks && response.auditRisks.length > 0) {
        console.log('\nAudit Risks Identified:');
        response.auditRisks.forEach(risk => {
          console.log(`  - [${risk.level.toUpperCase()}] ${risk.category}: ${risk.description}`);
        });
      }

      if (response.performanceNotes && response.performanceNotes.length > 0) {
        console.log('\nPerformance Notes:');
        response.performanceNotes.forEach(note => console.log(`  - ${note}`));
      }

      console.log('\nSQL Preview (first 500 chars):');
      console.log(response.sql.substring(0, 500) + '...');

      // Test with reasoning
      console.log('\n--- Testing with Chain of Thought ---');
      const reasoningResponse = await auditAgent.generateWithReasoning(
        test.query,
        'test-client-123',
        test.company,
        false // Don't include full schema for brevity
      );

      console.log('Reasoning Preview:');
      console.log(reasoningResponse.reasoning.substring(0, 400) + '...');

      if (reasoningResponse.risks.length > 0) {
        console.log(`\nRisks Identified: ${reasoningResponse.risks.length}`);
      }

    } catch (error) {
      console.error(`Failed: ${error}`);
    }
  }

  // Test risk assessment
  console.log('\n--- Testing Risk Assessment ---\n');
  try {
    const riskAssessment = await auditAgent.performRiskAssessment(
      'test-client-123',
      'High Risk Company Ltd'
    );

    console.log(`Overall Risk Level: ${riskAssessment.overallRisk.toUpperCase()}`);
    console.log(`Risk Areas Identified: ${riskAssessment.riskAreas.length}`);
    console.log('Recommendations:');
    riskAssessment.recommendations.forEach(rec => console.log(`  - ${rec}`));
  } catch (error) {
    console.error(`Risk assessment failed: ${error}`);
  }
}

async function testTemplateVariations() {
  console.log('\n==========================================');
  console.log('TESTING TEMPLATE VARIATIONS (95% Accuracy)');
  console.log('==========================================\n');

  const lendingVariations = [
    'Find the best 20 opportunities for asset-based lending in my portfolio',
    'Show top asset finance candidates across all my companies',
    'Identify companies suitable for factoring or ABL financing',
    'Which portfolio companies have strong AR for lending?',
    'Display best receivables financing opportunities'
  ];

  const auditVariations = [
    'Find transactions with more than 10% variance for ABC Company',
    'Show me significant fluctuations in ABC Company transactions',
    'Identify unusual changes in account balances for ABC Company',
    'What transactions changed significantly for ABC Company?',
    'Detect material variances in ABC Company accounts'
  ];

  console.log('--- Testing Lending Agent Variations ---\n');
  let lendingSuccess = 0;
  for (const query of lendingVariations) {
    try {
      const response = await lendingAgent.processQuery({
        naturalLanguageQuery: query,
        clientId: 'test-client-123',
        maxResults: 20
      });

      // Check if SQL is valid (contains key elements)
      const isValid = response.sql.includes('LatestUploads') &&
                     response.sql.includes('client_id') &&
                     response.sql.includes('uploadId') &&
                     response.confidence >= 0.7;

      if (isValid) {
        lendingSuccess++;
        console.log(`✓ ${query.substring(0, 50)}... (${(response.confidence * 100).toFixed(0)}%)`);
      } else {
        console.log(`✗ ${query.substring(0, 50)}... (${(response.confidence * 100).toFixed(0)}%)`);
      }
    } catch (error) {
      console.log(`✗ ${query.substring(0, 50)}... (Error)`);
    }
  }

  console.log(`\nLending Agent Success Rate: ${(lendingSuccess / lendingVariations.length * 100).toFixed(0)}%\n`);

  console.log('--- Testing Audit Agent Variations ---\n');
  let auditSuccess = 0;
  for (const query of auditVariations) {
    try {
      const response = await auditAgent.processQuery({
        naturalLanguageQuery: query,
        clientId: 'test-client-123',
        companyName: 'ABC Company',
        maxResults: 50
      });

      // Check if SQL is valid (contains key elements)
      const isValid = response.sql.includes('CompanyUpload') &&
                     response.sql.includes('client_id') &&
                     response.sql.includes('company_name') &&
                     response.confidence >= 0.75;

      if (isValid) {
        auditSuccess++;
        console.log(`✓ ${query.substring(0, 50)}... (${(response.confidence * 100).toFixed(0)}%)`);
      } else {
        console.log(`✗ ${query.substring(0, 50)}... (${(response.confidence * 100).toFixed(0)}%)`);
      }
    } catch (error) {
      console.log(`✗ ${query.substring(0, 50)}... (Error)`);
    }
  }

  console.log(`\nAudit Agent Success Rate: ${(auditSuccess / auditVariations.length * 100).toFixed(0)}%\n`);

  const overallSuccess = (lendingSuccess + auditSuccess) / (lendingVariations.length + auditVariations.length);
  console.log(`\n========================================`);
  console.log(`OVERALL SUCCESS RATE: ${(overallSuccess * 100).toFixed(0)}%`);
  console.log(`Target: 95% | ${overallSuccess >= 0.95 ? 'PASSED ✓' : 'NEEDS IMPROVEMENT'}`);
  console.log(`========================================\n`);
}

async function main() {
  try {
    console.log('Initializing agents...\n');

    // Initialize both agents
    await Promise.all([
      lendingAgent.initialize(),
      auditAgent.initialize()
    ]);

    console.log('Agents initialized successfully!\n');

    // Run all tests
    await testLendingAgent();
    await testAuditAgent();
    await testTemplateVariations();

    // Show available templates
    console.log('\n=== AVAILABLE TEMPLATES ===\n');

    console.log('Lending Agent Templates:');
    const lendingTemplates = lendingAgent.getAvailableTemplates();
    lendingTemplates.forEach(t => {
      console.log(`  - ${t.name}`);
      console.log(`    Example: "${t.example}"`);
    });

    console.log('\nAudit Agent Templates:');
    const auditTemplates = auditAgent.getAvailableTemplates();
    auditTemplates.forEach(t => {
      console.log(`  - ${t.name} [Risk: ${t.riskLevel}]`);
      console.log(`    Example: "${t.example}"`);
    });

    console.log('\n=== ALL TESTS COMPLETED ===\n');

  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testLendingAgent, testAuditAgent, testTemplateVariations };

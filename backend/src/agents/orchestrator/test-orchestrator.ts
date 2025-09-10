/**
 * Test script to validate Orchestrator Agent routing accuracy
 */

import { createOrchestratorAgent } from './index';
import { UserQuery, IntentType, AgentType } from './types';

async function testOrchestratorRouting() {
  console.log('🚀 Testing Orchestrator Agent Routing Accuracy...\n');

  const orchestrator = createOrchestratorAgent({
    confidenceThreshold: 0.7,
    clarificationEnabled: true,
    templateSuggestionEnabled: true
  });

  // Test cases with expected routing
  const testCases = [
    // Lending Agent cases
    {
      query: 'Analyze the portfolio of 10 companies in our lending book',
      expected: AgentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Compare debt-to-equity ratios across all portfolio companies',
      expected: AgentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Check covenant compliance for our loan facilities',
      expected: AgentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Assess credit risk across multiple borrowers',
      expected: AgentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Generate portfolio performance metrics for Q4',
      expected: AgentType.LENDING,
      category: 'Lending'
    },

    // Audit Agent cases
    {
      query: 'Perform substantive testing on ABC Company accounts receivable',
      expected: AgentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Test internal controls for XYZ Corporation',
      expected: AgentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Calculate materiality for the financial statement audit',
      expected: AgentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Review journal entries for unusual transactions',
      expected: AgentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Audit the balance sheet of Tech Corp',
      expected: AgentType.AUDIT,
      category: 'Audit'
    },

    // Ambiguous cases
    {
      query: 'Analyze financial statements',
      expected: AgentType.ORCHESTRATOR, // Should ask for clarification
      category: 'Ambiguous'
    },
    {
      query: 'Review the companies',
      expected: AgentType.ORCHESTRATOR,
      category: 'Ambiguous'
    },
    {
      query: 'Check compliance',
      expected: AgentType.ORCHESTRATOR,
      category: 'Ambiguous'
    }
  ];

  let correctRoutings = 0;
  let totalTests = testCases.length;
  const results: any[] = [];

  console.log('Running test cases...\n');
  console.log('=' .repeat(80));

  for (const testCase of testCases) {
    const userQuery: UserQuery = {
      text: testCase.query,
      timestamp: new Date(),
      sessionId: `test-session-${Date.now()}`
    };

    try {
      const response = await orchestrator.orchestrate(userQuery);

      const isCorrect =
        response.routing.targetAgent === testCase.expected ||
        (testCase.expected === AgentType.ORCHESTRATOR && response.routing.requiresClarification);

      if (isCorrect) {
        correctRoutings++;
      }

      results.push({
        query: testCase.query.substring(0, 50) + '...',
        category: testCase.category,
        expected: testCase.expected,
        actual: response.routing.targetAgent,
        intent: response.routing.intent.intent,
        confidence: (response.routing.intent.confidence * 100).toFixed(1) + '%',
        clarification: response.routing.requiresClarification,
        correct: isCorrect
      });

      // Clean up session
      orchestrator.clearSession(userQuery.sessionId);
    } catch (error) {
      console.error(`Error testing query: ${testCase.query}`, error);
      results.push({
        query: testCase.query.substring(0, 50) + '...',
        category: testCase.category,
        expected: testCase.expected,
        actual: 'ERROR',
        intent: 'ERROR',
        confidence: '0%',
        clarification: false,
        correct: false
      });
    }
  }

  // Display results
  console.log('\n📊 Test Results:\n');
  console.log('=' .repeat(80));

  // Group by category
  const categories = ['Lending', 'Audit', 'Ambiguous'];

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    console.log(`\n${category} Queries (${categoryResults.length} tests):`);
    console.log('-'.repeat(80));

    categoryResults.forEach(result => {
      const status = result.correct ? '✅' : '❌';
      console.log(`${status} Query: ${result.query}`);
      console.log(`   Expected: ${result.expected}, Got: ${result.actual}`);
      console.log(`   Intent: ${result.intent}, Confidence: ${result.confidence}`);
      if (result.clarification) {
        console.log(`   ⚠️  Requested clarification`);
      }
      console.log();
    });
  }

  // Summary
  const accuracy = (correctRoutings / totalTests) * 100;
  console.log('=' .repeat(80));
  console.log('\n📈 Summary:');
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Correct Routings: ${correctRoutings}`);
  console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`   Target: 95%`);
  console.log(`   Status: ${accuracy >= 95 ? '✅ PASS' : '❌ FAIL'}`);
  console.log('=' .repeat(80));

  // Test additional features
  console.log('\n🔧 Testing Additional Features:\n');

  // Test template suggestions
  const templateQuery: UserQuery = {
    text: 'Perform covenant compliance testing for our loan portfolio',
    timestamp: new Date(),
    sessionId: 'template-test'
  };

  const templateResponse = await orchestrator.orchestrate(templateQuery);
  console.log('Template Suggestions:');
  if (templateResponse.templates && templateResponse.templates.length > 0) {
    templateResponse.templates.forEach(template => {
      console.log(`   - ${template.name} (${template.category})`);
    });
  } else {
    console.log('   No templates suggested');
  }

  // Test context management
  const sessionId = 'context-test';
  const contextQueries = [
    'I need to analyze our portfolio',
    'Focus on companies in the technology sector',
    'Check their debt ratios'
  ];

  console.log('\nContext Management Test:');
  for (const queryText of contextQueries) {
    const query: UserQuery = {
      text: queryText,
      timestamp: new Date(),
      sessionId
    };
    await orchestrator.orchestrate(query);
  }

  const summary = orchestrator.getConversationSummary(sessionId);
  console.log(`   Messages in context: ${summary.messageCount}`);
  console.log(`   Intents detected: ${summary.intents.join(', ')}`);
  console.log(`   Agents routed to: ${summary.routedAgents.join(', ')}`);

  // Pattern analysis
  const patterns = orchestrator.analyzePatterns(sessionId);
  console.log(`   Dominant intent: ${patterns.dominantIntent || 'None'}`);
  console.log(`   Intent switches: ${patterns.switchCount}`);
  console.log(`   Clarification rate: ${(patterns.clarificationRate * 100).toFixed(1)}%`);

  // Cleanup
  orchestrator.clearSession(sessionId);
  orchestrator.clearSession('template-test');

  console.log('\n✅ Orchestrator Agent testing complete!\n');

  return accuracy;
}

// Run the test if this file is executed directly
if (require.main === module) {
  testOrchestratorRouting()
    .then(accuracy => {
      process.exit(accuracy >= 95 ? 0 : 1);
    })
    .catch(error => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testOrchestratorRouting };

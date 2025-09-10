/**
 * Simple test script to validate routing logic without LangChain dependencies
 */

import { IntentClassifier } from './intentClassifier';
import { UserQuery, IntentType, AgentType } from './types';

function testRoutingAccuracy() {
  console.log('🚀 Testing Orchestrator Intent Classification & Routing Logic...\n');

  const classifier = new IntentClassifier();

  // Test cases with expected routing
  const testCases = [
    // Lending Agent cases (portfolio/multiple companies)
    {
      query: 'Analyze the portfolio of 10 companies in our lending book',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Compare debt-to-equity ratios across all portfolio companies',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Check covenant compliance for our loan facilities',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Assess credit risk across multiple borrowers',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Generate portfolio performance metrics for Q4',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Review leverage ratios for all companies in the portfolio',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Analyze industry concentration risk in our lending portfolio',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Cross-company financial metrics comparison',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Debt service coverage for all facilities',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },
    {
      query: 'Benchmark portfolio companies against industry peers',
      expectedIntent: IntentType.LENDING,
      category: 'Lending'
    },

    // Audit Agent cases (single company/audit procedures)
    {
      query: 'Perform substantive testing on ABC Company accounts receivable',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Test internal controls for XYZ Corporation',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Calculate materiality for the financial statement audit',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Review journal entries for unusual transactions at Tech Corp',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Audit the balance sheet of Tech Corp',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Perform cut-off testing for year-end at ABC Inc',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Test management assertions for inventory valuation',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Document control deficiencies found during walkthrough',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'SOX compliance testing procedures for the company',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },
    {
      query: 'Year-end audit procedures for Smith Corporation',
      expectedIntent: IntentType.AUDIT,
      category: 'Audit'
    },

    // Ambiguous cases
    {
      query: 'Analyze financial statements',
      expectedIntent: IntentType.AMBIGUOUS,
      category: 'Ambiguous'
    },
    {
      query: 'Review the companies',
      expectedIntent: IntentType.AMBIGUOUS,
      category: 'Ambiguous'
    },
    {
      query: 'Check compliance',
      expectedIntent: IntentType.AMBIGUOUS,
      category: 'Ambiguous'
    },
    {
      query: 'Perform risk assessment',
      expectedIntent: IntentType.AMBIGUOUS,
      category: 'Ambiguous'
    },
    {
      query: 'Generate financial reports',
      expectedIntent: IntentType.AMBIGUOUS,
      category: 'Ambiguous'
    }
  ];

  let correctClassifications = 0;
  const totalTests = testCases.length;
  const results: any[] = [];

  console.log('Running classification tests...\n');
  console.log('=' .repeat(80));

  for (const testCase of testCases) {
    const userQuery: UserQuery = {
      text: testCase.query,
      timestamp: new Date(),
      sessionId: `test-${Date.now()}`
    };

    const classification = classifier.classifyIntent(userQuery);

    // For ambiguous cases, we accept either AMBIGUOUS or low confidence
    const isCorrect =
      classification.intent === testCase.expectedIntent ||
      (testCase.expectedIntent === IntentType.AMBIGUOUS &&
       (classification.intent === IntentType.AMBIGUOUS || classification.confidence < 0.5));

    if (isCorrect) {
      correctClassifications++;
    }

    results.push({
      query: testCase.query.length > 50 ? testCase.query.substring(0, 47) + '...' : testCase.query,
      category: testCase.category,
      expected: testCase.expectedIntent,
      actual: classification.intent,
      confidence: (classification.confidence * 100).toFixed(1) + '%',
      keywords: classification.keywords.slice(0, 3).join(', '),
      correct: isCorrect
    });
  }

  // Display results by category
  console.log('\n📊 Classification Results by Category:\n');

  const categories = ['Lending', 'Audit', 'Ambiguous'];

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const categoryCorrect = categoryResults.filter(r => r.correct).length;
    const categoryAccuracy = (categoryCorrect / categoryResults.length * 100).toFixed(1);

    console.log(`\n${category} Queries (${categoryResults.length} tests, ${categoryAccuracy}% accuracy):`);
    console.log('-'.repeat(80));

    categoryResults.forEach(result => {
      const status = result.correct ? '✅' : '❌';
      console.log(`${status} "${result.query}"`);
      console.log(`   Expected: ${result.expected}, Got: ${result.actual} (${result.confidence})`);
      if (result.keywords) {
        console.log(`   Keywords: ${result.keywords}`);
      }
    });
  }

  // Overall summary
  const accuracy = (correctClassifications / totalTests) * 100;
  console.log('\n' + '=' .repeat(80));
  console.log('\n📈 Overall Summary:');
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Correct Classifications: ${correctClassifications}`);
  console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`   Target: 95%`);
  console.log(`   Status: ${accuracy >= 95 ? '✅ PASS' : '❌ FAIL'}`);

  // Breakdown by intent type
  console.log('\n📊 Accuracy by Intent Type:');
  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const categoryCorrect = categoryResults.filter(r => r.correct).length;
    const categoryAccuracy = (categoryCorrect / categoryResults.length * 100).toFixed(1);
    console.log(`   ${category}: ${categoryAccuracy}% (${categoryCorrect}/${categoryResults.length})`);
  }

  // Test template suggestions
  console.log('\n🎯 Testing Template Suggestions:');
  const templateTestCases = [
    { query: 'covenant compliance testing', expected: 'Covenant Compliance Testing Template' },
    { query: 'calculate materiality for audit', expected: 'Materiality Calculation Template' },
    { query: 'portfolio credit risk', expected: 'Credit Risk Assessment Template' }
  ];

  for (const test of templateTestCases) {
    const query: UserQuery = {
      text: test.query,
      timestamp: new Date(),
      sessionId: 'template-test'
    };

    const classification = classifier.classifyIntent(query);
    const hasExpectedTemplate = classification.suggestedTemplates?.includes(test.expected);

    console.log(`   ${hasExpectedTemplate ? '✅' : '❌'} "${test.query}"`);
    if (classification.suggestedTemplates && classification.suggestedTemplates.length > 0) {
      console.log(`      Templates: ${classification.suggestedTemplates.join(', ')}`);
    }
  }

  console.log('\n' + '=' .repeat(80));
  console.log('\n✅ Routing logic test complete!\n');

  return accuracy;
}

// Run the test
if (require.main === module) {
  const accuracy = testRoutingAccuracy();
  process.exit(accuracy >= 95 ? 0 : 1);
}

export { testRoutingAccuracy };

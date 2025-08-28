import { QueryTemplate } from './common/types';

// Audit Templates
import { journalEntriesOverThreshold, roundAmountJournalEntries } from './audit/journalEntries';
import { weekendTransactions, afterHoursTransactions } from './audit/weekendTransactions';
import { unusualUserActivity, userAccessPatterns } from './audit/userActivity';
import { accountBalanceReconciliation, negativeBalanceAccounts } from './audit/accountBalance';
import { monthEndAdjustments, quarterEndAdjustments } from './audit/monthEndAdjustments';
import { duplicateTransactions, benfordsLawAnalysis } from './audit/unusualPatterns';
import { largeVendorPayments, duplicateVendorPayments } from './audit/vendorPayments';
import { largeCustomerReceipts, creditBalanceCustomers } from './audit/customerReceipts';
import { expenseVarianceAnalysis, unusualExpensePatterns } from './audit/expenseAnalysis';
import { segregationOfDutiesCheck, authorizationLimitChecks } from './audit/compliance';

// Lending Templates
import { cashFlowAnalysis, dailyCashPosition } from './lending/portfolioCash';
import { revenueGrowthAnalysis, seasonalityAnalysis } from './lending/revenueTrends';
import { debtToEquityAnalysis, debtServiceCoverageRatio } from './lending/debtCapacity';
import { workingCapitalAnalysis, accountsReceivableTurnover } from './lending/workingCapital';
import { profitabilityRatios, efficiencyRatios } from './lending/financialRatios';
import { creditRiskScorecard, industryBenchmarking } from './lending/riskScoring';
import { debtCovenantMonitoring, covenantTrendAnalysis } from './lending/covenantCompliance';
import { liquidityRatioAnalysis, cashConversionCycle } from './lending/liquidityAnalysis';

// Template Registry
export const AUDIT_TEMPLATES: QueryTemplate[] = [
  // Journal Entry Analysis
  journalEntriesOverThreshold,
  roundAmountJournalEntries,
  
  // Timing Analysis
  weekendTransactions,
  afterHoursTransactions,
  
  // User Activity Analysis
  unusualUserActivity,
  userAccessPatterns,
  
  // Account Balance Analysis
  accountBalanceReconciliation,
  negativeBalanceAccounts,
  
  // Period-End Analysis
  monthEndAdjustments,
  quarterEndAdjustments,
  
  // Pattern Analysis
  duplicateTransactions,
  benfordsLawAnalysis,
  
  // Vendor Analysis
  largeVendorPayments,
  duplicateVendorPayments,
  
  // Customer Analysis
  largeCustomerReceipts,
  creditBalanceCustomers,
  
  // Expense Analysis
  expenseVarianceAnalysis,
  unusualExpensePatterns,
  
  // Compliance Analysis
  segregationOfDutiesCheck,
  authorizationLimitChecks
];

export const LENDING_TEMPLATES: QueryTemplate[] = [
  // Cash Flow Analysis
  cashFlowAnalysis,
  dailyCashPosition,
  
  // Revenue Analysis
  revenueGrowthAnalysis,
  seasonalityAnalysis,
  
  // Debt Analysis
  debtToEquityAnalysis,
  debtServiceCoverageRatio,
  
  // Working Capital Analysis
  workingCapitalAnalysis,
  accountsReceivableTurnover,
  
  // Financial Ratios
  profitabilityRatios,
  efficiencyRatios,
  
  // Risk Assessment
  creditRiskScorecard,
  industryBenchmarking,
  
  // Covenant Analysis
  debtCovenantMonitoring,
  covenantTrendAnalysis,
  
  // Liquidity Analysis
  liquidityRatioAnalysis,
  cashConversionCycle
];

export const ALL_TEMPLATES: QueryTemplate[] = [
  ...AUDIT_TEMPLATES,
  ...LENDING_TEMPLATES
];

// Template lookup functions
export function getTemplateById(id: string): QueryTemplate | undefined {
  return ALL_TEMPLATES.find(template => template.id === id);
}

export function getTemplatesByCategory(category: 'audit' | 'lending'): QueryTemplate[] {
  return ALL_TEMPLATES.filter(template => template.category === category);
}

export function getTemplatesByWorkflow(workflow: 'audit' | 'lending'): QueryTemplate[] {
  return ALL_TEMPLATES.filter(template => template.workflow === workflow);
}

export function getTemplatesByTags(tags: string[]): QueryTemplate[] {
  return ALL_TEMPLATES.filter(template => 
    template.tags && template.tags.some(tag => tags.includes(tag))
  );
}

export function getTemplatesByComplexity(complexity: 'low' | 'medium' | 'high'): QueryTemplate[] {
  return ALL_TEMPLATES.filter(template => template.complexity === complexity);
}

export function searchTemplates(searchTerm: string): QueryTemplate[] {
  const term = searchTerm.toLowerCase();
  return ALL_TEMPLATES.filter(template => 
    template.name.toLowerCase().includes(term) ||
    template.description.toLowerCase().includes(term) ||
    (template.tags && template.tags.some(tag => tag.toLowerCase().includes(term)))
  );
}

// Template metadata
export const TEMPLATE_STATS = {
  total: ALL_TEMPLATES.length,
  audit: AUDIT_TEMPLATES.length,
  lending: LENDING_TEMPLATES.length,
  complexity: {
    low: ALL_TEMPLATES.filter(t => t.complexity === 'low').length,
    medium: ALL_TEMPLATES.filter(t => t.complexity === 'medium').length,
    high: ALL_TEMPLATES.filter(t => t.complexity === 'high').length
  }
};

export * from './common/types';
export * from './executor';
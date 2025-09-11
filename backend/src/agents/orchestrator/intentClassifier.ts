/**
 * Intent Classifier for determining whether a query is lending or audit related
 */

import { IntentType, IntentClassification, UserQuery, ClassificationCriteria } from './types';

export class IntentClassifier {
  private readonly criteria: ClassificationCriteria = {
    lendingKeywords: [
      'portfolio',
      'portfolios',
      'multiple companies',
      'companies',
      'loan',
      'lending',
      'credit',
      'debt',
      'borrower',
      'lender',
      'facility',
      'facilities',
      'covenant',
      'collateral',
      'default',
      'repayment',
      'interest coverage',
      'debt service',
      'leverage ratio',
      'leverage ratios',
      'cross-company',
      'cross company',
      'aggregate',
      'consolidated',
      'group analysis',
      'portfolio performance',
      'portfolio risk',
      'concentration risk',
      'industry analysis',
      'sector analysis',
      'benchmark',
      'peer comparison',
      'trend analysis across',
      'portfolio metrics',
      'all companies',
      'across all',
      'across portfolio',
      'multiple borrowers'
    ],
    auditKeywords: [
      'audit',
      'auditor',
      'financial statement',
      'balance sheet',
      'income statement',
      'cash flow',
      'single company',
      'materiality',
      'substantive',
      'control',
      'testing',
      'procedure',
      'procedures',
      'assertion',
      'assertions',
      'completeness',
      'accuracy',
      'existence',
      'valuation',
      'cut-off',
      'cutoff',
      'cut off',
      'classification',
      'presentation',
      'disclosure',
      'walkthrough',
      'walk through',
      'sample',
      'confirmation',
      'reconciliation',
      'working paper',
      'audit evidence',
      'internal control',
      'internal controls',
      'analytical procedure',
      'journal entry',
      'journal entries',
      'management representation',
      'going concern',
      'subsequent event',
      'related party',
      'year-end',
      'year end',
      'sox',
      'sarbanes',
      'corporation',
      'corp',
      'inc',
      'ltd',
      'company',
      'abc company',
      'xyz corporation',
      'tech corp',
      'smith corporation',
      'control deficiencies',
      'unusual transactions',
      'inventory valuation'
    ],
    lendingPatterns: [
      /portfolio\s+(of|with|containing)\s+\d+\s+compan/i,
      /analyz(e|ing)\s+multiple\s+compan/i,
      /cross[\s-]company\s+analys/i,
      /aggregate\s+(financial|metric|data)/i,
      /debt\s+to\s+equity/i,
      /loan\s+to\s+value/i,
      /credit\s+(risk|analysis|assessment)/i,
      /covenant\s+(compliance|breach|testing)/i,
      /portfolio\s+(concentration|diversification)/i,
      /sector\s+exposure/i
    ],
    auditPatterns: [
      /audit\s+(of|for)\s+[\w\s]+\s+(company|corporation|inc|ltd)/i,
      /substantive\s+(test|procedure)/i,
      /control\s+test/i,
      /audit\s+procedure/i,
      /financial\s+statement\s+audit/i,
      /year[\s-]end\s+audit/i,
      /quarterly\s+review/i,
      /sox\s+(compliance|testing)/i,
      /internal\s+control/i,
      /management\s+assertion/i,
      /audit\s+opinion/i,
      /material\s+misstatement/i
    ]
  };

  /**
   * Classify user intent based on query text
   */
  public classifyIntent(query: UserQuery): IntentClassification {
    const text = query.text.toLowerCase();

    // Calculate scores for each intent type
    const lendingScore = this.calculateScore(text, 'lending');
    const auditScore = this.calculateScore(text, 'audit');

    // Extract matched keywords
    const keywords = this.extractKeywords(text);

    // Determine intent and confidence
    let intent: IntentType;
    let confidence: number;
    let reasoning: string;

    if (lendingScore > auditScore && lendingScore > 0.3) {
      intent = IntentType.LENDING;
      confidence = this.calculateConfidence(lendingScore, auditScore);
      reasoning = this.generateLendingReasoning(keywords, text);
    } else if (auditScore > lendingScore && auditScore > 0.3) {
      intent = IntentType.AUDIT;
      confidence = this.calculateConfidence(auditScore, lendingScore);
      reasoning = this.generateAuditReasoning(keywords, text);
    } else {
      intent = IntentType.AMBIGUOUS;
      confidence = Math.max(lendingScore, auditScore);
      reasoning = this.generateAmbiguousReasoning(lendingScore, auditScore, text);
    }

    // Generate template suggestions
    const suggestedTemplates = this.suggestTemplates(intent, keywords);

    return {
      intent,
      confidence,
      reasoning,
      keywords,
      suggestedTemplates
    };
  }

  /**
   * Calculate score for a specific intent type
   */
  private calculateScore(text: string, type: 'lending' | 'audit'): number {
    let score = 0;
    const keywords =
      type === 'lending' ? this.criteria.lendingKeywords : this.criteria.auditKeywords;
    const patterns =
      type === 'lending' ? this.criteria.lendingPatterns : this.criteria.auditPatterns;

    // Check for strong indicators first
    if (type === 'lending') {
      if (
        text.includes('portfolio') ||
        text.includes('multiple compan') ||
        text.includes('across all') ||
        text.includes('all companies')
      ) {
        score += 0.4; // Strong lending indicator
      }
      if (text.includes('cross-company') || text.includes('cross company')) {
        score += 0.5; // Very strong lending indicator
      }
    } else if (type === 'audit') {
      // Check for specific company names (strong audit indicators)
      if (/\b(abc|xyz|tech|smith)\s+(company|corp|corporation|inc|ltd)/i.test(text)) {
        score += 0.4; // Specific company mentioned
      }
      if (
        text.includes('journal entr') ||
        text.includes('cut-off') ||
        text.includes('cut off') ||
        text.includes('cutoff')
      ) {
        score += 0.3; // Audit-specific procedures
      }
      if (text.includes('year-end') || text.includes('year end')) {
        score += 0.2; // Audit timing indicator
      }
      if (
        text.includes('unusual transaction') ||
        text.includes('control deficienc') ||
        text.includes('walkthrough') ||
        text.includes('walk through')
      ) {
        score += 0.3; // More audit-specific terms
      }
    }

    // Check keyword matches
    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        // Weight longer keywords higher
        const weight = keyword.split(' ').length * 0.1;
        // Extra weight for exact audit/lending keywords
        if (keyword === 'audit' || keyword === 'portfolio' || keyword === 'lending') {
          score += weight * 1.5;
        } else {
          score += weight;
        }
      }
    }

    // Check pattern matches
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        score += 0.3; // Patterns are weighted higher
      }
    }

    // Normalize score
    return Math.min(score, 1.0);
  }

  /**
   * Calculate confidence based on score difference
   */
  private calculateConfidence(primaryScore: number, secondaryScore: number): number {
    const difference = primaryScore - secondaryScore;
    const average = (primaryScore + secondaryScore) / 2;

    // Higher difference and higher primary score = higher confidence
    const confidence = primaryScore * (1 + difference);

    return Math.min(confidence, 1.0);
  }

  /**
   * Extract matched keywords from text
   */
  private extractKeywords(text: string): string[] {
    const matched = new Set<string>();

    for (const keyword of [...this.criteria.lendingKeywords, ...this.criteria.auditKeywords]) {
      if (text.includes(keyword)) {
        matched.add(keyword);
      }
    }

    return Array.from(matched);
  }

  /**
   * Generate reasoning for lending classification
   */
  private generateLendingReasoning(keywords: string[], text: string): string {
    const lendingKeywords = keywords.filter((k) => this.criteria.lendingKeywords.includes(k));

    if (text.includes('portfolio') || text.includes('multiple compan')) {
      return `Query mentions portfolio or multiple companies analysis, which is typically handled by the Lending Agent. Key indicators: ${lendingKeywords.join(', ')}`;
    }

    if (lendingKeywords.some((k) => ['loan', 'credit', 'debt', 'covenant'].includes(k))) {
      return `Query contains lending-specific terminology indicating credit or loan analysis. Key indicators: ${lendingKeywords.join(', ')}`;
    }

    return `Query appears to be related to lending/portfolio analysis based on: ${lendingKeywords.join(', ')}`;
  }

  /**
   * Generate reasoning for audit classification
   */
  private generateAuditReasoning(keywords: string[], text: string): string {
    const auditKeywords = keywords.filter((k) => this.criteria.auditKeywords.includes(k));

    if (text.includes('audit') && (text.includes('procedure') || text.includes('test'))) {
      return `Query explicitly mentions audit procedures or testing, which is handled by the Audit Agent. Key indicators: ${auditKeywords.join(', ')}`;
    }

    if (
      auditKeywords.some((k) => ['materiality', 'assertion', 'substantive', 'control'].includes(k))
    ) {
      return `Query contains audit-specific terminology indicating audit procedures. Key indicators: ${auditKeywords.join(', ')}`;
    }

    if (text.includes('single company') || text.includes('financial statement')) {
      return `Query focuses on single company analysis or financial statement review. Key indicators: ${auditKeywords.join(', ')}`;
    }

    return `Query appears to be related to audit procedures based on: ${auditKeywords.join(', ')}`;
  }

  /**
   * Generate reasoning for ambiguous classification
   */
  private generateAmbiguousReasoning(
    lendingScore: number,
    auditScore: number,
    _text: string
  ): string {
    if (lendingScore === 0 && auditScore === 0) {
      return 'Query does not contain clear indicators for either lending or audit context. Clarification needed.';
    }

    if (Math.abs(lendingScore - auditScore) < 0.1) {
      return `Query contains indicators for both lending (${(lendingScore * 100).toFixed(0)}%) and audit (${(auditScore * 100).toFixed(0)}%) contexts. Clarification needed to determine the appropriate agent.`;
    }

    return 'Unable to determine clear intent from the query. Additional context required.';
  }

  /**
   * Suggest relevant templates based on intent and keywords
   */
  private suggestTemplates(intent: IntentType, keywords: string[]): string[] {
    const templates: string[] = [];

    if (intent === IntentType.LENDING || intent === IntentType.AMBIGUOUS) {
      if (keywords.some((k) => ['portfolio', 'multiple companies'].includes(k))) {
        templates.push('Portfolio Financial Analysis Template');
        templates.push('Multi-Company Comparison Template');
      }
      if (keywords.some((k) => ['covenant', 'compliance'].includes(k))) {
        templates.push('Covenant Compliance Testing Template');
      }
      if (keywords.some((k) => ['credit', 'risk'].includes(k))) {
        templates.push('Credit Risk Assessment Template');
      }
    }

    if (intent === IntentType.AUDIT || intent === IntentType.AMBIGUOUS) {
      if (keywords.some((k) => ['substantive', 'testing'].includes(k))) {
        templates.push('Substantive Testing Procedures Template');
      }
      if (keywords.some((k) => ['control', 'internal control'].includes(k))) {
        templates.push('Internal Control Testing Template');
      }
      if (keywords.some((k) => ['financial statement', 'balance sheet'].includes(k))) {
        templates.push('Financial Statement Audit Template');
      }
      if (keywords.some((k) => ['materiality'].includes(k))) {
        templates.push('Materiality Calculation Template');
      }
    }

    return templates.slice(0, 3); // Return top 3 most relevant templates
  }
}

---
created: 2025-09-10T11:16:17Z
last_updated: 2025-09-10T11:16:17Z
version: 1.0
author: Claude Code PM System
---

# Product Context

## Product Definition
**Validis Agent**: An AI-powered chatbot that enables non-technical users in audit firms and lending institutions to query standardized financial data using natural language, eliminating the need for SQL expertise or manual Excel manipulation.

## Target Users

### Primary Personas

#### 1. Relationship Manager (Lending)
- **Organization**: Banks, specialized lenders (Barclays, Santander)
- **Technical Skill**: Low to medium (no SQL knowledge)
- **Primary Need**: Portfolio-wide insights for lending decisions
- **Use Frequency**: Daily/Weekly
- **Key Tasks**:
  - Identify lending opportunities across portfolio
  - Assess credit risk for multiple companies
  - Monitor portfolio health metrics
  - Analyze working capital needs

#### 2. Audit Manager
- **Organization**: Audit firms (PWC, Big 4)
- **Technical Skill**: Medium (understands data but not SQL)
- **Primary Need**: Company-specific audit evidence
- **Use Frequency**: During audit season (intensive)
- **Key Tasks**:
  - Identify audit exceptions
  - Test for fraud indicators
  - Verify transaction accuracy
  - Document findings for workpapers

#### 3. Junior Auditor
- **Organization**: Audit firms
- **Technical Skill**: Low (entry-level)
- **Primary Need**: Guided audit procedures
- **Use Frequency**: Daily during audits
- **Key Tasks**:
  - Execute standard audit tests
  - Follow pre-defined templates
  - Document basic findings
  - Learn audit procedures

## Core Product Requirements

### Functional Requirements

#### Template System
**8 Lending Templates** (Portfolio-wide):
1. **Top 20 Asset Finance Opportunities**
   - AR balance >£100k
   - AR/Revenue >15%
   - Aging <60 days average

2. **AR Quality Assessment**
   - Age buckets: Current, 30, 60, 90, 120+
   - Concentration risk analysis
   - Collection efficiency metrics

3. **Cash Position Analysis**
   - Cash runway calculation
   - Burn rate analysis
   - Companies with <30 days cash

4. **Working Capital Strain**
   - Current ratio <1.2
   - DSO >60 days
   - DPO <30 days

5. **Revenue Growth Opportunities**
   - YoY growth >20%
   - Quarterly consistency

6. **Credit Risk Assessment**
   - Payment pattern deterioration
   - Risk scoring

7. **Inventory Financing**
   - Turnover <6x annually
   - Financing potential

8. **Seasonal Financing**
   - >40% revenue seasonality
   - Timing analysis

**8 Audit Templates** (Company-specific):
1. **Period Variance Analysis** - Transactions >10% change
2. **Revenue Concentration** - Sales >10% of total
3. **Aged Receivables** - >5% of sales, >120 days old
4. **After-Hours Entries** - After 6pm, weekends
5. **Round Amount Testing** - Potential estimates/fraud
6. **Duplicate Payments** - Same supplier/amount patterns
7. **Revenue Cutoff** - Period-end manipulation
8. **Expense Classification** - Unusual combinations

### User Experience Requirements

#### Dashboard Interface
- **Template Gallery**: Visual cards for each template
- **Quick Actions**: One-click template selection
- **Recent Queries**: History and re-run capability
- **Help System**: Inline guidance and examples

#### Chat Interface
- **Natural Language**: Conversational query input
- **Context Preservation**: Multi-turn conversations
- **Clarification Requests**: Handle ambiguity gracefully
- **Template Suggestions**: Smart recommendations

#### Results Presentation
- **Visualizations**: Charts for trends, tables for details
- **Drill-Down**: Portfolio → Company → Transaction
- **Export Options**: (Future) Excel, PDF formats
- **Explanations**: Why these results matter

### Data Requirements

#### Data Sources
- **General Ledger**: 110K+ journal entries per company
- **Accounts Receivable**: 8K+ sales invoices
- **Accounts Payable**: 24K+ purchase invoices
- **Aging Data**: Pre-calculated aging buckets
- **Master Data**: Customers, suppliers, accounts

#### Data Quality
- **Standardization**: Validis pre-standardized format
- **Completeness**: All required fields populated
- **Accuracy**: Validated during upload process
- **Timeliness**: Most recent upload per company

## Success Metrics

### Quantitative KPIs
- **Response Time**: <1 minute (95th percentile)
- **Query Success Rate**: >90% without clarification
- **User Adoption**: >80% of target users active
- **Time Savings**: 80% reduction vs manual methods
- **Error Rate**: <1% incorrect results

### Qualitative Indicators
- **User Satisfaction**: >4/5 rating
- **Ease of Use**: No training required
- **Trust in Results**: High confidence scores
- **Business Value**: Faster lending/audit decisions

## Competitive Advantage

### Differentiators
1. **No SQL Required**: True natural language interface
2. **Domain Expertise**: Pre-built financial templates
3. **Multi-tenant Ready**: Secure data isolation
4. **Instant Insights**: Real-time query processing
5. **Audit Trail**: Built-in compliance support

### Value Proposition
- **For Lenders**: Identify opportunities 10x faster
- **For Auditors**: Complete audits 50% quicker
- **For Firms**: Democratize data access across teams

## Use Cases

### Lending Scenarios
1. **Monthly Portfolio Review**
   - Run all lending templates
   - Identify top opportunities
   - Flag risks early

2. **New Client Assessment**
   - Quick financial health check
   - Compare to portfolio benchmarks
   - Make informed decisions

3. **Risk Monitoring**
   - Weekly risk dashboard
   - Early warning indicators
   - Proactive intervention

### Audit Scenarios
1. **Year-End Audit**
   - Run standard test suite
   - Document exceptions
   - Create audit trail

2. **Fraud Investigation**
   - After-hours analysis
   - Round amount testing
   - Pattern detection

3. **Quarterly Review**
   - Variance analysis
   - Trend identification
   - Management reporting

## Constraints & Limitations

### POC Limitations
- Templates not customizable
- No export functionality
- English language only
- Single database source
- No collaborative features

### Technical Constraints
- 5000 row result limit
- 3-month portfolio window
- Exact company name matching
- Original currency display only

## Compliance & Security

### Data Protection
- Multi-tenant isolation via client_id
- No cross-client data access
- Encrypted connections
- Audit logging

### Regulatory Compliance
- Financial data handling standards
- Audit trail requirements
- Data retention policies
- User access controls

## Product Roadmap (Post-POC)

### Phase 1: Core Features
- ✅ Template implementation
- ✅ Natural language interface
- ✅ Basic visualizations
- ✅ Multi-tenant support

### Phase 2: Enhanced Features
- Custom template creation
- Export functionality
- Advanced visualizations
- Collaborative features

### Phase 3: Enterprise Features
- API access
- Integration with audit tools
- Custom branding
- Advanced security

### Phase 4: AI Evolution
- Self-learning templates
- Predictive analytics
- Anomaly detection
- Automated insights
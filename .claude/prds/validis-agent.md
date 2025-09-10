---
name: validis-agent
description: Agentic chatbot for natural language querying of standardized financial data for audit firms and lenders
status: backlog
created: 2025-09-10T10:37:32Z
---

# PRD: validis-agent

## Executive Summary

The Validis Agent is an agentic chatbot proof of concept that enables audit firms and lenders to query standardized financial data using natural language. The system eliminates the need for manual SQL queries or Excel manipulation by providing an intuitive chat interface with pre-defined templates and intelligent query generation. The solution leverages specialized AI agents to understand context, generate optimized SQL queries, and present results in meaningful visualizations.

## Problem Statement

### Current Challenges
- **Technical Barrier**: Audit managers, junior auditors, and relationship managers lack SQL expertise but need to query complex financial databases
- **Manual Processes**: Users currently rely on manual Excel spreadsheet modifications and custom SQL scripts
- **Time Inefficiency**: Creating and modifying queries for portfolio analysis or audit procedures is time-consuming
- **Data Access Friction**: Users need quick insights from standardized financial data but face technical barriers

### Why Now
- Advances in LLM technology enable natural language to SQL translation
- Growing demand for real-time financial insights
- Need to democratize data access for non-technical users
- Competitive advantage through faster audit and lending decisions

## User Stories

### Persona 1: Relationship Manager (Lending)
**Background**: Works at a bank or specialized lender, manages portfolio of clients, needs portfolio-wide insights

**User Journey**:
1. Accesses dashboard showing lending templates
2. Selects "Top 20 asset-based finance opportunities"
3. Views portfolio-wide results in charts/tables
4. Drills down into specific companies from results
5. Asks follow-up questions about specific companies

**Acceptance Criteria**:
- Can query entire portfolio without SQL knowledge
- Results returned in <1 minute
- Can drill down from portfolio to company level
- Visual presentation of data (charts/tables)

### Persona 2: Audit Manager
**Background**: Works at audit firm (e.g., PWC), performs year-end audits, needs company-specific analysis

**User Journey**:
1. Accesses dashboard showing audit templates
2. Selects template for specific company (e.g., "Weekend journal entries for ABC Corp")
3. Reviews results for audit exceptions
4. Asks follow-up questions for deeper investigation
5. Documents findings for audit workpapers

**Acceptance Criteria**:
- All queries are company-specific
- Can identify audit exceptions quickly
- Results are audit-ready (clear, documented)
- Can ask complex follow-up questions

### Persona 3: Junior Auditor
**Background**: Limited experience, follows audit procedures, needs guided analysis

**User Journey**:
1. Selects pre-defined audit template
2. Inputs company name
3. Reviews clear, explained results
4. Uses natural language for clarifications

**Acceptance Criteria**:
- Templates guide the audit process
- Clear explanations of results
- No technical knowledge required

## Requirements

### Functional Requirements

#### Core Features
1. **Natural Language Interface**
   - Chat-style interface similar to ChatGPT/Claude
   - No SQL knowledge required
   - Context-aware query understanding

2. **Template System**
   - 5-8 pre-defined templates per category (lending/audit)
   - Templates auto-populate in chat interface
   - Non-customizable in POC phase

3. **Lending Templates** (Portfolio-level aggregations):
   - **Top 20 asset-based finance opportunities across portfolio**
     - Criteria: Companies with AR balance >£100k, AR/Revenue ratio >15%, aging <60 days avg
     - Shows: Company name, AR balance, revenue, AR quality score
   - **Assess accounts receivables quality and aging**
     - Age buckets: Current, 30, 60, 90, 120+ days
     - Shows: Concentration risk, aging trends, collection efficiency
   - **Analyze cash position relative to operational needs**
     - Metrics: Cash balance, monthly burn rate, days cash on hand
     - Shows: Companies with <30 days cash runway
   - **Identify companies with working capital strain**
     - Criteria: Current ratio <1.2, DSO >60 days, DPO <30 days
     - Shows: Working capital metrics, liquidity ratios
   - **Revenue growth opportunities**
     - Shows: YoY revenue growth >20%, consistent quarterly growth
   - **Credit risk assessment**
     - Shows: Companies with deteriorating payment patterns
   - **Inventory financing opportunities**
     - Shows: Companies with inventory turnover <6x annually
   - **Seasonal financing needs**
     - Shows: Companies with >40% revenue seasonality

4. **Audit Templates** (Transaction-level detail):
   - **Identify transactions >10% up/down vs prior period for [Company]**
     - Shows: Transaction details, variance %, account codes, descriptions
   - **Identify sales transactions >10% of total sales for [Company]**
     - Shows: Customer name, invoice details, concentration risk
   - **Identify receivables >5% of total sales outstanding >120 days for [Company]**
     - Shows: Customer, invoice date, amount, days outstanding
   - **Identify journal entries made after hours/weekends for [Company]**
     - After hours: Weekdays after 6pm, weekends, holidays
     - Shows: Entry timestamp, user, description, amounts
   - **Round amount transactions for [Company]**
     - Criteria: Amounts ending in 000, manual entries
     - Shows: Potential estimation or fraud risk
   - **Duplicate payment analysis for [Company]**
     - Shows: Same supplier, amount, and date patterns
   - **Revenue cutoff testing for [Company]**
     - Shows: Sales near period end, potential manipulation
   - **Expense classification review for [Company]**
     - Shows: Unusual account combinations, misclassifications

5. **Query Generation**
   - Automatic SQL generation from natural language
   - Query optimization for large datasets
   - Fallback queries (max 2-3 attempts)
   - Result limiting (top 5000 rows for large results)

6. **Multi-Agent Architecture**
   - Orchestrator Agent: Routes requests to appropriate specialist
   - Lending Agent: Specialized in portfolio-wide queries
   - Audit Agent: Specialized in company-specific audit queries
   - Query Optimizer Agent: Ensures efficient SQL generation
   - Each agent follows single responsibility principle

7. **Response Handling**
   - Markdown formatted responses
   - Dynamic charts/tables based on data type
   - Query explanation/reasoning provided
   - Ambiguity handling with clarification requests

8. **Data Access**
   - Query standardized SQL Server database
   - Access GL, TB, AR, AP data
   - Always use most recent upload per company
   - Multi-tenant isolation via client_id

### Non-Functional Requirements

#### Performance
- Response time: <1 minute (ideally <30 seconds)
- Support millions of transactions in production
- Real-time processing (no batch delays)
- Optimized query generation for large datasets
- **Critical**: Always use clustered index (uploadId) for all queries
- Portfolio queries limited to uploads from last 3 months for performance
- Result sets limited to 5000 rows for initial display

#### Security
- Multi-tenant data isolation via client_id environment variable
- No cross-client data leakage
- Secure database connections
- Audit logging for compliance

#### Scalability
- POC: Low user count
- Production: Support hundreds of concurrent users
- Database queries optimized for millions of records
- Horizontal scaling capability for agents

#### Usability
- Intuitive UI requiring no training
- Clear error messages
- Natural language only (no technical inputs)
- Modern, responsive interface

#### Technical Stack
- Frontend: React with TypeScript
- Backend: Agent framework (to be determined)
- Database: SQL Server (existing)
- Deployment: Environment variables for configuration

## Success Criteria

### Quantitative Metrics
- Query response time <1 minute (95th percentile)
- 90% of queries successfully answered without clarification
- 80% reduction in time to get financial insights vs manual methods
- Zero cross-client data exposure incidents

### Qualitative Metrics
- User satisfaction score >4/5
- Users can complete tasks without technical support
- Clear, actionable insights from queries
- Positive feedback from pilot customers (Barclays, Santander, PWC)

### POC Success Indicators
- All defined templates functioning correctly
- Natural language understanding accurate for domain
- Multi-tenant isolation verified
- Performance meets requirements with sample data

## Constraints & Assumptions

### Constraints
- Must use existing SQL Server database structure
- Cannot modify existing database schema
- Must maintain multi-tenant isolation
- POC timeline (to be determined)
- Limited to English language initially

### Assumptions
- Upload table always contains recent data for each company
- Client_id available via environment variables
- Users have basic familiarity with financial terms
- Network connectivity reliable for real-time processing
- Database performance adequate for complex queries

### Technical Limitations
- No custom template creation in POC
- No export functionality in POC
- No audit trail UI in POC (logs only)
- Limited to predefined query patterns initially

## Out of Scope

### POC Phase Exclusions
- Custom template creation by users
- Export functionality (Excel, PDF)
- Audit trail user interface
- Integration with existing Validis platform services
- External API integrations
- Authentication/authorization system (using env variables)
- Machine learning model training on user feedback
- Multi-language support
- Mobile application
- Offline capability
- Historical query tracking/favorites
- Collaborative features
- Advanced visualizations beyond basic charts/tables

### Future Considerations (Post-POC)
- User feedback UI for query quality
- Template customization
- Advanced export capabilities
- Full audit trail interface
- Platform integration
- Custom authentication system

## Dependencies

### External Dependencies
- SQL Server database availability and performance
- Network connectivity for database access
- Client-specific environment variables configuration

### Internal Team Dependencies
- Database team: Schema documentation and access credentials
- DevOps team: Environment setup and deployment
- Product team: Template refinement and user acceptance criteria
- QA team: Testing multi-tenant isolation and performance
- Customer Success: Pilot customer coordination

### Technical Dependencies
- Database schema documentation
- Table relationships mapping
- Business rules documentation (e.g., "working capital strain" definition)
- Sample data for each client (POC testing)
- Environment variable configuration per client

### Data Dependencies
- Upload table with recent financial data
- GL (General Ledger) data
- TB (Trial Balance) data
- AR (Accounts Receivable) data
- AP (Accounts Payable) data
- Historical audit data for comparison queries

## Risk Mitigation

### Technical Risks
- **Query Performance**: Mitigate with query optimization agent and result limiting
- **Data Isolation**: Rigorous testing of client_id filtering
- **Ambiguous Queries**: Clear fallback to user clarification

### Business Risks
- **User Adoption**: Intuitive templates and UI design
- **Accuracy Concerns**: Query explanation feature and validation testing
- **Scalability**: Architecture designed for horizontal scaling

## Technical Architecture

### Database Schema
- **Core Tables**:
  - `upload`: Company data uploads (filtered by client_id)
  - `transactionHeader/Line`: General ledger entries
  - `saleHeader/Line`: Accounts receivable
  - `purchaseHeader/Line`: Accounts payable
  - `saleAged/purchaseAged`: Aging analysis
  - `account`: Chart of accounts
  - `customer/supplier`: Counterparty master data

### Query Patterns
1. **Portfolio Queries** (Lending):
   ```sql
   SELECT company_id, metrics
   FROM relevant_tables
   WHERE client_id = @client_id
   AND upload_date >= DATEADD(month, -3, GETDATE())
   GROUP BY company_id
   ```

2. **Company Queries** (Audit):
   ```sql
   SELECT transaction_details
   FROM relevant_tables
   WHERE uploadId = (SELECT TOP 1 upload_id FROM upload 
                     WHERE client_id = @client_id 
                     AND sme_id = @company_id
                     ORDER BY upload_date DESC)
   ```

### Data Access Strategy
- Always filter by uploadId for performance (clustered index)
- Use latest upload per company unless historical comparison needed
- Company name matching: Exact match on company name from upload table
- Date comparisons use financialPeriodId for consistency
- Monetary values kept in original currency (no conversion)

## Implementation Phases

### Phase 1: POC Development
- Core agent architecture
- Template implementation
- Basic UI with dashboard and chat interface
- Multi-tenant isolation
- Performance optimization

### Phase 2: Pilot Testing
- Deploy to select customers (Barclays, Santander, PWC)
- Gather feedback
- Performance tuning
- Bug fixes

### Phase 3: Production Readiness
- Scalability improvements
- Additional templates based on feedback
- Monitoring and alerting
- Documentation

## Appendix

### Sample Queries by User Type

#### Lending (Portfolio-Wide)
- "Show me top 20 companies by revenue growth"
- "Which clients have deteriorating cash positions?"
- "Identify AR concentration risks across portfolio"

#### Audit (Company-Specific)
- "Show journal entries for ABC Corp posted after 6pm"
- "Find related party transactions for XYZ Ltd"
- "Identify revenue recognition anomalies for ABC Corp"

### Database Context Requirements
- Full schema access for agent context
- Table relationship mappings
- Business rule definitions
- Data type specifications
- Index information for optimization
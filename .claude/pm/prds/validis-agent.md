---
name: validis-agent
description: Natural language query interface for auditors and lenders to analyze standardized financial data
status: backlog
created: 2025-08-28T11:44:30Z
---

# PRD: validis-agent

## Executive Summary

The Validis Agent is a natural language query interface that enables auditors and relationship managers to ask conversational questions about standardized financial data sets. Similar to ChatGPT or Claude, users can ask questions in plain English and receive intelligent, data-driven responses. The system supports two distinct workflows:

1. **Audit Workflow**: Company-specific deep dives for auditors examining a single entity's financial records, transactions, and compliance
2. **Lending Workflow**: Portfolio-wide analysis for relationship managers, with the ability to identify opportunities across all clients and then drill down into specific companies

The system uses an agent framework to understand query context, translate natural language to database queries, analyze the underlying data, and return actionable insights tailored to each workflow's unique requirements.

## Problem Statement

### Current Challenges

#### Audit Workflow Challenges
- **Company Context Lost**: Auditors must repeatedly specify which company they're analyzing
- **Deep Dive Difficulty**: Complex queries about specific transactions require technical expertise
- **Compliance Tracking**: Hard to verify all required procedures for a specific entity
- **Historical Comparison**: Difficult to track changes in a company's patterns over time

#### Lending Workflow Challenges  
- **Portfolio Blindness**: Can't easily see opportunities across entire portfolio
- **Comparison Complexity**: Difficult to rank and compare companies by lending potential
- **Drill-Down Friction**: Moving from portfolio view to specific company requires new tools
- **Opportunity Discovery**: Missing lending opportunities due to inability to query broadly

#### Shared Challenges
- **Technical Barrier**: Users must know SQL or rely on technical staff
- **Slow Insights**: Days or weeks waiting for analyst teams
- **Limited Exploration**: Can't easily explore "what-if" scenarios
- **Context Loss**: Each query is isolated without business context

### Why Now
- Natural language AI can now handle complex financial queries with context awareness
- Standardized data sets enable consistent analysis across companies
- Regulatory pressure requires more thorough company-specific auditing
- Competitive lending environment demands rapid portfolio-wide opportunity identification
- Both workflows need unified platform to share insights and reduce redundancy

## User Stories

### Primary Persona: Relationship Manager (Lending - Portfolio Wide)
**As a** Relationship Manager  
**I want to** query across my entire portfolio and drill into specific companies  
**So that** I can identify lending opportunities systematically then pursue them individually  
**Acceptance Criteria:**
- Start with portfolio queries: "Show me all companies with revenue growth >20% and debt capacity"
- See ranked lists of opportunities across entire portfolio
- Drill down: "Tell me more about Company X from that list"
- Compare companies: "How does Company X compare to Company Y for lending?"
- Context maintained when switching between portfolio and company view
- Export both portfolio summaries and company-specific reports

### Senior Auditor (Company-Specific)
**As a** Senior Auditor  
**I want to** set a company context and ask multiple questions about that specific entity  
**So that** I can conduct thorough audit procedures without repeatedly specifying the company  
**Acceptance Criteria:**
- Set context: "I'm auditing ABC Corporation"
- All subsequent queries apply to ABC Corp: "Show me unusual journal entries"
- Ask follow-ups: "Now show me related party transactions"
- Compare to history: "How does this year's revenue pattern compare to last year?"
- Context persists throughout audit session
- Generate company-specific audit reports

### Credit Analyst (Lending Mode with Deep Dive)
**As a** Credit Analyst  
**I want to** analyze portfolio-wide risks and examine specific troubled accounts  
**So that** I can manage both systematic risk and individual client issues  
**Acceptance Criteria:**
- Login determines lending mode access
- Portfolio view: "Show me all clients with deteriorating debt coverage ratios"
- Identify concentration risk: "What's our exposure by industry?"
- Drill down: "Deep dive on Company Z's covenant compliance"
- Navigate from portfolio to company and back within lending workflow
- Generate both portfolio risk reports and company-specific analyses

### Audit Partner (Audit Mode)
**As an** Audit Partner  
**I want to** review specific audit findings for my assigned company  
**So that** I can ensure thorough audit completion and identify issues  
**Acceptance Criteria:**
- Login determines audit mode access
- Set company at start: "Reviewing audit for DEF Company"
- All queries apply to DEF Company for entire session
- Pattern analysis: "Show revenue recognition issues in DEF"
- Historical comparison: "How has DEF's control environment changed?"
- Cannot switch to other companies without new session
- Generate company-specific audit reports only

## Workflow Distinctions

### Audit Workflow (Company-Specific)
**Context**: Auditor focuses on ONE company for entire session
**Pattern**: Set context → Multiple queries → Deep analysis → Report

**Example Session**:
```
Auditor: "I'm auditing Acme Corporation for fiscal year 2024"
System: "Context set to Acme Corporation FY2024. What would you like to analyze?"
Auditor: "Show me all journal entries over $500K"
System: [Returns Acme-specific results]
Auditor: "Which of those were posted on weekends?"
System: [Filters previous Acme results]
Auditor: "Compare this pattern to last year"
System: [Shows Acme FY2024 vs FY2023]
```

### Lending Workflow (Portfolio-Wide with Drill-Down)
**Context**: Start broad across portfolio, drill into specific opportunities
**Pattern**: Portfolio query → Ranking → Selection → Company deep-dive → Action

**Example Session**:
```
Lender: "Which companies in my portfolio have unused debt capacity?"
System: [Returns ranked list of 50 companies with metrics]
Lender: "Focus on the top 5 in manufacturing"
System: [Filters to 5 manufacturing companies]
Lender: "Tell me more about GlobalManufacturing Inc"
System: [Switches to company context with details]
Lender: "What lending products would suit them?"
System: [Analyzes GlobalManufacturing specifically]
Lender: "Go back to portfolio view - show me retail sector"
System: [Returns to portfolio-wide context]
```

### Workflow Mode Determination
1. **Proof of Concept**: Mode set via environment variable (WORKFLOW_MODE=audit|lending)
2. **Production**: Mode determined by user login role from portal
3. **No Mode Switching**: Users cannot switch between audit/lending modes within a session
4. **Context Rules**:
   - **Audit Mode**: Always company-specific, must set company at session start
   - **Lending Mode**: Defaults to portfolio, can drill into specific companies
5. **Session Persistence**: Mode and context maintained throughout entire session

## Requirements

### Functional Requirements

#### Core Capabilities
1. **Natural Language Processing**
   - Understand complex financial queries in plain English
   - Context awareness across conversation threads
   - Multi-turn dialogue support
   - Intent recognition and entity extraction
   - Clarification requests when queries are ambiguous

2. **Workflow Management**
   - **Mode Configuration**: 
     - POC: Read from environment variable (WORKFLOW_MODE)
     - Production: Determined by user authentication/role from portal
   - **Audit Mode**: Single company context persistence for entire session
   - **Lending Mode**: Portfolio-wide default with drill-down capability
   - **No Cross-Mode Switching**: Users cannot change between audit/lending modes
   - **Context Management**: 
     - Audit: Set company once, applies to all queries
     - Lending: Navigate between portfolio and company views
   - **Session Memory**: Remember context across entire conversation

3. **Agent Framework**
   - Query understanding agent to parse user intent
   - Schema mapping agent to identify relevant data tables
   - Query validation agent to ensure performance safety
   - SQL generation agent to create optimized queries (MUST use upload table pattern)
   - Analysis agent to interpret results
   - Response generation agent to format insights

4. **Data Query Engine**
   - **Upload Table Pattern**: ALL queries MUST join through upload table using clustered index
   - **Query Safety**: Automatic TOP clause injection, 5-second timeout, row limit enforcement
   - **Performance Optimization**: Query governor to prevent full table scans
   - **Caching Strategy**: Recent upload_ids cached per client
   - **Portfolio Limitations**: Maximum 20 companies per portfolio query
   - **Predefined Templates**: Start with SQL templates, not fully dynamic generation

5. **Context Management**
   - Maintain conversation history
   - Understand references to previous queries
   - Learn user preferences and common patterns
   - Domain-specific context (lending vs. audit)
   - Role-based context filtering

6. **Response Generation**
   - Natural language explanations of results
   - Data visualizations (charts, graphs, tables)
   - Ranked lists with reasoning
   - Trend identification and insights
   - Actionable recommendations

7. **Integration Capabilities**
   - Connect to standardized data warehouse
   - API endpoints for chat interface
   - Export functionality (Excel, PDF, API)
   - Webhook support for alerts
   - SSO authentication

8. **Authentication & Mode Configuration**
   - **POC Phase**:
     - Environment variable: `WORKFLOW_MODE=audit` or `WORKFLOW_MODE=lending`
     - Environment variable: `CLIENT_ID={uuid}` for security scoping
     - Set at application startup
     - Cannot be changed during runtime
   - **Production Phase**:
     - User authentication via portal login
     - Role-based workflow assignment:
       - Auditor role → Audit mode
       - Relationship Manager role → Lending mode
       - Credit Analyst role → Lending mode
     - Client scoping from JWT token claims
     - Mode and client locked for entire session
     - JWT token carries workflow mode and authorized client_id claims

9. **Security & Data Scoping**
   - **Client-Level Security**: ALL queries MUST be scoped to specific client_id
     - POC: Client ID from environment variable
     - Production: Client ID(s) from JWT token
   - **Query Enforcement**: Every upload table query includes `WHERE client_id = @clientId`
   - **Multi-Tenancy**: Complete data isolation between clients
   - **Audit Mode**: Scoped to single client AND single company
   - **Lending Mode**: Scoped to single client's portfolio only
   - **No Cross-Client Access**: System cannot query across different client_ids

### Non-Functional Requirements

#### Performance
- Query response time <3 seconds for 90% of queries
- Support 500 concurrent conversations
- Handle datasets with 100M+ records
- 99.9% uptime availability
- Sub-second autocomplete suggestions

#### Security
- Row-level security based on user permissions
- End-to-end encryption for all communications
- Query audit trail for compliance
- Data masking for sensitive information
- Multi-factor authentication required

#### Scalability
- Horizontal scaling for agent processing
- Cached query results for common questions
- Distributed query processing
- Auto-scaling based on load
- Multi-region deployment capability

#### Usability
- No training required for basic queries
- Intuitive conversation flow
- Clear error messages and suggestions
- Mobile-responsive interface
- Accessibility compliance (WCAG 2.1)

## Success Criteria

### Key Metrics
1. **User Engagement**
   - 80% of users asking >10 queries per week
   - 90% query success rate (user gets useful answer)
   - Average conversation length of 3-5 queries
   - <10 seconds to first query after login

2. **Business Value**
   - 50% reduction in time to insights
   - 30% increase in identified lending opportunities
   - 40% reduction in analyst workload
   - 25% increase in portfolio growth

3. **Query Performance**
   - 95% of queries answered in <3 seconds
   - 99% accuracy in data retrieval
   - Zero incorrect calculations
   - 90% user satisfaction with answers

4. **Adoption Metrics**
   - 100% of relationship managers using within 3 months
   - 75% of auditors using for risk assessment
   - 500+ unique queries per day
   - 50% of queries are follow-ups (showing engagement)

## Constraints & Assumptions

### Technical Constraints
- Must work with existing standardized data schema
- Query response time limits for complex joins
- LLM token limits for long conversations
- Database read-only access (no writes)
- Existing data warehouse infrastructure

### Business Constraints
- 6-month initial development timeline
- $1.5M initial budget
- Team of 6-8 developers
- Must integrate with existing auth systems
- Cannot modify underlying data structures

### Assumptions
- Standardized data is clean and current
- Users understand basic financial concepts
- Natural language models can understand domain terminology
- Database performance can handle concurrent queries
- Users have stable internet connections

## Out of Scope

The following items are explicitly NOT included in this phase:
- Data entry or modification capabilities
- Real-time data streaming
- Custom report builders
- Automated decision making (only recommendations)
- Integration with external data sources
- Training custom ML models per client
- Voice interface
- Automated lending approval
- Document upload and OCR
- Predictive modeling beyond basic trends

## Dependencies

### External Dependencies
- **LLM Provider**: Anthropic Claude API for natural language understanding (POC focus)
- **Cloud Infrastructure**: AWS/Azure for hosting and scaling
- **Database**: Access to standardized data warehouse
- **Authentication**: Existing SSO/Active Directory
- **Analytics**: Tracking and monitoring services

### Internal Dependencies
- **Data Team**: Maintain standardized schema and data quality
- **Security Team**: Implement row-level security
- **DevOps**: Deploy and scale agent infrastructure
- **UX Team**: Design conversational interface
- **QA Team**: Test query accuracy and performance
- **Business Team**: Define domain rules and calculations

## Technical Architecture Considerations

### Database Query Architecture
- **Critical Requirement**: ALL queries MUST start from the upload table
  - Upload table has clustered index on upload_id
  - Direct queries to transaction tables cause full table scans
  - Performance degrades catastrophically without upload table join
- **Query Pattern Enforcement**:
  ```sql
  -- REQUIRED PATTERN (with client scoping)
  FROM dbo.upload u
  WHERE u.client_id = @clientId  -- MANDATORY security filter
    AND u.status = 'COMPLETED'
  INNER JOIN dbo.company c ON u.upload_id = c.uploadId
  INNER JOIN dbo.transactionHeader th ON u.upload_id = th.uploadId
  -- Never query transaction tables directly
  -- Always filter by client_id FIRST
  ```
- **Portfolio Query Strategy**:
  - Use CTE to identify most recent upload per client
  - Limit results with TOP clause (max 20 companies)
  - Implement pagination for larger result sets
- **Performance Safeguards**:
  - Query timeout: 5 seconds maximum
  - Row limit: 10,000 rows maximum per query
  - Automatic TOP 100 injection if not specified
  - Query cost estimation before execution

### Agent Architecture
- **Query Understanding Agent**: Parses natural language to intent
- **Context Agent**: Maintains conversation state and history
- **Workflow Agent**: Enforces audit vs lending mode rules
- **Schema Agent**: Maps queries to database structure  
- **SQL Agent**: Generates optimized queries
- **Analysis Agent**: Interprets results and finds insights
- **Response Agent**: Formats answers in natural language

### Mode Configuration
- **Environment Setup**:
  ```
  # POC Configuration
  WORKFLOW_MODE=audit  # or 'lending'
  COMPANY_CONTEXT=null # set by user in audit mode
  
  # Production Configuration
  Read from JWT token claims:
  - user_role: 'auditor' | 'relationship_manager' | 'credit_analyst'
  - workflow_mode: derived from user_role
  - authorized_companies: list of companies user can access
  ```

### Infrastructure
- API Gateway for request routing
- Message queue for agent communication
- Redis cache for query results
- Vector database for semantic search
- Session store for conversation state

### Data Layer
- Read replicas for query isolation
- Materialized views for common aggregations
- Query result caching
- Connection pooling for performance

## Rollout Strategy

### Phase 1: MVP (Months 1-2)
- Basic natural language query for financial metrics
- Simple lending opportunity identification
- Core agent framework
- 10 most common query types
- Web interface

### Phase 2: Context & Intelligence (Months 3-4)
- Multi-turn conversations
- Context awareness
- Advanced lending analysis
- Audit risk queries
- Query suggestions and autocomplete

### Phase 3: Scale & Sophistication (Months 5-6)
- Complex multi-table joins
- Trend analysis and predictions
- Saved queries and alerts
- API access for integration
- Mobile interface

## Risk Mitigation

### Technical Risks
- **Query Misinterpretation**: Implement clarification dialogues and confidence scores
- **Performance Degradation**: Query optimization and caching strategies
- **Data Inconsistencies**: Validation layer and data quality monitoring

### Business Risks
- **User Trust**: Transparent explanations and audit trails
- **Adoption Barriers**: Intuitive interface and embedded training
- **Incorrect Insights**: Human review for critical decisions

## Appendix

### Example Queries

#### Lending Queries (Portfolio-Wide)
- "Show me all companies with revenue growth >20% and debt-to-equity <1"
- "Rank my entire portfolio by unused debt capacity"
- "Which companies in retail have improved cash flow this quarter?"
- "What's the total lending opportunity across all clients with credit scores >700?"
- "List top 10 businesses that could handle 50% more debt based on coverage ratios"
- "Show me portfolio concentration by industry and identify gaps"

#### Lending Queries (Company Drill-Down)
- "Tell me more about TechCorp from that list"
- "What's TechCorp's current debt structure?"
- "How does TechCorp compare to industry peers for lending?"
- "What lending products would best suit TechCorp's growth plans?"
- "Show me TechCorp's cash flow trends over 3 years"

#### Audit Queries (Company-Specific Context)
- "I'm auditing MegaCorp for 2024"
- "Show all journal entries over $50K posted after business hours"
- "Find vendors paid multiple times for the same invoice"  
- "Which accounts have unusual variance compared to prior year?"
- "Identify all related party transactions"
- "Show me revenue recognition patterns by month"
- "Flag any entries by terminated employees"

#### Mode-Specific Navigation
**Audit Mode** (Company locked):
- "Show me all issues for this company"
- "Compare to last year's audit"
- "What are the high-risk areas?"
- (Cannot switch to other companies)

**Lending Mode** (Portfolio + Drill-down):
- "Show portfolio opportunities"
- "Drill into TechCorp details"
- "Back to portfolio view"
- "Compare these 3 companies"

### Glossary
- **NLP**: Natural Language Processing
- **LLM**: Large Language Model
- **Agent**: Specialized AI component for specific tasks
- **Context**: Conversation history and state
- **Schema**: Database structure and relationships

### Technical Stack Considerations
- **LLM**: Claude (Anthropic) - POC focus
- **Agent Framework**: LangChain (with Anthropic integration)
- **Database**: SQL Server (existing)
- **Cache**: Redis
- **API**: REST (Express/Node.js)
---
name: validis-agent
status: in-progress
created: 2025-08-28T12:41:56Z
updated: 2025-08-28T14:17:54Z
progress: 0%
prd: .claude/pm/prds/validis-agent.md
github: https://github.com/validis-group-holdings/validis-agent-psc/issues/1
---

# Epic: validis-agent

## Overview

Build a natural language query interface that enables auditors and lenders to interact with standardized financial data through conversational AI. The system will leverage LangChain or similar agent framework to translate natural language queries into SQL, execute them against the existing data warehouse, and return insights in plain English. Two distinct workflows (audit and lending) will be supported through configuration, not complex branching logic.

## Architecture Decisions

### Core Technology Stack
- **LLM Integration**: Anthropic Claude API for natural language understanding (POC focus)
- **Agent Framework**: LangChain for orchestrating agent pipeline (supports Anthropic)
- **Backend**: Node.js/Express API (consistent with existing services)
- **Database**: Read-only connection to existing standardized data warehouse
- **Caching**: Redis for query result caching (already in infrastructure)
- **Authentication**: JWT tokens from existing portal (no new auth system needed)

### Key Design Decisions
1. **Stateless Agents**: Each agent handles one task, making the system modular and testable
2. **Mode via Configuration**: Workflow mode (audit/lending) from env var or JWT - no complex switching logic
3. **Client Security Scoping**:
   - ALL queries filtered by CLIENT_ID from environment variable (POC)
   - Production: CLIENT_ID from JWT token claims
   - Complete data isolation between clients
   - No cross-client data access possible
4. **SQL Generation with Strict Patterns**: 
   - ALL queries MUST use upload table as entry point
   - MUST include client_id filter as first WHERE clause
   - Enforce clustered index usage on upload_id
   - Template-based queries initially, not fully dynamic SQL
5. **Query Safety Layer**:
   - Query validator checks estimated cost before execution
   - Automatic TOP clause injection (max 100 rows default)
   - 5-second timeout on all queries
   - Query governor prevents full table scans
6. **Conversation Context**: Use Redis to maintain conversation state between requests
7. **Leverage Existing**: Use existing auth, database, and infrastructure - minimize new components

## Technical Approach

### Frontend Components
- **Chat Interface**: Simple React component (similar to ChatGPT interface)
- **Message History**: Display conversation thread with context
- **Query Suggestions**: Autocomplete common queries based on mode
- **Export Options**: CSV/PDF download buttons for results
- **Mode Indicator**: Clear visual showing audit vs lending mode

### Backend Services
- **API Gateway**: Single Express server with following endpoints:
  - `POST /api/query` - Main query endpoint
  - `GET /api/session` - Retrieve conversation history
  - `POST /api/export` - Export results
  - `GET /api/suggestions` - Query autocomplete

- **Agent Pipeline** (using LangChain):
  1. Query Parser Agent - Extract intent and entities
  2. Context Agent - Apply workflow mode rules
  3. Query Validator Agent - Check query safety and performance impact
  4. SQL Generator Agent - Create queries using upload table pattern
  5. Query Governor Agent - Inject safety clauses (TOP, timeout)
  6. Executor Agent - Run queries with monitoring
  7. Response Formatter Agent - Natural language response

### Data Layer
- **Existing Data Warehouse**: Read-only access to standardized financial data
- **Upload Table Strategy with Client Security**:
  ```sql
  -- Every query starts here with client scoping
  DECLARE @clientId VARCHAR(50) = '${process.env.CLIENT_ID}'; -- POC: from env var
  
  WITH RecentUploads AS (
    SELECT upload_id, client_id,
           ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY creation_date DESC) as rn
    FROM dbo.upload 
    WHERE client_id = @clientId  -- MANDATORY security filter
      AND status = 'COMPLETED'
  )
  -- Then join to other tables using upload_id
  -- Client isolation is enforced at the upload table level
  ```
- **Query Templates**: 20-30 pre-built SQL templates using upload pattern
- **Performance Views**: 
  - Recent uploads per client (cached daily)
  - Company summary metrics (pre-aggregated)
  - Portfolio overview (limited to TOP 20)
- **Result Caching**: Cache frequent queries in Redis with 1-hour TTL

### Infrastructure
- **Deployment**: Containerized Node.js app on existing Kubernetes cluster
- **Scaling**: Horizontal pod autoscaling based on request volume
- **Monitoring**: Existing Datadog/Prometheus setup
- **Security**: Row-level security via existing database roles

## Implementation Strategy

### Environment Configuration (POC)
```bash
# Required environment variables
WORKFLOW_MODE=audit          # or 'lending'
CLIENT_ID=e523c1dd-4255-47b5-b880-6f7b981d0841  # UUID from upload table
DATABASE_CONNECTION_STRING=... # Read-only connection
ANTHROPIC_API_KEY=...       # Anthropic API key for Claude
ANTHROPIC_MODEL=claude-3-opus-20240229  # or claude-3-sonnet-20240229
REDIS_URL=...               # For caching
```

### Phase 1: MVP (Weeks 1-2)
- Basic chat interface
- Core agent pipeline with LangChain
- 10 common query patterns with client scoping
- Environment-based mode and client configuration
- Simple response formatting

### Phase 2: Context & Polish (Weeks 3-4)
- Conversation memory
- Query suggestions
- Result export
- Error handling and clarifications
- Performance optimization

### Phase 3: Production Ready (Weeks 5-6)
- JWT authentication integration
- Audit logging
- Load testing
- Documentation
- Deployment automation

## Task Breakdown Preview

Keeping implementation simple and leveraging existing infrastructure:

- [ ] **Setup & Configuration**: Initialize Node.js service with LangChain, configure env variables, database connection with upload table pattern
- [ ] **Query Safety Layer**: Implement query validator, governor, and performance monitoring agents
- [ ] **Agent Pipeline**: Implement 7 core agents including safety validators using LangChain
- [ ] **Query Templates**: Create 20-30 SQL templates ALL using upload table pattern for common queries
- [ ] **API Development**: Build 4 REST endpoints with Express, integrate auth and query timeouts
- [ ] **Chat Interface**: Simple React component with message history, mode indicator, and export
- [ ] **Mode Management**: Implement audit/lending workflow rules with proper upload_id scoping
- [ ] **Testing & Safety**: Query performance tests, timeout validation, safety injection tests
- [ ] **Deployment**: Dockerize with resource limits, K8s manifests, monitoring alerts

Total: 9 focused tasks with emphasis on query safety and performance

## Dependencies

### External Dependencies
- **LLM API**: Anthropic Claude API key and model selection
- **Existing Services**: Authentication portal, standardized data warehouse
- **Infrastructure**: Redis, Kubernetes cluster, monitoring tools

### Internal Dependencies
- **Data Team**: Provide read-only database credentials and schema documentation
- **Security Team**: Approve row-level security implementation
- **Platform Team**: Assist with Kubernetes deployment and monitoring setup

### Prerequisites
- Standardized data schema must be stable
- Portal authentication must support JWT with role claims
- Database performance can handle concurrent read queries

## Success Criteria (Technical)

### Performance Benchmarks
- Query response time < 3 seconds for 95% of requests (with 5-second hard timeout)
- No query can scan more than 10,000 rows
- All queries must use upload table clustered index
- Support 50 concurrent users (reduced from 100 for safety)
- 99% uptime during business hours
- Cache hit rate > 60% for common queries
- Zero database deadlocks or table scans

### Quality Gates
- 80% unit test coverage
- All SQL queries pass security review (no injection vulnerabilities)
- Zero data modification capabilities
- Audit log captures all queries with user context

### Acceptance Criteria
- Successfully answers 10 pre-defined test queries per workflow
- Mode enforcement prevents cross-workflow access
- Export functionality produces valid CSV/PDF
- Error messages are helpful and non-technical

## Estimated Effort

### Timeline
- **Total Duration**: 6 weeks
- **Team Size**: 2-3 developers
- **Critical Path**: LLM integration → Agent pipeline → API development

### Resource Requirements
- 1 Full-stack developer (React + Node.js)
- 1 Backend developer (LangChain + SQL)
- 0.5 DevOps engineer (weeks 5-6 for deployment)

### Simplification Opportunities
- Use LangChain's pre-built agents instead of custom implementations
- Leverage existing auth instead of building new system
- Start with hardcoded SQL templates before dynamic generation
- Use simple React instead of complex UI framework
- Deploy on existing infrastructure vs. new architecture

### Critical Risks Identified
- **Database Performance**: Direct queries to transaction tables will cause system failure
  - Mitigation: Enforce upload table pattern in all queries
- **Query Complexity**: Portfolio-wide queries can timeout or crash database
  - Mitigation: Hard limits on result sets, mandatory TOP clauses
- **Index Usage**: Missing upload_id in joins causes full table scans
  - Mitigation: Query validator checks for upload table join
- **Concurrent Load**: Multiple portfolio queries could overwhelm database
  - Mitigation: Query queue with concurrency limits
- **Data Security**: Cross-client data exposure risk
  - Mitigation: Mandatory client_id filtering at upload table level
  - All queries must include WHERE client_id = @clientId
  - No ability to query across multiple clients

## Tasks Created
- [ ] 001.md - Setup & Configuration (parallel: false)
- [ ] 002.md - Query Safety Layer (parallel: true)
- [ ] 003.md - Query Templates (parallel: true)
- [ ] 004.md - Agent Pipeline Implementation (parallel: false)
- [ ] 005.md - API Development (parallel: true)
- [ ] 006.md - Chat Interface (parallel: true)
- [ ] 007.md - Mode Management Implementation (parallel: false)
- [ ] 008.md - Testing & Safety Validation (parallel: false)
- [ ] 009.md - Deployment & DevOps (parallel: false)

Total tasks: 9
Parallel tasks: 4
Sequential tasks: 5
Estimated total effort: 140-180 hours
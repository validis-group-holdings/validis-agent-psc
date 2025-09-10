---
name: validis-agent
status: backlog
created: 2025-09-10T11:27:42Z
progress: 0%
prd: .claude/prds/validis-agent.md
github: https://github.com/validis-group-holdings/validis-agent-psc/issues/19
---

# Epic: validis-agent

## Overview
Implement a multi-agent AI chatbot that dynamically translates natural language queries into optimized SQL for financial data analysis. The system uses specialized agents (Orchestrator, Lending, Audit, Query Optimizer) to handle varied queries and follow-ups, with templates providing guidance but not limiting flexibility. Built with React/TypeScript frontend and Node.js backend using Anthropic Claude Sonnet.

## Architecture Decisions

### Multi-Agent Strategy
- **Orchestrator Agent**: Routes requests to appropriate specialist based on intent
- **Lending Agent**: Handles portfolio-wide queries with lending-specific context and prompts
- **Audit Agent**: Handles company-specific queries with audit-specific context and prompts  
- **Query Optimizer Agent**: Reviews and optimizes generated SQL for performance (using indexes)
- Each agent has tailored prompts and context for their domain

### Dynamic SQL Generation
- Agents generate SQL dynamically based on natural language input
- Templates provide structure and examples but don't constrain queries
- Full database schema provided to agents as context
- Support for complex follow-up questions and query refinement
- Agents understand business logic (e.g., what constitutes "working capital strain")

### Technology Choices
- **Frontend**: React 18 with TypeScript (separate from backend)
- **Backend**: Node.js with Express/Fastify for API
- **LLM**: Anthropic Claude Sonnet (claude-sonnet-4-20250514) via environment variables
- **Agent Framework**: LangChain for agent orchestration and memory management
- **Database**: mssql package for SQL Server connection
- **UI Library**: Material-UI or Ant Design for rapid component development

### Design Patterns
- **Agent Pattern**: Specialized agents with single responsibility
- **Chain of Thought**: Agents explain their reasoning before generating SQL
- **Context Injection**: Database schema and business rules provided to agents
- **Conversation Memory**: Maintain context across chat interactions

## Technical Approach

### Frontend Components
- React SPA with:
  - Dashboard with template cards (starting points)
  - Chat interface with message history
  - Results viewer (dynamic tables/charts based on data)
  - Template selector (Lending vs Audit categories)
- API integration for backend communication

### Backend Services
- **API Endpoints**:
  - `POST /api/chat` - Process natural language queries
  - `GET /api/templates` - List available template starting points
  - `POST /api/query/execute` - Execute generated SQL
  - `GET /api/schema` - Provide schema context to agents

- **Agent Implementation**:
  - Orchestrator: Analyzes intent and routes to Lending/Audit
  - Lending Agent: Portfolio queries with full schema context
  - Audit Agent: Company queries with audit procedures context
  - Query Optimizer: Ensures uploadId usage, adds limits, optimizes joins

### Database Context System
- Load full schema into agent context
- Include table relationships and indexes
- Provide business rule definitions
- Sample queries for each template type

## Implementation Strategy

### Development Phases
1. **Foundation**: Set up project structure, database connection, Anthropic integration
2. **Agent System**: Implement multi-agent architecture with LangChain
3. **Context & Prompts**: Create detailed prompts for each agent with schema context
4. **API Layer**: Build Express API with all endpoints
5. **Frontend**: Create React UI with chat and templates
6. **Integration**: Connect all components and test end-to-end

### Risk Mitigation
- Start with one agent (Orchestrator) to prove concept
- Test SQL generation with actual database early
- Iterate on prompts based on query accuracy
- Log all generated SQL for debugging

### Testing Approach
- Unit tests for each agent's logic
- Integration tests for agent coordination
- SQL validation tests (syntax and performance)
- End-to-end tests with real queries

## Task Breakdown Preview

High-level tasks to implement the multi-agent solution:

- [ ] **Task 1: Project Setup & Core Infrastructure** - Initialize Node.js backend and React frontend, set up TypeScript, configure mssql connection, integrate Anthropic SDK

- [ ] **Task 2: Database Context System** - Create schema loader, build context documents with table relationships, indexes, and business rules for agent consumption

- [ ] **Task 3: Orchestrator Agent** - Implement routing logic to identify lending vs audit queries, maintain conversation context, handle ambiguous requests

- [ ] **Task 4: Domain Agents (Lending & Audit)** - Create specialized agents with tailored prompts, implement dynamic SQL generation from natural language, include template examples as guidance

- [ ] **Task 5: Query Optimizer Agent** - Build SQL optimization logic ensuring index usage, add safety limits and multi-tenant filtering, validate generated queries

- [ ] **Task 6: Backend API Layer** - Implement Express/Fastify routes, create agent coordination logic, handle query execution and result formatting

- [ ] **Task 7: React Chat Interface** - Build chat UI with message history, implement real-time query status updates, add template quick-select options

- [ ] **Task 8: Results Visualization** - Create dynamic table/chart components, implement drill-down capabilities, format financial data appropriately

- [ ] **Task 9: Error Handling & Refinement** - Add comprehensive error handling, implement query clarification flows, create helpful error messages for users

- [ ] **Task 10: Integration Testing & Optimization** - Test all 16 template scenarios, verify multi-tenant isolation, optimize agent prompts based on results

## Dependencies

### External Service Dependencies
- SQL Server database (existing, local or remote)
- Anthropic API (Claude Sonnet 4)
- Node.js 18+ runtime environment

### NPM Package Dependencies
- Backend:
  - express or fastify
  - langchain & @langchain/anthropic
  - mssql
  - typescript, tsx
  - zod for validation
  
- Frontend:
  - react 18.x
  - typescript
  - @mui/material or antd
  - recharts for visualizations
  - axios for API calls

### Environment Variables
```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
DATABASE_HOST=localhost
DATABASE_NAME=validis
DATABASE_USER=...
DATABASE_PASSWORD=...
CLIENT_ID=61b2a09d-beb2-4608-8c29-d817630ce002
```

### Prerequisite Work
- Database access credentials
- CLIENT_ID for testing
- Anthropic API key
- Sample data in database
- Full database schema documentation

## Success Criteria (Technical)

### Performance Benchmarks
- Natural language to SQL generation <10 seconds
- Query execution <30 seconds for complex queries
- Support varied follow-up questions without losing context
- Handle all 16 template types plus variations

### Quality Gates
- Agents generate valid SQL 95% of time
- Correct intent routing (lending vs audit) 90%+ accuracy
- All queries use clustered index (uploadId)
- Zero SQL injection vulnerabilities
- Successful multi-tenant isolation

### Acceptance Criteria
- Natural language queries work without SQL knowledge
- Follow-up questions maintain context
- Results display with appropriate visualizations
- Clear explanations of what queries are doing
- Graceful handling of ambiguous requests

## Estimated Effort

### Overall Timeline
- **Total Duration**: 4-6 weeks for POC (local development only)
- **Team Size**: 1-2 developers

### Phase Breakdown
- Week 1: Tasks 1-2 (Setup & Context System)
- Week 2: Tasks 3-5 (Multi-Agent Implementation)
- Week 3: Tasks 6-7 (API & Chat Interface)
- Week 4: Tasks 8-9 (Visualization & Error Handling)
- Week 5-6: Task 10 (Testing & Refinement)

### Critical Path Items
1. Agent prompt engineering for accurate SQL generation
2. Database context system completeness
3. Multi-agent coordination
4. Query performance with large datasets

### Resource Requirements
- 1 Full-stack developer (TypeScript/React/Node.js)
- Anthropic API budget (~$200/month for development)
- Local development environment
- Access to SQL Server with test data

## Tasks Created
- [ ] #20 - Project Setup & Core Infrastructure (parallel: false)
- [ ] #21 - Database Context System (parallel: false)
- [ ] #22 - Orchestrator Agent (parallel: true)
- [ ] #23 - Domain Agents (Lending & Audit) (parallel: true)
- [ ] #24 - Query Optimizer Agent (parallel: true)
- [ ] #25 - Backend API Layer (parallel: true)
- [ ] #26 - React Chat Interface (parallel: true)
- [ ] #27 - Results Visualization (parallel: true)
- [ ] #28 - Error Handling & Refinement (parallel: false)
- [ ] #29 - Integration Testing & Optimization (parallel: false)

Total tasks: 10
Parallel tasks: 6
Sequential tasks: 4
Estimated total effort: 156-196 hours
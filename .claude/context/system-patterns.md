---
created: 2025-09-10T11:16:17Z
last_updated: 2025-09-10T11:16:17Z
version: 1.0
author: Claude Code PM System
---

# System Patterns

## Architectural Pattern: Multi-Agent System

### Overall Architecture
- **Pattern**: Microservices-inspired Multi-Agent Architecture
- **Communication**: Message passing between specialized agents
- **Orchestration**: Central orchestrator for request routing
- **Separation of Concerns**: Each agent has single responsibility

### Agent Hierarchy
```
User Request
    ↓
Orchestrator Agent
    ├→ Lending Agent (Portfolio queries)
    ├→ Audit Agent (Company-specific queries)
    └→ Query Optimizer Agent (SQL optimization)
         ↓
    Database Layer
```

### Agent Responsibilities

#### Orchestrator Agent
- **Pattern**: Router/Dispatcher
- **Responsibilities**:
  - Parse user intent
  - Route to appropriate specialist agent
  - Handle ambiguity resolution
  - Coordinate multi-step queries
  - Manage conversation context

#### Domain Agents (Lending/Audit)
- **Pattern**: Domain Expert
- **Responsibilities**:
  - Understand domain-specific terminology
  - Apply business rules
  - Generate appropriate SQL patterns
  - Format results for domain context

#### Query Optimizer Agent
- **Pattern**: Performance Guardian
- **Responsibilities**:
  - Validate SQL efficiency
  - Ensure index usage
  - Apply query limits
  - Optimize for large datasets

## Data Access Patterns

### Multi-Tenant Isolation
- **Pattern**: Row-Level Security via Application Layer
- **Implementation**:
  ```typescript
  // Every query must include client_id filter
  const baseQuery = {
    where: {
      client_id: process.env.CLIENT_ID
    }
  }
  ```

### Query Building Pattern
- **Pattern**: Builder Pattern for SQL Generation
- **Components**:
  1. Template selection
  2. Parameter injection
  3. Filter application
  4. Optimization pass
  5. Execution

### Database Connection Management
- **Pattern**: Connection Pooling
- **Strategy**:
  - Reuse connections
  - Automatic retry on failure
  - Circuit breaker for database issues

## Frontend Patterns

### Component Architecture
- **Pattern**: Atomic Design
- **Hierarchy**:
  - Atoms: Buttons, inputs, labels
  - Molecules: Chat message, template card
  - Organisms: Chat interface, dashboard
  - Templates: Page layouts
  - Pages: Full application views

### State Management
- **Pattern**: Flux-like unidirectional data flow
- **Flow**:
  ```
  User Action → Dispatch → Store → View Update
  ```

### Chat Interface Pattern
- **Pattern**: Command Pattern with Template System
- **Implementation**:
  - Pre-defined command templates
  - Natural language fallback
  - Context preservation across messages

## API Design Patterns

### Request/Response Pattern
- **Pattern**: REST with WebSocket upgrade for real-time
- **Structure**:
  ```typescript
  interface QueryRequest {
    template?: string;
    naturalLanguage?: string;
    context?: QueryContext;
  }
  
  interface QueryResponse {
    success: boolean;
    data?: any;
    visualization?: VisualizationType;
    explanation?: string;
    error?: ErrorDetail;
  }
  ```

### Error Handling Pattern
- **Pattern**: Result Type Pattern
- **Implementation**:
  - Never throw exceptions to client
  - Always return structured errors
  - Include user-friendly messages
  - Log technical details server-side

## Security Patterns

### Authentication Pattern (Future)
- **Pattern**: JWT-based authentication
- **Flow**:
  1. User login
  2. JWT generation with client_id claim
  3. Token validation on each request
  4. Automatic client_id injection

### Query Sanitization
- **Pattern**: Parameterized Queries Only
- **Implementation**:
  - Never concatenate user input
  - Use parameter binding
  - Validate all inputs against schema

## Performance Patterns

### Caching Strategy
- **Pattern**: Multi-Layer Caching
- **Layers**:
  1. Browser cache for static assets
  2. API response cache for templates
  3. Query result cache (5-minute TTL)
  4. Database query plan cache

### Pagination Pattern
- **Pattern**: Cursor-based pagination
- **Implementation**:
  - Return max 5000 rows initially
  - Provide cursor for next page
  - Maintain query context

### Query Optimization Patterns
- **Always**: Use clustered index (uploadId)
- **Filter Early**: Apply filters at database level
- **Aggregate Smart**: Push aggregation to database
- **Limit Scope**: 3-month window for portfolio queries

## Resilience Patterns

### Circuit Breaker
- **Application**: Database connections, LLM API calls
- **States**: Closed → Open → Half-Open
- **Fallback**: Cached results or error message

### Retry Pattern
- **Strategy**: Exponential backoff
- **Max Attempts**: 3
- **Applicable To**: Database queries, API calls

### Graceful Degradation
- **Fallback Options**:
  1. Try simpler query
  2. Return cached results
  3. Show partial results
  4. Display helpful error

## Code Organization Patterns

### Module Pattern
- **Structure**: Feature-based modules
```
src/
  agents/
    orchestrator/
      index.ts
      types.ts
      prompts.ts
  templates/
    lending/
      asset-finance.ts
      working-capital.ts
```

### Dependency Injection
- **Pattern**: Constructor injection
- **Benefits**: Testability, flexibility
```typescript
class LendingAgent {
  constructor(
    private db: DatabaseService,
    private llm: LLMService
  ) {}
}
```

### Factory Pattern
- **Usage**: Agent creation
```typescript
class AgentFactory {
  createAgent(type: AgentType): Agent {
    switch(type) {
      case 'lending': return new LendingAgent();
      case 'audit': return new AuditAgent();
    }
  }
}
```

## Testing Patterns

### Test Structure
- **Pattern**: AAA (Arrange, Act, Assert)
- **Organization**: Mirror source structure

### Mock Strategy
- **Database**: In-memory SQL or test database
- **LLM**: Stub responses for predictable testing
- **External Services**: Mock implementations

## Monitoring Patterns

### Logging Strategy
- **Pattern**: Structured logging
- **Levels**: ERROR, WARN, INFO, DEBUG
- **Context**: Include request ID, user ID, query type

### Metrics Collection
- **Key Metrics**:
  - Query response time
  - Template usage frequency
  - Error rates by type
  - Database query performance

## Development Patterns

### Git Workflow
- **Pattern**: Feature branch workflow
- **Convention**: `feature/`, `bugfix/`, `hotfix/`
- **Review**: Required before merge

### Documentation Pattern
- **Code**: JSDoc for all public methods
- **API**: OpenAPI specification
- **Architecture**: Decision records (ADRs)
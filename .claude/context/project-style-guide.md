---
created: 2025-09-10T11:16:17Z
last_updated: 2025-09-10T11:16:17Z
version: 1.0
author: Claude Code PM System
---

# Project Style Guide

## Code Philosophy

### Core Principles
1. **Clarity over Cleverness**: Write code that junior developers can understand
2. **Explicit over Implicit**: Be clear about intentions
3. **Consistency over Personal Preference**: Follow team patterns
4. **Simplicity over Complexity**: Choose the simplest solution that works
5. **Documentation over Assumption**: Document why, not just what

### Development Rules
- **NO PARTIAL IMPLEMENTATION**: Complete features fully
- **NO CODE DUPLICATION**: Reuse existing functions
- **NO DEAD CODE**: Remove unused code immediately
- **NO MIXED CONCERNS**: Separate business logic from infrastructure
- **NO RESOURCE LEAKS**: Always clean up connections, timeouts, listeners
- **NO OVER-ENGINEERING**: Start simple, refactor when needed

## TypeScript Standards

### Type Definitions
```typescript
// ✅ GOOD: Explicit types
interface QueryRequest {
  template: string;
  parameters: Record<string, unknown>;
  context?: QueryContext;
}

// ❌ BAD: Using 'any'
interface QueryRequest {
  template: any;
  parameters: any;
}
```

### Function Signatures
```typescript
// ✅ GOOD: Clear return types and parameters
async function executeQuery(
  request: QueryRequest,
  clientId: string
): Promise<QueryResult> {
  // Implementation
}

// ❌ BAD: Implicit types
async function executeQuery(request, clientId) {
  // Implementation
}
```

### Error Handling
```typescript
// ✅ GOOD: Result type pattern
type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

async function fetchData(): Promise<Result<Data>> {
  try {
    const data = await api.get();
    return { success: true, data };
  } catch (error) {
    return { success: false, error };
  }
}

// ❌ BAD: Throwing errors to caller
async function fetchData(): Promise<Data> {
  return await api.get(); // Throws on error
}
```

## File & Folder Naming

### File Naming Conventions
```
components/
  ChatInterface.tsx        // React components: PascalCase
  ChatInterface.test.tsx   // Test files: same name + .test
  ChatInterface.styles.ts  // Style files: same name + .styles

utils/
  queryBuilder.ts         // Utilities: camelCase
  queryBuilder.test.ts    // Tests: same name + .test

types/
  Query.types.ts          // Type definitions: PascalCase + .types
  
config/
  database.config.ts      // Config files: kebab-case + .config
```

### Folder Structure
```
src/
  agents/           // Feature-based organization
    orchestrator/   // Each agent is self-contained
      index.ts
      types.ts
      prompts.ts
      orchestrator.test.ts
```

## React Component Standards

### Component Structure
```typescript
// ✅ GOOD: Functional component with proper typing
interface ChatMessageProps {
  message: string;
  timestamp: Date;
  sender: 'user' | 'agent';
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ 
  message, 
  timestamp, 
  sender 
}) => {
  // Hooks at the top
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Event handlers
  const handleClick = useCallback(() => {
    setIsExpanded(!isExpanded);
  }, [isExpanded]);
  
  // Render
  return (
    <div className={`message message--${sender}`}>
      {/* Component JSX */}
    </div>
  );
};
```

### State Management
```typescript
// ✅ GOOD: Typed state with clear updates
const [query, setQuery] = useState<string>('');
const [results, setResults] = useState<QueryResult[]>([]);

// ❌ BAD: Untyped state
const [data, setData] = useState();
```

## SQL Query Standards

### Query Building
```typescript
// ✅ GOOD: Parameterized queries
const query = `
  SELECT * FROM transactionHeader
  WHERE uploadId = @uploadId
    AND transactionDate >= @startDate
  ORDER BY transactionDate DESC
`;

const params = {
  uploadId: request.uploadId,
  startDate: request.startDate
};

// ❌ BAD: String concatenation
const query = `
  SELECT * FROM transactionHeader
  WHERE uploadId = '${uploadId}'
`;
```

### Performance Requirements
```typescript
// ✅ GOOD: Always use clustered index
const getTransactions = async (uploadId: string) => {
  // uploadId is clustered index - fast
  return await db.query(
    'SELECT * FROM transactions WHERE uploadId = @uploadId',
    { uploadId }
  );
};

// ❌ BAD: Full table scan
const getTransactions = async (description: string) => {
  // No index on description - slow
  return await db.query(
    'SELECT * FROM transactions WHERE description LIKE @pattern',
    { pattern: `%${description}%` }
  );
};
```

## API Design Standards

### Endpoint Naming
```typescript
// ✅ GOOD: RESTful conventions
POST   /api/queries          // Create query
GET    /api/queries/:id      // Get query result
GET    /api/templates        // List templates
POST   /api/chat/messages    // Send chat message

// ❌ BAD: Inconsistent naming
POST   /api/runQuery
GET    /api/getQueryResult
POST   /api/templates_list
```

### Response Format
```typescript
// ✅ GOOD: Consistent response structure
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId: string;
  };
}

// ❌ BAD: Inconsistent responses
// Sometimes returns data directly, sometimes wrapped
```

## Testing Standards

### Test Structure
```typescript
// ✅ GOOD: AAA pattern with clear descriptions
describe('QueryBuilder', () => {
  describe('buildLendingQuery', () => {
    it('should generate valid SQL for AR opportunities', async () => {
      // Arrange
      const template = 'ar-opportunities';
      const params = { threshold: 100000 };
      
      // Act
      const query = buildLendingQuery(template, params);
      
      // Assert
      expect(query).toContain('WHERE ar_balance > @threshold');
      expect(query).toContain('ORDER BY ar_balance DESC');
    });
  });
});

// ❌ BAD: No structure, unclear names
test('test1', () => {
  const result = doSomething();
  expect(result).toBe(true);
});
```

### Mock Strategy
```typescript
// ✅ GOOD: Clear mocks with types
const mockDatabase: DatabaseService = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
};
```

## Documentation Standards

### Code Comments
```typescript
// ✅ GOOD: Explain WHY, not WHAT
// Use clustered index for performance - can handle millions of rows
const query = 'SELECT * FROM transactions WHERE uploadId = @id';

// ❌ BAD: Obvious comments
// Select all transactions
const query = 'SELECT * FROM transactions';
```

### JSDoc for Public APIs
```typescript
/**
 * Executes a lending portfolio query across all companies
 * @param template - The template identifier (e.g., 'ar-opportunities')
 * @param clientId - The client ID for multi-tenant isolation
 * @param options - Additional query options
 * @returns Promise resolving to query results with metadata
 * @throws {ValidationError} If template is invalid
 */
export async function executeLendingQuery(
  template: string,
  clientId: string,
  options?: QueryOptions
): Promise<QueryResult> {
  // Implementation
}
```

## Git Commit Standards

### Commit Message Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation only
- **style**: Code style changes
- **refactor**: Code refactoring
- **test**: Test additions/changes
- **chore**: Build process or auxiliary tool changes

### Examples
```bash
# ✅ GOOD
git commit -m "feat(lending): add AR opportunities template"
git commit -m "fix(auth): resolve client_id isolation issue"
git commit -m "docs(api): update query endpoint documentation"

# ❌ BAD
git commit -m "fixed stuff"
git commit -m "WIP"
git commit -m "updates"
```

## Environment Variables

### Naming Convention
```bash
# ✅ GOOD: Clear, prefixed naming
DATABASE_HOST=localhost
DATABASE_PORT=1433
DATABASE_NAME=validis
CLIENT_ID=61b2a09d-beb2-4608-8c29-d817630ce002
API_KEY_ANTHROPIC=sk-...
LOG_LEVEL=info

# ❌ BAD: Unclear or unprefixed
HOST=localhost
KEY=sk-...
DEBUG=true
```

## Performance Guidelines

### Query Optimization
1. Always use uploadId (clustered index) in WHERE clause
2. Limit results to 5000 rows for initial display
3. Use pagination for large result sets
4. Portfolio queries limited to 3-month window
5. Aggregate at database level, not application

### Frontend Performance
1. Lazy load components when possible
2. Memoize expensive computations
3. Use virtual scrolling for large lists
4. Debounce user input (300ms for search)
5. Optimize bundle size (<500KB initial load)

## Security Guidelines

### Data Protection
```typescript
// ✅ GOOD: Never log sensitive data
logger.info('Query executed', { 
  template, 
  userId: user.id,
  duration: elapsed 
});

// ❌ BAD: Logging sensitive information
logger.info('Query executed', { 
  template, 
  userId: user.id,
  clientId: process.env.CLIENT_ID,  // Don't log this
  query: fullSqlQuery                // Don't log this
});
```

### Input Validation
```typescript
// ✅ GOOD: Validate all inputs
import { z } from 'zod';

const QuerySchema = z.object({
  template: z.string().min(1).max(50),
  companyName: z.string().min(1).max(100),
});

function validateQuery(input: unknown): QueryRequest {
  return QuerySchema.parse(input);
}
```

## Code Review Checklist

Before submitting PR, ensure:
- [ ] No partial implementations
- [ ] No code duplication
- [ ] No console.log statements
- [ ] All functions have proper types
- [ ] Error handling implemented
- [ ] Tests written and passing
- [ ] No hardcoded values
- [ ] Security considerations addressed
- [ ] Performance impact considered
- [ ] Documentation updated
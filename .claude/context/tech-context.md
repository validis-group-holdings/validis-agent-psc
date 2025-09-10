---
created: 2025-09-10T11:16:17Z
last_updated: 2025-09-10T11:16:17Z
version: 1.0
author: Claude Code PM System
---

# Technology Context

## Current Technology Stack

### Database
- **Platform**: Microsoft SQL Server
- **Access Pattern**: Direct SQL queries via uploadId (clustered index)
- **Connection**: MCP SQL Server tool (mcp__mssql)
- **Multi-tenancy**: client_id environment variable isolation

### Existing Database Schema
- **Core Tables**:
  - `upload` - Company data uploads with client/SME tracking
  - `transactionHeader/Line` - General ledger entries
  - `saleHeader/Line` - Accounts receivable transactions
  - `purchaseHeader/Line` - Accounts payable transactions
  - `saleAged/purchaseAged` - Aging analysis tables
  - `account` - Chart of accounts
  - `customer/supplier` - Counterparty master data
  - `financialPeriod/Year` - Period management

### Development Environment
- **Version Control**: Git (GitHub: validis-group-holdings/validis-agent-psc)
- **AI Tools**: Claude AI with custom agents and commands
- **Configuration**: Claude Flow and Swarm configurations

## Planned Technology Stack

### Frontend
- **Framework**: React 18+
- **Language**: TypeScript 5+
- **State Management**: React Context API / Zustand
- **UI Components**: 
  - Material-UI or Ant Design for dashboard
  - Custom chat interface component
- **Charts/Visualization**: 
  - Recharts or Chart.js for data visualization
  - AG-Grid for tabular data
- **Build Tool**: Vite or Create React App

### Backend
- **Runtime**: Node.js 18+ LTS
- **Framework**: Express.js or Fastify
- **Language**: TypeScript 5+
- **Agent Framework**: 
  - LangChain or custom implementation
  - OpenAI/Anthropic API for LLM integration
- **Database Driver**: 
  - mssql (tedious driver) for SQL Server
  - Connection pooling for performance

### AI/LLM Integration
- **Primary Model**: Claude 3 or GPT-4 for query understanding
- **Agent Architecture**: Multi-agent system with:
  - Orchestrator agent
  - Domain-specific agents (Lending, Audit)
  - Query optimization agent
- **Prompt Engineering**: Template-based with context injection

### Testing
- **Unit Testing**: Jest with TypeScript support
- **Integration Testing**: Supertest for API testing
- **E2E Testing**: Playwright or Cypress
- **Database Testing**: In-memory SQL or test database

### DevOps & Deployment
- **Containerization**: Docker for development consistency
- **Environment Management**: dotenv for configuration
- **CI/CD**: GitHub Actions (planned)
- **Monitoring**: Application insights (future)

## Development Dependencies (Planned)

### Core Dependencies
```json
{
  "dependencies": {
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0",
    "express": "^4.18.0",
    "mssql": "^10.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@anthropic-ai/sdk": "latest",
    "langchain": "latest",
    "zod": "^3.22.0"
  }
}
```

### Development Tools
```json
{
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/react": "^18.0.0",
    "@typescript-eslint/eslint-plugin": "^5.0.0",
    "@typescript-eslint/parser": "^5.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "nodemon": "^3.0.0",
    "tsx": "^3.0.0"
  }
}
```

## Database Performance Considerations
- **Indexing Strategy**: Always use clustered index (uploadId)
- **Query Optimization**: 
  - Limit results to 5000 rows initially
  - Portfolio queries restricted to 3-month window
  - Aggregate at database level when possible
- **Connection Pooling**: 
  - Min: 5 connections
  - Max: 30 connections
  - Idle timeout: 30 seconds

## Security Considerations
- **Multi-tenant Isolation**: Strict client_id filtering
- **SQL Injection Prevention**: Parameterized queries only
- **Authentication**: Environment variable for client_id (POC)
- **Data Encryption**: SQL Server TDE enabled
- **Connection Security**: SSL/TLS for database connections

## API Design (Planned)
- **Architecture**: RESTful with WebSocket for chat
- **Endpoints**:
  - `POST /api/query` - Natural language query
  - `GET /api/templates` - List available templates
  - `POST /api/chat` - Chat interface
  - `GET /api/results/:queryId` - Retrieve results
- **Response Format**: JSON with metadata

## Development Tools Configuration

### TypeScript Configuration
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### ESLint Configuration
- Airbnb style guide as base
- TypeScript-specific rules
- React hooks rules

## External Services Integration
- **LLM Provider**: Anthropic Claude API / OpenAI API
- **Database**: SQL Server (existing infrastructure)
- **Monitoring**: Application Insights (future)
- **Error Tracking**: Sentry (future)

## Performance Targets
- **API Response Time**: <1 second for template selection
- **Query Execution**: <30 seconds for complex queries
- **Frontend Load Time**: <3 seconds initial load
- **Concurrent Users**: Support 100+ simultaneous users

## Browser Support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Mobile Considerations
- Responsive design for tablet use
- Mobile view for read-only access
- Desktop-first for primary functionality
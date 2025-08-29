# Validis Agent

A natural language query interface for financial data validation and analysis, built with Node.js, TypeScript, Express, and LangChain with Anthropic Claude.

## Features

- **Natural Language Processing**: Convert natural language queries to SQL using Anthropic Claude
- **Upload Table Pattern**: Secure data access using upload table methodology
- **Client Scoping**: Mandatory client-based security scoping
- **Dual Workflows**: Support for audit (company-specific) and lending (portfolio-wide) workflows
- **Caching**: Redis-based query result caching
- **Health Monitoring**: Comprehensive health check endpoints
- **TypeScript**: Full TypeScript support with strict typing

## Quick Start

### Prerequisites

- Node.js 18+
- SQL Server database
- Redis server
- Anthropic API key

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd validis-agent-psc
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your actual values
```

4. Build the project:
```bash
npm run build
```

5. Start the development server:
```bash
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

#### Required Variables
- `WORKFLOW_MODE`: Either "audit" or "lending"
- `CLIENT_ID`: Client identifier for security scoping
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `DB_SERVER`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`: SQL Server connection details

#### Optional Variables
- `PORT`: Server port (default: 3000)
- `ANTHROPIC_MODEL`: Claude model to use (default: claude-3-sonnet-20240229)
- `REDIS_URL`: Redis connection URL (default: redis://localhost:6379)
- `CACHE_TTL_SECONDS`: Cache TTL in seconds (default: 300)
- `MAX_QUERY_RESULTS`: Maximum query results (default: 1000)
- `QUERY_TIMEOUT_MS`: Query timeout in milliseconds (default: 30000)

## Architecture

### Directory Structure

```
src/
├── config/           # Configuration and environment setup
├── db/              # Database connections and helpers
├── middleware/      # Express middleware
├── routes/          # API routes
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── server.ts        # Main server file
```

### Key Components

- **Configuration**: Environment validation using Zod
- **Database**: SQL Server connection with upload table helpers
- **Caching**: Redis integration for query result caching
- **LangChain**: Anthropic Claude integration for NL-to-SQL
- **Health Checks**: Comprehensive monitoring endpoints

## API Endpoints

### Health Checks

- `GET /health` - Comprehensive health check
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe

## Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

### Database Requirements

The application expects upload tables to follow a specific pattern with metadata tracked in an `upload_table_metadata` table. Each upload table should include:

- Client ID for security scoping
- Upload date and status tracking
- Record count and file type information

### Security

- All queries must include CLIENT_ID filtering for audit workflow
- Upload table validation before query execution
- Environment variable validation on startup
- SQL injection protection through parameterized queries

## Workflow Modes

### Audit Mode
- Company-specific analysis
- Strict CLIENT_ID filtering required
- Single client data access

### Lending Mode
- Portfolio-wide analysis
- Multi-client data access
- Broader analytical capabilities

## Contributing

1. Create a feature branch from main
2. Make your changes with appropriate tests
3. Ensure all tests pass
4. Submit a pull request

## License

MIT
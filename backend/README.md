# Validis Agent Backend

Node.js backend service with TypeScript, Express, MSSQL, and Anthropic SDK integration.

## Prerequisites

- Node.js 18+ 
- npm or yarn
- SQL Server instance (for database features)
- Anthropic API key (for AI features)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Run in development mode:
```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## API Endpoints

### Health Checks
- `GET /` - API info
- `GET /api/health` - Comprehensive health status
- `GET /api/health/liveness` - Kubernetes liveness probe
- `GET /api/health/readiness` - Kubernetes readiness probe

## Project Structure

```
backend/
├── src/
│   ├── config/         # Configuration modules
│   │   ├── database.ts # MSSQL connection pooling
│   │   ├── anthropic.ts # Anthropic SDK setup
│   │   └── index.ts    # Main config exports
│   ├── services/       # Business logic services
│   ├── routes/         # Express route handlers
│   │   └── health.ts   # Health check endpoints
│   └── index.ts        # Express app entry point
├── tests/              # Test files
├── .env.example        # Environment variables template
├── package.json        # Dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

## Features

- **TypeScript** with strict mode for type safety
- **Express** server with middleware (CORS, Helmet, body parsing)
- **MSSQL** with connection pooling and graceful shutdown
- **Anthropic SDK** integration for AI capabilities
- **Winston** logging with structured output
- **Health checks** for monitoring and orchestration
- **Error handling** with async error support
- **Graceful shutdown** on SIGTERM/SIGINT
- **Development tooling** with tsx for hot reload

## Environment Variables

See `.env.example` for all available configuration options.

Key configurations:
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port
- `DB_*` - Database connection settings
- `ANTHROPIC_API_KEY` - Anthropic API authentication

## Error Handling

The application includes:
- Global error handler for uncaught exceptions
- Async error handling with express-async-errors
- Graceful degradation when services are unavailable
- Structured error responses with timestamps

## Monitoring

Health endpoints provide:
- Service connectivity status (database, AI)
- Uptime metrics
- Readiness/liveness probes for Kubernetes
- Detailed error messages in development mode
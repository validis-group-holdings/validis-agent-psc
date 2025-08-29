# Docker Setup for Validis Agent

This guide explains how to run the Validis Agent project using Docker for local development and testing.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose v2 or higher
- At least 4GB of RAM allocated to Docker

## Quick Start

### 1. Start Infrastructure Services

Start SQL Server and Redis:

```bash
docker-compose up -d mssql redis
```

Wait for services to be healthy (about 30 seconds):

```bash
docker-compose ps
```

### 2. Initialize Database

The database will be automatically initialized with the schema and test data from `scripts/init-db.sql`.

To manually run SQL scripts:

```bash
docker exec -it validis-mssql /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P YourStrong@Password123 \
  -i /docker-entrypoint-initdb.d/init.sql
```

### 3. Update Environment Variables

Create a `.env` file in the project root:

```env
# Application
NODE_ENV=development
PORT=3000

# Workflow
WORKFLOW_MODE=audit
CLIENT_ID=test-client-001

# Anthropic
ANTHROPIC_API_KEY=your-actual-api-key
ANTHROPIC_MODEL=claude-3-opus-20240229

# Database (for local Docker)
DB_SERVER=localhost
DB_DATABASE=validis_dev
DB_USERNAME=sa
DB_PASSWORD=YourStrong@Password123
DB_ENCRYPT=false
DB_TRUST_SERVER_CERT=true

# Redis
REDIS_URL=redis://localhost:6379
REDIS_TTL=3600

# Security
JWT_SECRET=development-jwt-secret
SESSION_SECRET=development-session-secret
```

### 4. Run the Application

#### Option A: Run locally with npm (recommended for development)

With Docker services running:

```bash
npm install
npm run dev
```

The application will be available at:
- API: http://localhost:3000
- Health: http://localhost:3000/health

#### Option B: Run everything in Docker

```bash
docker-compose up
```

This starts all services including the application container.

## Available Services

| Service | Port | Description |
|---------|------|-------------|
| SQL Server | 1433 | Microsoft SQL Server 2022 |
| Redis | 6379 | Redis cache server |
| Application | 3000 | Node.js API server |
| Debug | 9229 | Node.js debugging port |

## Database Management

### Connect to SQL Server

Using Azure Data Studio or SQL Server Management Studio:
- Server: `localhost,1433`
- Username: `sa`
- Password: `YourStrong@Password123`
- Database: `validis_dev`

### View Redis Data

```bash
docker exec -it validis-redis redis-cli
```

Common Redis commands:
```redis
KEYS *          # List all keys
GET key         # Get value for key
FLUSHALL        # Clear all data
```

## Troubleshooting

### Services won't start

```bash
# Stop all services
docker-compose down

# Remove volumes and start fresh
docker-compose down -v
docker-compose up -d
```

### Database connection issues

1. Check if SQL Server is healthy:
```bash
docker-compose ps
docker logs validis-mssql
```

2. Test connection:
```bash
docker exec -it validis-mssql /opt/mssql-tools/bin/sqlcmd \
  -S localhost -U sa -P YourStrong@Password123 \
  -Q "SELECT 1"
```

### Port conflicts

If ports are already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "14330:1433"  # Change external port
  - "63790:6379"  # Change external port
```

## Development Workflow

1. Start infrastructure:
```bash
docker-compose up -d mssql redis
```

2. Run application locally:
```bash
npm run dev
```

3. Make changes - the application will auto-reload

4. Run tests:
```bash
npm test
```

5. Stop services when done:
```bash
docker-compose down
```

## Production Build

Build production image:
```bash
docker build -t validis-agent:latest .
```

Run production container:
```bash
docker run -p 3000:3000 \
  --env-file .env \
  --network validis-network \
  validis-agent:latest
```

## Useful Commands

```bash
# View logs
docker-compose logs -f [service]

# Execute commands in container
docker exec -it validis-mssql bash
docker exec -it validis-redis sh

# Clean everything
docker-compose down -v --remove-orphans
docker system prune -a

# Check resource usage
docker stats
```

## Data Persistence

Data is persisted in Docker volumes:
- `mssql-data`: SQL Server data files
- `redis-data`: Redis append-only file

To backup:
```bash
docker run --rm -v validis-agent-psc_mssql-data:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/mssql-backup.tar.gz /data
```

## Security Notes

⚠️ **For Development Only**: The default passwords and secrets in this setup are for development only. Never use these in production.

For production:
- Use strong, unique passwords
- Store secrets in environment variables or secret management service
- Enable SQL Server encryption
- Use TLS for Redis connections
- Run containers with minimal privileges
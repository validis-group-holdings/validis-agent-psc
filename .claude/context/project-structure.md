---
created: 2025-09-10T11:16:17Z
last_updated: 2025-09-10T11:16:17Z
version: 1.0
author: Claude Code PM System
---

# Project Structure

## Root Directory
```
validis-agent-psc/
├── .claude/              # Claude AI configuration and documentation
├── .claude-flow/         # Claude Flow configuration
├── .swarm/              # Swarm configuration
├── CLAUDE.md            # Project-specific Claude instructions
└── README.md            # Project documentation (to be created)
```

## Claude Configuration (.claude/)
```
.claude/
├── agents/              # Agent role definitions
│   ├── code-reviewer.md
│   ├── product-manager.md
│   ├── senior-software-engineer.md
│   └── ux-designer.md
├── commands/            # Custom command definitions
│   ├── code-rabbit.md
│   └── pm/
│       ├── epic-list.md
│       ├── epic-oneshot.md
│       └── issue-sync.md
├── context/             # Project context documentation
│   └── README.md        # Context overview
├── prds/                # Product Requirements Documents
│   └── validis-agent.md # Main PRD for the project
└── rules/               # Development rules and patterns
    ├── agent-coordination.md
    ├── branch-operations.md
    ├── datetime.md
    ├── frontmatter-operations.md
    ├── github-operations.md
    ├── standard-patterns.md
    ├── strip-frontmatter.md
    ├── test-execution.md
    ├── use-ast-grep.md
    └── worktree-operations.md
```

## Planned Project Structure (To Be Implemented)
```
validis-agent-psc/
├── src/                 # Source code
│   ├── agents/          # Agent implementations
│   │   ├── orchestrator/
│   │   ├── lending/
│   │   ├── audit/
│   │   └── query-optimizer/
│   ├── api/             # API layer
│   │   ├── routes/
│   │   └── middleware/
│   ├── database/        # Database connection and queries
│   │   ├── connection/
│   │   └── queries/
│   ├── templates/       # Query templates
│   │   ├── lending/
│   │   └── audit/
│   ├── types/           # TypeScript type definitions
│   └── utils/           # Utility functions
├── client/              # Frontend application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── services/
│   └── public/
├── tests/               # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── config/              # Configuration files
│   ├── database.config.ts
│   └── agents.config.ts
├── scripts/             # Build and deployment scripts
├── docs/                # Documentation
│   ├── api/
│   ├── architecture/
│   └── deployment/
├── package.json         # Node.js dependencies (to be created)
├── tsconfig.json        # TypeScript configuration (to be created)
├── .env.example         # Environment variables template
├── .gitignore          # Git ignore file
└── docker-compose.yml   # Docker configuration (optional)
```

## Key Directories Purpose

### Agent System (/src/agents)
- **Orchestrator**: Routes requests to appropriate specialist agents
- **Lending Agent**: Handles portfolio-wide financial queries
- **Audit Agent**: Manages company-specific audit queries
- **Query Optimizer**: Ensures efficient SQL generation

### Templates (/src/templates)
- Pre-defined query patterns for lending and audit use cases
- 8 lending templates for portfolio analysis
- 8 audit templates for company-specific checks

### Database Layer (/src/database)
- SQL Server connection management
- Query builders and executors
- Multi-tenant isolation logic

### Frontend (/client)
- React/TypeScript dashboard
- Chat interface component
- Data visualization components
- Template selection UI

## File Naming Conventions
- Components: PascalCase (e.g., `ChatInterface.tsx`)
- Utilities: camelCase (e.g., `queryBuilder.ts`)
- Types: PascalCase with `.types.ts` extension
- Tests: Same name with `.test.ts` or `.spec.ts`
- Configs: kebab-case with `.config.ts`

## Module Organization
- Each agent is a self-contained module
- Shared logic in `/src/utils`
- Type definitions centralized in `/src/types`
- Database queries abstracted in `/src/database/queries`

## Build Artifacts (Future)
```
dist/                    # Compiled TypeScript output
build/                   # Production build for frontend
node_modules/            # Dependencies
coverage/                # Test coverage reports
```

## Configuration Files (To Be Created)
- `package.json` - Project dependencies and scripts
- `tsconfig.json` - TypeScript compiler options
- `.env` - Environment variables (client_id, database connection)
- `.eslintrc.json` - Code linting rules
- `.prettierrc` - Code formatting rules

## Current State
- Project is in initial scaffolding phase
- Claude AI configuration is complete
- PRD and requirements are documented
- Implementation structure is planned but not yet created
---
created: 2025-08-28T11:37:50Z
last_updated: 2025-08-28T11:37:50Z
version: 1.0
author: Claude Code PM System
---

# Project Structure

## Root Directory Organization
```
/Users/andy/Projects/validis-agent-psc/
├── .claude/               # Claude Code PM system files
│   ├── pm/               # Project management data
│   │   ├── prds/        # Product Requirements Documents
│   │   ├── epics/       # Epic tracking files
│   │   ├── reports/     # Analysis reports
│   │   ├── templates/   # Document templates
│   │   └── cache/       # Temporary cache data
│   ├── context/         # Project context documentation
│   └── scripts/pm/      # PM shell scripts
├── .claude-flow/        # Claude Flow integration
├── .swarm/             # Swarm configuration
├── install/            # Installation scripts
│   ├── ccpm.sh        # Unix/Linux/macOS installer
│   ├── ccpm.bat       # Windows installer
│   └── README.md      # Quick install guide
├── AGENTS.md          # Agent system documentation
├── CLAUDE.md          # Main Claude Code configuration
└── COMMANDS.md        # Command reference documentation
```

## Key Directories

### `.claude/` - Core PM System
Central hub for all PM functionality, containing:
- Project management data and configurations
- Context documentation system
- Shell scripts for PM operations

### `.claude/pm/` - Project Management
- **prds/**: Stores Product Requirements Documents in YAML format
- **epics/**: Tracks epic-level project work
- **reports/**: Holds analysis reports from issue decomposition
- **templates/**: Contains reusable document templates
- **cache/**: Temporary storage for processing data

### `.claude/context/` - Living Documentation
Contains comprehensive project context files that maintain knowledge between sessions

### `install/` - Installation Support
Cross-platform installation scripts for quick setup

## File Naming Patterns

### PM Files
- PRDs: `PRD-{timestamp}.yaml`
- Epics: `EPIC-{timestamp}.yaml`
- Reports: `{type}-{timestamp}.json`

### Context Files
- Standardized names: `project-*.md`, `tech-*.md`, `product-*.md`
- All include YAML frontmatter with metadata

### Scripts
- Shell scripts: `*.sh` in `.claude/scripts/pm/`
- Follow kebab-case naming convention

## Module Organization

### Agent System
- Specialized agents defined for specific tasks
- Each agent has clear input/output contracts
- Agents act as context firewalls

### Command System
- Commands organized by category in markdown files
- Each command specifies required tools
- Follows consistent error handling patterns

### Context System
- 9 standard context files covering all project aspects
- Frontmatter tracks versioning and updates
- Regular update workflow maintains accuracy

## Integration Points

### GitHub Integration
- Uses gh CLI for repository operations
- gh-sub-issue extension for issue decomposition
- Remote: git@github.com:validis-group-holdings/validis-agent-mvp.git

### Claude Flow
- `.claude-flow/` directory for flow configurations
- Swarm support via `.swarm/` directory

## File Organization Principles
1. **Separation of Concerns**: PM, context, and scripts separated
2. **Temporal Organization**: Files timestamped for tracking
3. **Flat Structure**: Minimal nesting for easy navigation
4. **Clear Naming**: Self-documenting file and directory names
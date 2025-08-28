# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Project Management (CCPM) system - A context-aware development environment for managing complex projects with Claude Code. This system provides commands, agents, and patterns for efficient AI-assisted development.

## Core Architecture

### Agent System
The project uses specialized agents as **context firewalls** to prevent information overload:
- **code-analyzer**: Hunts bugs across files, returns concise reports
- **file-analyzer**: Summarizes verbose files (80-90% reduction)
- **test-runner**: Executes tests, analyzes failures, preserves context
- **parallel-worker**: Coordinates parallel work streams in worktrees

Agents do heavy lifting while returning minimal information to preserve main conversation context.

### Command System
Commands in `/commands/` are markdown files interpreted as instructions:
- PM commands (`/pm:*`): Project management, PRDs, issues, epics
- Context commands (`/context:*`): Documentation and context management
- Testing commands (`/testing:*`): Test configuration and execution
- Review commands (`/code-rabbit`): Process external code reviews

### Project Management Integration
- `/pm:init` - Initialize PM system with GitHub integration
- `/pm:prd-new` - Create Product Requirements Documents
- `/pm:issue-analyze` - Analyze issues and identify work streams
- `/pm:issue-start` - Start work with parallel agent coordination
- `/pm:status` - Check project status and active work

## Development Commands

### PM System Commands
```bash
# Initialize the PM system
/pm:init

# Create and manage PRDs
/pm:prd-new          # Create new PRD
/pm:prd-list         # List all PRDs
/pm:prd-view <id>    # View specific PRD

# Work with issues
/pm:issue-analyze <url>  # Analyze GitHub issue
/pm:issue-start <url>    # Start work with parallel agents
/pm:issue-status         # Check issue progress

# Epic management
/pm:epic-new         # Create new epic
/pm:epic-status      # Check epic status

# Utilities
/pm:status           # Overall project status
/pm:help            # Show all PM commands
```

### Context Management
```bash
/context:create      # Create initial context documentation
/context:update      # Update context with recent changes
/context:prime       # Load context into conversation
```

### Testing
```bash
/testing:prime       # Configure testing framework
/testing:run         # Run tests with intelligent analysis
/testing:run <file>  # Run specific test file
```

## Critical Patterns

### Context Preservation
- Use agents for operations that would read >3 files
- Agents return 10-20% of processed information
- Main thread never sees verbose output (logs, test results, file contents)
- Batch operations through parallel-worker for multi-file changes

### Command Execution Flow
1. Commands check prerequisites first (fail-fast)
2. Heavy processing delegated to agents
3. Results summarized before returning
4. Context preserved at every level

### GitHub Integration
The PM system requires:
- `gh` CLI tool installed and authenticated
- `gh-sub-issue` extension for issue decomposition
- Repository remote configured

### File Organization
```
.claude/
├── pm/
│   ├── prds/           # Product Requirements Documents
│   ├── epics/          # Epic tracking
│   ├── reports/        # Analysis reports
│   └── cache/          # Temporary data
├── context/            # Project context documentation
├── scripts/pm/         # PM shell scripts
└── CLAUDE.md          # This file (rules included from parent)
```

## Working with Agents

### When to Use Agents
- Reading/analyzing >3 files → Use appropriate agent
- Running tests → Always use test-runner
- Implementing features → Use parallel-worker for multi-stream work
- Analyzing logs/output → Use file-analyzer

### Agent Communication Pattern
```
Main Thread → Task Tool → Agent → Heavy Work → Summary → Main Thread
     (context preserved)        (context isolated)      (minimal return)
```

## Important Notes

- **Context is precious**: Always prefer agents for multi-file operations
- **Fail fast**: Check prerequisites before starting work
- **Parallel over sequential**: Use parallel-worker for independent tasks
- **Summaries over raw data**: Never dump verbose output to main thread
- **Scripts are in .claude/scripts/pm/**: Core PM functionality lives here

## Rules Integration

This project includes rules from `.claude/CLAUDE.md` in the parent configuration, which provide:
- Token economy patterns
- Thinking modes and flags
- Git workflow requirements
- Performance optimizations
- MCP tool usage guidelines

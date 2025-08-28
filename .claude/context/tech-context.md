---
created: 2025-08-28T11:37:50Z
last_updated: 2025-08-28T11:37:50Z
version: 1.0
author: Claude Code PM System
---

# Technical Context

## Technology Stack

### Core Technologies
- **Language**: Bash scripting for PM operations
- **Documentation**: Markdown with YAML frontmatter
- **Version Control**: Git
- **Platform**: Cross-platform (Unix/Linux/macOS/Windows)

### External Dependencies

#### Required Tools
- **gh CLI** (v2.78.0+): GitHub command-line interface
  - Used for repository operations
  - Issue and PR management
  - Authentication with GitHub

#### Extensions
- **gh-sub-issue**: GitHub CLI extension for issue decomposition
  - Enables breaking down complex issues
  - Creates sub-issue hierarchies
  - Installed via gh extension install

### Development Tools

#### Shell Environment
- Bash 4.0+ for script execution
- POSIX-compliant commands for portability
- Date utilities for timestamp generation

#### Documentation Tools
- Markdown for all documentation
- YAML for structured data (PRDs, epics)
- JSON for report generation

### Agent System Stack
- **Task Tool**: Claude's built-in agent spawning
- **Subagent Types**:
  - code-analyzer: Bug hunting and analysis
  - file-analyzer: Log and output summarization
  - test-runner: Test execution and analysis
  - parallel-worker: Parallel task coordination

### Integration Technologies

#### GitHub API
- RESTful API via gh CLI
- GraphQL queries for complex operations
- Webhook support for automation

#### Claude Code Integration
- Command system via markdown files
- Tool permissions via frontmatter
- Context preservation strategies

### File Formats

#### Configuration
- YAML: PRDs, epics, structured data
- JSON: Reports, analysis output
- Markdown: Documentation, commands

#### Scripts
- Shell scripts (.sh): Unix/Linux/macOS
- Batch files (.bat): Windows
- Cross-platform compatibility focus

### Development Practices

#### Version Control
- Git for source control
- Branch-based development
- Commit message conventions

#### Testing Approach
- Test-runner agent for test execution
- Contract testing patterns
- Integration testing support

### Security Considerations

#### Authentication
- GitHub token via gh auth
- No credentials in code
- Secure token storage

#### Permissions
- Tool-specific permissions in commands
- Read/write/execute controls
- Sandboxed agent execution

### Performance Optimization

#### Context Management
- Agent-based context reduction
- Parallel processing support
- Efficient file operations

#### Caching
- `.claude/pm/cache/` for temporary data
- Report caching for reuse
- Minimal disk I/O

### Compatibility

#### Operating Systems
- macOS: Full support
- Linux: Full support  
- Windows: PowerShell/WSL support
- Unix variants: POSIX compliance

#### Claude Versions
- Designed for Claude Code
- Agent system compatibility
- Tool permission system

### Development Workflow

#### Commands
- Slash commands (`/pm:*`, `/context:*`)
- Markdown-based execution
- Tool allowlist enforcement

#### Documentation
- Living documentation via context system
- Auto-generated from analysis
- Regular update cycle

### Future Technology Considerations
- Potential API integrations
- Extended automation capabilities
- Enhanced parallel processing
- Advanced caching strategies
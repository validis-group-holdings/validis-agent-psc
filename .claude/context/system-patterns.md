---
created: 2025-08-28T11:37:50Z
last_updated: 2025-08-28T11:37:50Z
version: 1.0
author: Claude Code PM System
---

# System Patterns

## Architectural Patterns

### Context Firewall Pattern
**Purpose**: Prevent context explosion in main conversation thread
**Implementation**:
- Agents handle heavy processing
- Return only essential information (10-20% of processed data)
- Main thread remains focused and clean

**Example Flow**:
```
Main Thread → Task Tool → Agent → Process 100 files → Return 5-line summary
```

### Command Pattern
**Purpose**: Encapsulate operations as markdown-based commands
**Implementation**:
- Commands stored as markdown files
- Frontmatter defines permissions and tools
- Consistent execution interface via slash commands

**Benefits**:
- Declarative command definition
- Tool permission control
- Reusable and versionable

### Progressive Documentation Pattern
**Purpose**: Build and maintain living documentation
**Implementation**:
1. Initial creation (`/context:create`)
2. Regular updates (`/context:update`)
3. Session loading (`/context:prime`)

**Lifecycle**:
- Create → Use → Update → Repeat

## Design Patterns Observed

### Factory Pattern (Agents)
- Agent spawning via Task tool
- Standardized agent types
- Consistent interface for different agent behaviors

### Observer Pattern (Git Integration)
- Monitor repository changes
- React to commits and modifications
- Update context based on changes

### Strategy Pattern (Commands)
- Different command implementations
- Same execution interface
- Runtime strategy selection

### Template Pattern (Documentation)
- Standardized frontmatter
- Consistent file structure
- Reusable document templates

## Architectural Style

### Microkernel Architecture
**Core System**: Minimal PM kernel
**Plugins**: Commands, agents, integrations
**Benefits**: Extensible, maintainable, testable

### Event-Driven Components
- Commands trigger actions
- Agents respond to tasks
- Git hooks for automation

### Layered Architecture
```
Presentation Layer: Commands, Documentation
Business Logic Layer: Agents, PM Operations  
Data Layer: Context Files, Git Repository
Integration Layer: GitHub API, Claude Tools
```

## Data Flow Patterns

### Unidirectional Data Flow
```
User Input → Command → Agent → Processing → Summary → User
```

### Context Preservation Flow
```
Large Data Set → Agent Processing → Compressed Summary → Main Context
```

### Parallel Processing Flow
```
Issue Analysis → Work Stream Identification → Parallel Agent Spawning → Consolidated Results
```

## Communication Patterns

### Request-Response
- Synchronous command execution
- Immediate feedback
- Clear success/failure states

### Fire-and-Forget
- Agent spawning for long tasks
- Background processing
- Async result collection

### Publish-Subscribe
- Git change notifications
- Context update triggers
- Report generation events

## Error Handling Patterns

### Fail-Fast
- Validate prerequisites first
- Exit immediately on critical errors
- Clear error messages

### Graceful Degradation
- Continue with partial functionality
- Skip optional features if unavailable
- Provide warnings for non-critical issues

### Recovery Pattern
- Checkpoint before risky operations
- Rollback capability
- State restoration support

## Security Patterns

### Principle of Least Privilege
- Commands specify exact tools needed
- No unnecessary permissions
- Sandboxed execution

### Defense in Depth
- Multiple validation layers
- Input sanitization
- Output filtering

## Performance Patterns

### Lazy Loading
- Load context only when needed
- Progressive documentation loading
- On-demand agent spawning

### Caching Pattern
- Cache analysis reports
- Store processed results
- Reuse when possible

### Batch Processing
- Group similar operations
- Process multiple files together
- Reduce overhead

## Integration Patterns

### Adapter Pattern
- GitHub CLI as adapter
- Shell scripts as adapters
- Cross-platform compatibility

### Gateway Pattern
- Commands as gateway to functionality
- Agents as gateway to processing
- Unified interface

## Anti-Patterns Avoided

### God Object
- No monolithic components
- Separated concerns
- Modular design

### Spaghetti Code
- Clear command structure
- Organized file hierarchy
- Consistent patterns

### Golden Hammer
- Right tool for each job
- Multiple agent types
- Varied approaches

## Pattern Evolution
- Start simple, evolve as needed
- Document pattern changes
- Maintain backward compatibility
- Learn from usage patterns
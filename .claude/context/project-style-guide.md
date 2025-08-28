---
created: 2025-08-28T11:37:50Z
last_updated: 2025-08-28T11:37:50Z
version: 1.0
author: Claude Code PM System
---

# Project Style Guide

## Code Style Standards

### Shell Scripts
**File Extension**: `.sh`
**Shebang**: `#!/bin/bash`
**Indentation**: 2 spaces
**Line Length**: 80 characters max

**Naming Conventions**:
- Scripts: `kebab-case.sh`
- Functions: `snake_case()`
- Variables: `UPPER_CASE` for constants, `lower_case` for locals
- Temp files: Prefix with `.` and cleanup on exit

**Best Practices**:
```bash
# Good: Explicit error handling
set -euo pipefail

# Good: Function documentation
# Description: Initialize PM system
# Returns: 0 on success, 1 on failure
init_pm_system() {
  local project_dir="${1:-}"
  [[ -z "$project_dir" ]] && return 1
  # Implementation
}

# Good: Consistent quoting
echo "Processing ${file_name}"
```

### Markdown Documentation
**File Extension**: `.md`
**Headers**: ATX-style (`#` not underlines)
**Line Length**: No hard limit, break at logical points
**Lists**: `-` for unordered, `1.` for ordered

**Naming Conventions**:
- Files: `kebab-case.md`
- Sections: Title Case
- Code blocks: Label with language

**Structure**:
```markdown
# Document Title

## Section Header

### Subsection

- Bullet point
- Another point
  - Nested point

```

### YAML Configuration
**File Extension**: `.yaml` (not `.yml`)
**Indentation**: 2 spaces
**Style**: Block style preferred

**Naming Conventions**:
- Files: `kebab-case.yaml`
- Keys: `snake_case`
- Values: Appropriate case

**Example**:
```yaml
---
metadata:
  created_at: 2025-08-28T11:37:50Z
  version: 1.0
  
configuration:
  enable_feature: true
  max_retries: 3
```

### JSON Reports
**File Extension**: `.json`
**Indentation**: 2 spaces
**Style**: Pretty-printed for human readability

**Naming Conventions**:
- Files: `{type}-{timestamp}.json`
- Keys: `camelCase`

**Example**:
```json
{
  "reportType": "analysis",
  "timestamp": "2025-08-28T11:37:50Z",
  "results": []
}
```

## Command Style Patterns

### Command Naming
**Format**: `/category:action`
**Categories**: `pm`, `context`, `testing`
**Actions**: Verb or verb-noun

**Examples**:
- `/pm:init` - Initialize PM system
- `/context:create` - Create context
- `/testing:run` - Run tests

### Command Documentation
**Structure**:
1. Brief description
2. Usage examples
3. Options/arguments
4. Expected output
5. Error conditions

## File Organization Patterns

### Directory Structure
- **Flat is better**: Minimize nesting
- **Clear purpose**: Directory name indicates content
- **Consistent depth**: Similar items at same level

### File Naming
- **Timestamps**: `YYYY-MM-DD` or Unix timestamp
- **Prefixes**: Group related files
- **Extensions**: Always include appropriate extension

## Documentation Standards

### Comments and Documentation
**Principles**:
- Document WHY, not WHAT
- Keep comments current
- Remove obsolete comments
- Use self-documenting code

**Shell Script Comments**:
```bash
# Initialize the PM system with GitHub integration
# This is required before any PM commands can be used
```

**Markdown Documentation**:
- Start with purpose/overview
- Include examples
- List prerequisites
- Document errors

### Frontmatter Standards
**Required Fields**:
```yaml
---
created: 2025-08-28T11:37:50Z
last_updated: 2025-08-28T11:37:50Z
version: 1.0
author: Claude Code PM System
---
```

### Error Messages
**Format**: `[EMOJI] Component: Clear description`
**Levels**:
- ❌ Error: Operation failed
- ⚠️ Warning: Proceed with caution
- ✅ Success: Operation completed
- 📝 Info: Informational message

**Examples**:
- `❌ PM System: Not initialized. Run /pm:init first`
- `✅ Context: Successfully created 9 files`
- `⚠️ GitHub: Not authenticated. Some features disabled`

## Git Conventions

### Commit Messages
**Format**: `<type>: <description>`
**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Testing
- `chore`: Maintenance

**Examples**:
- `feat: Add parallel agent processing`
- `fix: Resolve context update race condition`
- `docs: Update command reference`

### Branch Naming
**Format**: `<type>/<description>`
**Examples**:
- `feature/parallel-agents`
- `fix/context-corruption`
- `docs/api-reference`

## Testing Conventions

### Test Organization
- Group by functionality
- Clear test descriptions
- Isolated test cases
- Cleanup after tests

### Test Naming
**Format**: `test_<function>_<scenario>_<expected>`
**Example**: `test_init_pm_missing_gh_fails`

## Agent Communication Style

### Agent Responses
- Concise summaries (10-20% of processed data)
- Structured output
- Clear success/failure indication
- Actionable information only

### Agent Naming
- Descriptive purpose-based names
- Hyphenated format
- Examples: `code-analyzer`, `file-analyzer`, `test-runner`

## Quality Standards

### Code Quality
- No dead code
- No commented-out code
- Consistent formatting
- Proper error handling

### Documentation Quality
- Accurate and current
- Complete examples
- Clear prerequisites
- Tested commands

### Performance Standards
- Commands execute in <5 seconds
- Agents return results promptly
- Efficient token usage
- Minimal file I/O

## Review Checklist

Before committing:
- [ ] Code follows style guide
- [ ] Documentation updated
- [ ] Tests pass (if applicable)
- [ ] Error handling complete
- [ ] No sensitive information
- [ ] Commit message follows convention
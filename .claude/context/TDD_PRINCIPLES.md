# TDD Principles - IMPORTANT!

## Always Follow TRUE Test-Driven Development

### The Red-Green-Refactor Cycle

**NEVER write all tests first then all code!**

Instead, follow this cycle for EACH feature:

1. **RED**: Write ONE failing test
   - Run the test to see it fail
   - This confirms the test is actually testing something

2. **GREEN**: Write the MINIMAL code to pass
   - Just enough to make the test pass
   - Don't add extra features
   - Keep it simple

3. **REFACTOR**: Clean up if needed
   - Only after the test passes
   - Keep the code simple and clean
   - All tests must still pass

### Example from our BaseAgent implementation:

```
1. Write test for getName() → See it fail
2. Add name field and getName() → Test passes
3. Write test for getId() → See it fail  
4. Add id field and getId() → Test passes
5. Write test for process() → See it fail
6. Add minimal process() → Test passes
7. Write test for validation → See it fail
8. Add validation to process() → Test passes
```

### Benefits of True TDD:

- Immediate feedback on each feature
- Confidence that each test actually works
- Minimal, focused code (no over-engineering)
- Natural incremental development
- Better test coverage

### Anti-patterns to AVOID:

❌ Writing all tests first then all implementation
❌ Writing implementation without tests
❌ Writing more code than needed to pass the test
❌ Not running tests to see them fail first
❌ Adding features that aren't tested

### Remember:

**One test, one implementation, repeat!**

This ensures we build exactly what's needed, with full test coverage, incrementally and safely.
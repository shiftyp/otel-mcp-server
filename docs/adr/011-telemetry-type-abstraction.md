# ADR-011: Telemetry Type Abstraction for Mapping Flexibility

## Date
2025-01-06

## Status
Accepted

## Tags
telemetry, abstraction, mapping-modes

## Issue
How do we handle different field mappings between OTEL and ECS modes while maintaining consistent tool interfaces?

## Decision
Create a telemetry configuration abstraction that maps logical fields to their backend-specific paths.

## Gist
### Logical Field Names
Given that OTEL and ECS use different field names,
When we define logical names like 'service' and 'timestamp',
Then tools use consistent names regardless of backend.

### Mapping Configuration
Given that field paths vary by mode,
When we configure mappings at startup,
Then queries use the correct field names automatically.

### Tool Abstraction
Given that tools shouldn't know about mapping modes,
When tools use config.telemetry.fields.service,
Then the correct field name is used transparently.

## Constraints
- Must support both OTEL and ECS mappings
- Cannot change existing data structures
- Must be transparent to tool implementations
- Should support custom mappings

## Positions
### Position 1: Hard-code Both Mappings
- Use conditionals everywhere for field names
- **Rejected**: Unmaintainable, error-prone

### Position 2: Transform Data at Query Time
- Convert all data to canonical format
- **Rejected**: Performance overhead

### Position 3: Configuration-Based Mapping
- Map logical to physical field names
- **Accepted**: Clean, extensible

## Argument
Configuration-based mapping provides clean abstraction without runtime overhead. Tools reference logical concepts while configuration handles the mapping:

```typescript
// Tool code (clean, abstract)
const query = {
  term: { [config.telemetry.fields.service]: "frontend" }
};

// Configuration handles mapping
{
  telemetry: {
    fields: {
      service: "resource.attributes.service.name", // OTEL
      // or
      service: "service.name"                      // ECS
    }
  }
}
```

This approach scales to any number of mapping modes without changing tool code.

## Implications
- **Positive**: Tools remain mapping-agnostic
- **Positive**: Easy to add new mapping modes
- **Positive**: No runtime transformation overhead
- **Negative**: Indirection can be confusing
- **Negative**: Must maintain mapping configurations

## Related
- [Configuration Management (ADR-008)](./008-configuration-hierarchy.md)
- [Backend Adapter Pattern (ADR-003)](./003-adapter-pattern-architecture.md)
- [Type Safety (ADR-005)](./005-type-safety-approach.md)

## Notes
This abstraction has been crucial for supporting diverse deployments. Organizations using ECS mapping for compatibility with existing tools can use the same MCP interface as those using OTEL mapping. The abstraction also enabled support for custom field mappings in specialized deployments.
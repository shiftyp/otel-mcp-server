# ADR-010: Zod Schema Validation for Tool Arguments

## Date
2025-01-06

## Status
Accepted

## Tags
validation, type-safety, developer-experience

## Issue
How do we validate tool arguments from AI while providing clear error messages and maintaining type safety?

## Decision
Use Zod schemas for all tool argument validation, with automatic TypeScript type inference and descriptive validation messages.

## Gist
### Zod for Runtime Validation
Given that AI-generated arguments need validation,
When we define Zod schemas for each tool,
Then we get runtime validation with clear error messages.

### Schema-Driven Type Inference
Given that we want TypeScript type safety,
When we use Zod's type inference,
Then we get compile-time and runtime safety from one source.

### Descriptive Field Documentation
Given that AI needs to understand parameter purposes,
When we use Zod's .describe() method,
Then each field has inline documentation.

## Constraints
- Must provide clear validation errors
- Cannot trust AI-generated inputs
- Must maintain TypeScript types
- Should document parameter purposes

## Positions
### Position 1: Manual Validation
- Write custom validation for each tool
- **Rejected**: Repetitive, error-prone

### Position 2: JSON Schema
- Use JSON Schema with ajv
- **Rejected**: No TypeScript inference

### Position 3: Zod Schemas
- Runtime validation with type inference
- **Accepted**: Best of both worlds

## Argument
Zod provides the perfect combination of features for MCP tools:
1. **Runtime Safety**: Validates AI inputs before execution
2. **Type Inference**: Single source of truth for types
3. **Clear Errors**: Human-readable validation messages
4. **Documentation**: describe() serves as inline docs

Example:
```typescript
const schema = {
  service: z.string().describe('Service name to analyze'),
  from: z.string().describe('Start time (ISO 8601)'),
  to: z.string().describe('End time (ISO 8601)'),
  threshold: z.number().min(0).max(100).optional()
    .describe('Anomaly threshold percentage (0-100)')
};

type Args = MCPToolSchema<typeof schema>; // Type inference!
```

## Implications
- **Positive**: Single source of truth for validation and types
- **Positive**: Excellent error messages for AI
- **Positive**: Auto-generated documentation
- **Negative**: Additional dependency
- **Negative**: Must learn Zod patterns

## Related
- [Type Safety Strategy (ADR-005)](./005-type-safety-approach.md)
- [Tool Arguments (ADR-012)](./012-flattened-tool-arguments.md)
- [Error Handling (ADR-006)](./006-error-handling-philosophy.md)

## Notes
Zod has been transformative for tool development. The combination of validation, type inference, and documentation from a single schema definition has reduced bugs and improved AI's ability to use tools correctly. The descriptive error messages help AI self-correct invalid inputs.
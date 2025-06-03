# ADR-006: Structured Error Responses for AI Interpretation

## Date
2025-01-06

## Status
Accepted

## Tags
error-handling, ai-interaction, resilience

## Issue
How should we handle and communicate errors in a way that helps AI assistants recover gracefully?

## Decision
Implement structured error responses with consistent format, clear types, and actionable information across all tools.

## Gist
### Structured Error Objects
Given that AI needs to understand and handle errors,
When we return consistent error structures,
Then AI can parse errors and attempt recovery.

### Error Context Preservation
Given that debugging requires understanding what failed,
When we include original parameters in error responses,
Then AI can retry with modified parameters.

### Actionable Error Messages
Given that generic errors don't help recovery,
When we provide specific, actionable error messages,
Then AI can suggest solutions to users.

## Constraints
- Errors must be parseable by AI
- Cannot expose sensitive system details
- Must maintain backward compatibility
- Should help both AI and human debugging

## Positions
### Position 1: Throw Exceptions
- Let MCP protocol handle raw exceptions
- **Rejected**: Inconsistent, hard for AI to parse

### Position 2: Error Codes Only
- Return numeric codes like HTTP status
- **Rejected**: Not descriptive enough for AI

### Position 3: Structured Error Objects
- Return consistent JSON error format
- **Accepted**: Best for AI interpretation

## Argument
AI assistants need structured data to make decisions. Our error format provides:
- Consistent `error: true` flag for detection
- Specific `type` for categorization
- Descriptive `message` for user communication
- Original `params` for retry logic

Example:
```typescript
{
  error: true,
  type: "ElasticsearchDataError",
  message: "No log data found. Ensure logs are being ingested.",
  params: { index: "logs-*", query: {...} }
}
```

This enables AI to:
1. Detect the error
2. Understand it's a data availability issue
3. Communicate clearly to the user
4. Potentially retry with different parameters

## Implications
- **Positive**: AI can handle errors gracefully
- **Positive**: Consistent debugging experience
- **Positive**: Enables automated retry logic
- **Negative**: Requires discipline in error handling
- **Negative**: More verbose than simple exceptions

## Related
- [Tool Response Format (ADR-012)](./012-flattened-tool-arguments.md)
- [Validation Strategy (ADR-010)](./010-zod-schema-validation.md)
- [Logging Architecture (ADR-008)](./008-configuration-hierarchy.md)

## Notes
The structured error approach has been validated through real usage. AI assistants successfully detect data availability issues and guide users to solutions. The inclusion of original parameters has been particularly valuable for iterative query refinement.
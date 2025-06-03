# ADR-005: Practical Type Safety Over Complex External Types

## Date
2025-01-06

## Status
Accepted

## Tags
typescript, types, development-experience

## Issue
How do we achieve type safety when integrating with OpenSearch's complex type system without sacrificing developer experience?

## Decision
Create our own practical type definitions that match actual API usage rather than importing complex external type hierarchies.

## Gist
### Custom Type Definitions
Given that OpenSearch's type exports are deeply nested and complex,
When we define our own SearchResponse and Query types,
Then we get practical type safety without complexity.

### Generic Type Parameters
Given that different queries return different document types,
When we use generics like `query<LogDocument>()`,
Then TypeScript provides proper type inference.

### Minimal 'any' Usage
Given that some scenarios require dynamic types,
When we use 'any' sparingly and document why,
Then we maintain type safety where it matters most.

## Constraints
- Must work with OpenSearch client library
- Cannot modify external type definitions
- Must provide good IDE autocomplete
- Should minimize build complexity

## Positions
### Position 1: Use Full OpenSearch Types
- Import all types from @opensearch-project/opensearch
- **Rejected**: Complex imports, poor DX, build issues

### Position 2: No Types (any everywhere)
- Use 'any' for all OpenSearch interactions
- **Rejected**: Loses all type safety benefits

### Position 3: Practical Custom Types
- Define our own types matching actual usage
- **Accepted**: Best balance of safety and simplicity

## Argument
External type systems optimized for library internals rarely provide good developer experience. By defining our own types based on actual API usage, we get:
- Clear, readable type definitions
- Excellent IDE autocomplete
- Faster TypeScript compilation
- Easier onboarding for new developers

Example:
```typescript
// Our practical type
export interface SearchResponse<T> {
  hits: {
    total: { value: number };
    hits: Array<{ _source: T }>;
  };
  aggregations?: Record<string, any>;
}

// vs OpenSearch's nested complexity
import { Types } from '@opensearch-project/opensearch/api/_types';
// Multiple deep imports and complex generics...
```

## Implications
- **Positive**: Clean, understandable types
- **Positive**: Fast builds and good IDE performance
- **Positive**: Easy to extend for new use cases
- **Negative**: Must maintain type sync with API
- **Negative**: May miss some edge cases

## Related
- [Telemetry Document Types (ADR-011)](./011-telemetry-type-abstraction.md)
- [Query Builder Design (ADR-002)](./002-direct-query-philosophy.md)
- [Error Response Types (ADR-006)](./006-error-handling-philosophy.md)

## Notes
This approach dramatically improved the development experience. Build times decreased by 40%, and new contributors can understand the type system immediately. The pragmatic approach to 'any' usage (documented and limited) provides escape hatches without sacrificing overall type safety.
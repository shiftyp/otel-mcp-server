# ADR-003: Adapter Pattern for Backend Flexibility

## Date
2025-01-06

## Status
Accepted

## Tags
architecture, design-pattern, backend

## Issue
How do we support multiple search backends (Elasticsearch, OpenSearch) while maintaining a unified interface?

## Decision
Implement an adapter pattern with a base abstract class defining the contract and concrete implementations for each backend.

## Gist
### Abstract Base Adapter
Given that we need to support multiple search backends,
When we define a BaseSearchAdapter abstract class,
Then all backends implement the same interface contract.

### Backend-Specific Implementations
Given that Elasticsearch and OpenSearch have different APIs,
When we create ElasticsearchAdapter and OpenSearchAdapter classes,
Then each handles backend-specific details internally.

### Factory Pattern for Instantiation
Given that backend selection happens at runtime,
When we use AdapterFactory.create() with configuration,
Then the correct adapter is instantiated transparently.

## Constraints
- Must support both Elasticsearch 7.x/8.x and OpenSearch
- Cannot leak backend-specific details to tools
- Must handle different mapping modes (OTEL vs ECS)
- Performance overhead must be minimal

## Positions
### Position 1: Single Implementation with Conditionals
- Use if/else blocks for backend differences
- **Rejected**: Becomes unmaintainable with multiple backends

### Position 2: Strategy Pattern
- Pass backend strategies to a single adapter
- **Rejected**: Too granular for our needs

### Position 3: Adapter Pattern
- Abstract base class with concrete implementations
- **Accepted**: Clean separation of concerns

## Argument
The adapter pattern provides the ideal abstraction level. Each backend's quirks are encapsulated within its adapter, while tools interact with a consistent interface. This architecture has already proven valuable when adding OpenSearch support - no tool code needed modification.

Example structure:
```typescript
BaseSearchAdapter (abstract)
  ├── ElasticsearchAdapter
  ├── OpenSearchAdapter
  └── Future: PrometheusAdapter
```

## Implications
- **Positive**: New backends can be added without changing tools
- **Positive**: Backend-specific optimizations are possible
- **Positive**: Clean testing with mock adapters
- **Negative**: Additional abstraction layer
- **Negative**: Must maintain interface compatibility

## Related
- [Tool Implementation Pattern (ADR-004)](./004-tool-organization-strategy.md)
- [Configuration Management (ADR-008)](./008-configuration-hierarchy.md)
- [Type Safety Strategy (ADR-005)](./005-type-safety-approach.md)

## Notes
The adapter pattern has enabled seamless backend switching. Users can change from Elasticsearch to OpenSearch by simply updating configuration, with no impact on AI interactions. This flexibility has been crucial for supporting diverse deployment environments.
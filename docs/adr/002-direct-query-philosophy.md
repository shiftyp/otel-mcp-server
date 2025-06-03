# ADR-002: Direct Query Philosophy Over Abstraction

## Date
2025-01-06

## Status
Accepted

## Tags
design-philosophy, query-interface, abstraction

## Issue
Should we abstract away Elasticsearch query complexity or expose it directly to AI assistants?

## Decision
Expose Elasticsearch query DSL directly through query tools, with field discovery tools to help AI construct effective queries.

## Gist
### Direct Query Access
Given that AI assistants can learn and use complex query languages,
When we expose the full Elasticsearch query DSL,
Then AI gets maximum flexibility to answer any observability question.

### Field Discovery for Query Construction
Given that AI needs to understand available data structures,
When we provide field discovery tools (logFieldsGet, traceFieldsGet),
Then AI can explore the schema and build appropriate queries.

## Constraints
- AI assistants have varying levels of Elasticsearch knowledge
- Query complexity should not prevent basic usage
- Must support both experienced and novice users
- Cannot sacrifice power user capabilities

## Positions
### Position 1: High-Level Abstraction Layer
- Create simplified query interfaces (findErrorLogs, getSlowTraces)
- **Rejected**: Too limiting for complex investigations

### Position 2: Natural Language to Query Translation
- Build NLP layer to convert questions to queries
- **Rejected**: Adds complexity and potential translation errors

### Position 3: Direct Query Exposure
- Expose full Elasticsearch query DSL
- **Accepted**: Maximum flexibility with AI's ability to learn

## Argument
AI assistants excel at learning and using domain-specific languages. By exposing the full Elasticsearch query DSL, we avoid the "abstraction trap" where simplified interfaces become limitations. The combination of direct query access and field discovery tools creates a self-documenting system where AI can explore capabilities and construct sophisticated queries.

Real-world example: An AI can start with simple queries like `{"match_all": {}}` and progressively learn to use complex aggregations, bool queries, and time-based filtering based on user needs.

## Implications
- **Positive**: No artificial limitations on query complexity
- **Positive**: AI can leverage full Elasticsearch capabilities
- **Positive**: Transparent - users can see exact queries being run
- **Negative**: Steeper initial learning curve
- **Negative**: Requires AI to understand Elasticsearch syntax

## Related
- [Field Discovery Design (ADR-004)](./004-tool-organization-strategy.md)
- [Tool Naming Conventions (ADR-005)](./005-type-safety-approach.md)
- [Query Validation Strategy (ADR-010)](./010-zod-schema-validation.md)

## Notes
This philosophy has proven successful in practice. AI assistants quickly learn to construct complex queries, often discovering query patterns that human operators hadn't considered. The transparency of seeing actual queries also helps users learn Elasticsearch themselves.
# ADR-004: Tool Organization and Categorization Strategy

## Date
2025-01-06

## Status
Accepted

## Tags
tools, organization, architecture

## Issue
How should we organize and categorize the growing number of MCP tools for maintainability and discoverability?

## Decision
Organize tools into semantic categories (query, discovery, analysis, ml) with a structured directory layout and category-based registration.

## Gist
### Category-Based Organization
Given that we have 25+ tools with different purposes,
When we organize them into query/discovery/analysis/ml categories,
Then both developers and AI can understand tool relationships.

### Directory Structure Mirrors Categories
Given that code organization affects maintainability,
When we structure directories as `tools/{category}/{toolName}.ts`,
Then finding and modifying tools becomes intuitive.

### Dynamic Registration by Category
Given that tools should be discoverable by purpose,
When we implement category-based registration,
Then AI can request "all analysis tools" or "ML-powered tools".

## Constraints
- Tools must be easily discoverable by AI
- Categories should be semantic, not technical
- Must support cross-category tool relationships
- Registration must handle optional tools (ML)

## Positions
### Position 1: Flat Tool Structure
- All tools in a single directory
- **Rejected**: Becomes unwieldy at scale

### Position 2: Technical Categorization
- Group by implementation (sync/async, simple/complex)
- **Rejected**: Not meaningful to end users

### Position 3: Semantic Categorization
- Group by purpose (query, discovery, analysis)
- **Accepted**: Intuitive for both humans and AI

## Argument
Semantic categorization aligns with how users think about observability tasks. A developer investigating an incident naturally progresses from discovery ("what services exist?") to querying ("show me errors") to analysis ("detect anomalies"). Our tool organization mirrors this workflow.

Structure example:
```
tools/
  ├── query/       # Direct data access
  ├── discovery/   # Schema and service exploration  
  ├── analysis/    # Patterns and anomalies
  └── ml/          # Machine learning powered
```

## Implications
- **Positive**: Intuitive tool discovery
- **Positive**: Clear boundaries for new tools
- **Positive**: Category-based feature flags
- **Negative**: Some tools span categories
- **Negative**: Refactoring needed when tools evolve

## Related
- [Tool Naming Conventions (ADR-012)](./012-flattened-tool-arguments.md)
- [Dynamic Tool Registration (ADR-009)](./009-data-availability-guards.md)
- [ML Tools Architecture (ADR-007)](./007-ml-tools-architecture.md)

## Notes
The categorization has proven valuable for progressive disclosure - basic users start with query tools, while advanced users leverage analysis and ML capabilities. The structure also enabled clean feature flagging for optional ML tools.
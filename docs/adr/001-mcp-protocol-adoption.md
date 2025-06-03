# ADR-001: Adoption of Model Context Protocol (MCP)

## Date
2025-01-06

## Status
Accepted

## Tags
protocol, ai-integration, architecture

## Issue
How should we expose OpenTelemetry observability data to AI assistants in a standardized, maintainable way?

## Decision
Implement the Model Context Protocol (MCP) as the primary interface for AI-to-observability data interaction.

## Gist
### MCP Tool-Based Architecture
Given that AI assistants need structured access to observability data,
When we implement the MCP protocol with tool abstractions,
Then AI can discover and use our capabilities through a standardized interface.

### Stdio Transport for Local Development
Given that developers need to test AI integrations locally,
When we use stdio as the primary transport mechanism,
Then the server integrates seamlessly with Claude Desktop and Windsurf.

## Constraints
- Must work with existing Elasticsearch/OpenSearch backends
- Cannot modify the underlying telemetry data structure
- Must support both OTEL and ECS mapping modes
- Should minimize latency for interactive AI conversations

## Positions
### Position 1: Custom REST API
- Build a bespoke REST API with OpenAPI documentation
- **Rejected**: Requires custom client for each AI tool

### Position 2: Direct Elasticsearch Access
- Give AI direct query access to Elasticsearch
- **Rejected**: Too low-level, exposes implementation details

### Position 3: Model Context Protocol
- Implement MCP with tool abstractions
- **Accepted**: Standardized, discoverable, already supported by AI tools

## Argument
MCP provides the optimal balance between standardization and flexibility. Its tool-based architecture naturally maps to observability operations ("query traces", "detect anomalies"), while the protocol handles discovery, validation, and error handling. The stdio transport enables immediate local development without infrastructure setup.

## Implications
- **Positive**: Instant compatibility with MCP-enabled AI tools
- **Positive**: Clear tool boundaries improve maintainability
- **Negative**: Limited to MCP-compatible clients
- **Negative**: Stdio transport requires process lifecycle management

## Related
- MCP Specification: https://modelcontextprotocol.io
- [Tool Schema Design (ADR-002)](./002-direct-query-philosophy.md)
- [Error Handling Strategy (ADR-006)](./006-error-handling-philosophy.md)

## Notes
The decision to use MCP was validated through successful integrations with Claude Desktop and Windsurf. The tool-based approach has proven flexible enough to accommodate new analysis capabilities without protocol changes.
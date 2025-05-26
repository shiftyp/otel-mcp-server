# tools/

This directory contains modular tool classes for OTEL MCP Server that provide direct access to OpenTelemetry data in Elasticsearch. Each tool focuses on providing transparent, flexible query capabilities without additional abstraction layers.

## Direct Query Tools

The MCP server provides the following direct query tools:

- **logsQuery** - Execute custom Elasticsearch queries against log data
- **tracesQuery** - Execute custom Elasticsearch queries against trace data
- **queryMetrics** - Execute custom Elasticsearch queries against metric data

## Field Discovery Tools

To help with constructing queries, the following field discovery tools are available:

- **logFieldsGet** - Discover available log fields with their types and schemas
- **traceFieldsGet** - Discover available trace fields with their types
- **metricsFieldsGet** - Discover available metric fields with their types

## Service Discovery

- **servicesGet** - List all available services and their versions

## Extending Tools

To add new direct query tools, create a new file in `src/tools/implementations/`, implement your class, and register its methods as MCP tools using the `registerMcpTool` function. Focus on providing transparent access to the underlying Elasticsearch data without adding unnecessary abstraction layers.

## Design Philosophy

The tools in this project follow these principles:

1. **Direct Access** - Provide transparent access to Elasticsearch data without hiding query complexity
2. **Flexibility** - Allow users to construct their own queries for maximum control
3. **Discovery Support** - Provide tools to help users understand the available data structure
4. **Minimal Abstraction** - Avoid high-level abstractions that hide the underlying data model

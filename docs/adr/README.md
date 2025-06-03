# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) documenting the key design decisions made in the OTEL MCP Server project. ADRs capture the context, constraints, and rationale behind architectural choices.

## Format

We use a modified [Planguage template](https://github.com/joelparkerhenderson/architecture-decision-record/tree/main/locales/en/templates/decision-record-template-using-planguage) for our ADRs, which emphasizes measurable qualities and clear decision criteria.

## ADR Index

### Core Architecture
- [ADR-001: Adoption of Model Context Protocol (MCP)](001-mcp-protocol-adoption.md) - Why we chose MCP as our AI integration protocol
- [ADR-002: Direct Query Philosophy Over Abstraction](002-direct-query-philosophy.md) - Exposing Elasticsearch queries directly to AI
- [ADR-003: Adapter Pattern for Backend Flexibility](003-adapter-pattern-architecture.md) - Supporting multiple search backends

### Tool Design
- [ADR-004: Tool Organization and Categorization Strategy](004-tool-organization-strategy.md) - Semantic categorization of tools
- [ADR-012: Flattened Tool Arguments for AI Usability](012-flattened-tool-arguments.md) - Why we avoid nested parameters

### Type System
- [ADR-005: Practical Type Safety Over Complex External Types](005-type-safety-approach.md) - Custom types instead of complex imports
- [ADR-010: Zod Schema Validation for Tool Arguments](010-zod-schema-validation.md) - Runtime validation with type inference

### Operations
- [ADR-006: Structured Error Responses for AI Interpretation](006-error-handling-philosophy.md) - Error format designed for AI recovery
- [ADR-008: Configuration Hierarchy with Environment Override](008-configuration-hierarchy.md) - Three-tier configuration system
- [ADR-009: Data Availability Guards and Adaptive Tool Registration](009-data-availability-guards.md) - Only register working tools

### Features
- [ADR-007: Optional ML Tools with OpenAI Integration](007-ml-tools-architecture.md) - ML as optional enhancement
- [ADR-011: Telemetry Type Abstraction for Mapping Flexibility](011-telemetry-type-abstraction.md) - Supporting OTEL and ECS mappings

## Creating New ADRs

When adding a new ADR:
1. Use the next sequential number
2. Follow the Planguage template structure
3. Include concrete examples where possible
4. Link related ADRs
5. Update this index

## Status Definitions

- **Draft**: Under discussion
- **Accepted**: Implemented and active
- **Deprecated**: No longer relevant
- **Superseded**: Replaced by another ADR
# ADR-009: Data Availability Guards and Adaptive Tool Registration

## Date
2025-01-06

## Status
Accepted

## Tags
resilience, data-availability, user-experience

## Issue
How do we handle scenarios where expected telemetry data (logs, metrics, traces) is not available in Elasticsearch?

## Decision
Implement data availability guards that check for telemetry types at startup and only register tools for available data.

## Gist
### Startup Data Checks
Given that not all deployments have all telemetry types,
When we check for data availability at startup,
Then we only register tools that will actually work.

### Adaptive Tool Registration
Given that missing data makes tools fail,
When we detect available telemetry types,
Then AI only sees tools for existing data.

### Clear Error Messages
Given that data might be missing due to configuration,
When we detect missing data,
Then we provide actionable guidance for fixing it.

## Constraints
- Cannot assume all telemetry types exist
- Must start quickly despite checks
- Should guide users to fix missing data
- Must handle partial data availability

## Positions
### Position 1: Assume All Data Exists
- Register all tools, let them fail at runtime
- **Rejected**: Poor user experience

### Position 2: Require All Data Types
- Refuse to start without all telemetry
- **Rejected**: Too restrictive

### Position 3: Adaptive Registration
- Check availability, register accordingly
- **Accepted**: Best user experience

## Argument
Adaptive registration prevents frustrating failures. Instead of AI attempting to use non-functional tools, it only sees what's actually available. This creates a better experience:

Without traces:
- ❌ `tracesQuery` tool not registered
- ✅ `logsQuery` still available
- ✅ Clear message: "No trace data found. Check OTEL Collector configuration."

Implementation:
```typescript
const availability = await checkDataAvailability();
if (availability.traces) {
  registerTool(new TracesQuery());
  registerTool(new TraceFieldsGet());
}
if (availability.logs) {
  registerTool(new LogsQuery());
  registerTool(new LogFieldsGet());
}
```

## Implications
- **Positive**: No failed tool calls for missing data
- **Positive**: Clear guidance for fixing issues
- **Positive**: Works with partial deployments
- **Negative**: Dynamic tool set can be confusing
- **Negative**: Startup checks add latency

## Related
- [Error Handling (ADR-006)](./006-error-handling-philosophy.md)
- [Tool Organization (ADR-004)](./004-tool-organization-strategy.md)
- [Configuration Management (ADR-008)](./008-configuration-hierarchy.md)

## Notes
This approach has significantly reduced user frustration. Instead of mysterious failures, users get clear messages about what's missing and how to fix it. The adaptive nature allows gradual rollout of telemetry types.
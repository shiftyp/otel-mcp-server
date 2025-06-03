# ADR-007: Optional ML Tools with OpenAI Integration

## Date
2025-01-06

## Status
Accepted

## Tags
ml, embeddings, optional-features

## Issue
How do we incorporate ML-powered features while keeping them optional for users without OpenAI access?

## Decision
Implement ML tools as an optional category that requires OpenAI API key, with graceful degradation when unavailable.

## Gist
### Feature Flag for ML Tools
Given that not all users have OpenAI access,
When we check for OPENAI_API_KEY at startup,
Then ML tools are only registered if available.

### Embedding-Based Analysis
Given that semantic search improves log analysis,
When we generate embeddings for text comparison,
Then AI can find similar patterns beyond keyword matching.

### Graceful Degradation
Given that core functionality shouldn't require ML,
When ML tools are unavailable,
Then the system works perfectly with standard tools.

## Constraints
- Cannot require OpenAI for basic functionality
- Must handle API rate limits gracefully
- Embedding costs should be minimized
- Must cache embeddings when possible

## Positions
### Position 1: Built-in ML Models
- Ship with local models (BERT, etc.)
- **Rejected**: Too large, complex deployment

### Position 2: Multiple LLM Providers
- Support OpenAI, Anthropic, local models
- **Rejected**: Complexity without clear benefit

### Position 3: OpenAI-Only Optional
- OpenAI embeddings as optional enhancement
- **Accepted**: Simple, powerful when available

## Argument
OpenAI's embedding API provides high-quality semantic search with minimal integration complexity. By making it optional, we:
- Keep the core system lightweight
- Allow users to opt-in to advanced features
- Avoid forcing API costs on all users
- Maintain simple configuration

The implementation uses dynamic tool registration:
```typescript
if (process.env.OPENAI_API_KEY) {
  registerTool(new SemanticLogSearch());
  registerTool(new TraceClustering());
}
```

## Implications
- **Positive**: Advanced features for power users
- **Positive**: No forced dependencies
- **Positive**: Clear upgrade path
- **Negative**: Features unavailable without API key
- **Negative**: OpenAI vendor lock-in for ML

## Related
- [Tool Registration (ADR-009)](./009-data-availability-guards.md)
- [Configuration Management (ADR-008)](./008-configuration-hierarchy.md)
- [Tool Organization (ADR-004)](./004-tool-organization-strategy.md)

## Notes
ML tools have proven valuable for complex investigations. Semantic log search finds related errors that keyword search misses. Trace clustering identifies patterns in distributed failures. The optional nature has been key - users can start simple and add ML when needed.
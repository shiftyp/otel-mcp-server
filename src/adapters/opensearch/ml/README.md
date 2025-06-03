# OpenSearch ML Utilities

This module provides centralized utilities for machine learning operations with OpenSearch, including embeddings generation and data sampling.

## Features

### Embedding Generation

The embedding utilities provide a unified interface for generating embeddings across different tools and features in the application.

```typescript
import { generateEmbeddings, generateEmbedding } from '../../adapters/opensearch/ml/index.js';

// Generate embeddings for multiple items
const results = await generateEmbeddings(
  client,
  items,
  (item) => item.text,  // Function to extract text from each item
  {
    batchSize: 3,
    enableSampling: true,
    samplingPercent: 10,
    maxSamples: 100,
    context: {
      source: 'MyFeature'
    }
  }
);

// Generate embedding for a single item
const result = await generateEmbedding(
  client,
  item,
  (item) => item.text,
  options
);
```

### Data Sampling

The sampling utilities provide functions for creating sampling aggregations and processing sampling results.

```typescript
import { createSamplingAggregation, processSamplingResults } from '../../adapters/opensearch/ml/index.js';

// Create a sampling aggregation
const samplingAgg = createSamplingAggregation('field.keyword', {
  enableSampling: true,
  samplingPercent: 10,
  maxSamples: 100,
  context: {
    source: 'MyFeature'
  }
});

// Use the aggregation in a query
const query = {
  query: { ... },
  size: 0,
  aggs: samplingAgg
};

// Process sampling results
const results = processSamplingResults(
  response,
  samplingOptions,
  (bucket) => ({
    // Extract values from bucket
    id: bucket.key,
    count: bucket.doc_count
  })
);
```

## Configuration Options

### Embedding Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `modelId` | string | From env or default | Model ID to use for embedding generation |
| `batchSize` | number | 3 | Batch size for embedding generation requests |
| `enableSampling` | boolean | true | Enable sampling to reduce the number of items to embed |
| `samplingPercent` | number | 10 | Percentage of data to sample (1-100) |
| `maxSamples` | number | 100 | Maximum number of samples to process |
| `context` | object | - | Additional context for logging |

### Sampling Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableSampling` | boolean | true | Enable sampling to reduce the amount of data processed |
| `samplingPercent` | number | 10 | Percentage of data to sample (1-100) |
| `maxSamples` | number | 100 | Maximum number of samples to process |
| `context` | object | - | Additional context for logging |

## Benefits of Using These Utilities

1. **Consistency**: Ensures consistent behavior across all tools that use embeddings and sampling.
2. **Performance**: Optimizes performance through batch processing and sampling.
3. **Error Handling**: Provides robust error handling and detailed logging.
4. **Maintainability**: Centralizes code, making it easier to update and maintain.
5. **Configurability**: Offers flexible configuration options for different use cases.

## Usage in Trace Clustering

The trace clustering functionality has been updated to use these centralized utilities, providing better performance and more detailed logging:

```typescript
// In tools/opensearch/mlTools.ts
const clusterTraceAttributesOptions = {
  enableSampling: true,
  samplingPercent: 10,
  maxSamples: 100,
  embeddingBatchSize: 3
};

// The trace clustering implementation uses these options
const result = await osAdapter.tracesAdapter.clusterTraceAttributes(
  attributeKey,
  startTime,
  endTime,
  clusterTraceAttributesOptions
);
```

import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../config/index.js';
import { MCPToolSchema } from '../../types.js';
import { OpenSearchQuerySchema, SortSchema, AggregationSchema } from '../../schemas/opensearch-query.js';
import { MetricDocument } from '../../types/opensearch-types.js';

// Define the Zod schema
const MetricsQueryArgsSchema = {
  query: OpenSearchQuerySchema.describe('Elasticsearch/OpenSearch query DSL'),
  size: z.number().min(1).max(10000).optional().describe('Maximum number of results to return (default: 10, max: 10000)'),
  from: z.number().min(0).optional().describe('Offset for pagination (default: 0)'),
  sort: SortSchema.optional().describe('Sort criteria'),
  aggregations: AggregationSchema.optional().describe('Aggregations to perform'),
  index: z.string().optional().describe('Specific index to query (optional, uses default if not specified)')
};

type MetricsQueryArgs = MCPToolSchema<typeof MetricsQueryArgsSchema>;

/**
 * Tool for querying metric data
 */
export class MetricsQueryTool extends BaseTool<typeof MetricsQueryArgsSchema> {
  // Static schema property
  static readonly schema = MetricsQueryArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'queryMetrics',
      category: ToolCategory.QUERY,
      description: 'Query metric data with custom Elasticsearch/OpenSearch DSL for flexible metric retrieval and aggregation',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return MetricsQueryArgsSchema;
  }
  
  protected async executeImpl(args: MetricsQueryArgs): Promise<any> {
    const config = ConfigLoader.get();
    const index = args.index || config.telemetry.indices.metrics;
    
    const result = await this.adapter.query<MetricDocument>(
      index,
      args.query,
      {
        size: args.size,
        from: args.from,
        sort: args.sort,
        aggregations: args.aggregations
      }
    );
    
    return this.formatJsonOutput({
      total: result.hits.total.value,
      took: 0, // QueryResult doesn't include took time
      hits: result.hits.hits.map(hit => hit._source),
      aggregations: result.aggregations
    });
  }
}
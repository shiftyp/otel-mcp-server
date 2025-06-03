import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../config/index.js';
import { MCPToolSchema } from '../../types.js';
import { OpenSearchQuerySchema, SortSchema, AggregationSchema } from '../../schemas/opensearch-query.js';
import { LogDocument } from '../../types/opensearch-types.js';

// Define the Zod schema
const LogsQueryArgsSchema = {
  query: OpenSearchQuerySchema.describe('Elasticsearch/OpenSearch query DSL'),
  size: z.number().min(1).max(10000).optional().describe('Maximum number of results to return (default: 10, max: 10000)'),
  from: z.number().min(0).optional().describe('Offset for pagination (default: 0)'),
  sort: SortSchema.optional().describe('Sort criteria'),
  aggregations: AggregationSchema.optional().describe('Aggregations to perform'),
  index: z.string().optional().describe('Specific index to query (optional, uses default if not specified)')
};

type LogsQueryArgs = MCPToolSchema<typeof LogsQueryArgsSchema>;

/**
 * Tool for querying log data
 */
export class LogsQueryTool extends BaseTool<typeof LogsQueryArgsSchema> {
  // Static schema property
  static readonly schema = LogsQueryArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'queryLogs',
      category: ToolCategory.QUERY,
      description: 'Query log data with custom Elasticsearch/OpenSearch DSL for flexible log retrieval and aggregation',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return LogsQueryArgsSchema;
  }
  
  protected async executeImpl(args: LogsQueryArgs): Promise<any> {
    const config = ConfigLoader.get();
    const index = args.index || config.telemetry.indices.logs;
    
    const result = await this.adapter.query<LogDocument>(
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
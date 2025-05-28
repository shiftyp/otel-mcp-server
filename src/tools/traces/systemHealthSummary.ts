import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { logger } from '../../utils/logger.js';
import { ElasticGuards } from '../../utils/guards/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Registers the systemHealthSummary tool with the MCP server.
 * @param server MCP server instance
 * @param esAdapter Elasticsearch adapter instance
 */
export function registerSystemHealthSummaryTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'systemHealthSummary',
    {
      startTime: z.string().describe('Start time (ISO8601, required, e.g. 2023-01-01T00:00:00Z)'),
      endTime: z.string().describe('End time (ISO8601, required, e.g. 2023-01-02T00:00:00Z)'),
      includeDetails: z.boolean().optional().describe('Include bottleneck operation details (default: false)'),
      errorRateThreshold: z.number().default(0.01).describe('Error rate threshold for degraded service (fraction, default: 0.01)'),
      latencyThresholdMs: z.number().default(500).describe('Latency threshold (milliseconds, default: 500)'),
      sampleSpanCount: z.number().int().min(1).max(10).default(1).describe('Number of sample spans to include per bottleneck (default: 1, max: 10)'),
      bottleneckCount: z.number().int().min(1).max(20).default(5).describe('Number of bottleneck operations to include per service (default: 5, max: 20)'),
      service: z.string().optional().describe('Filter results to a single service name (exact match, optional)'),
      services: z.array(z.string()).optional().describe('Filter results to a list of service names (exact match, optional)'),
    },
    async (params: { startTime: string, endTime: string, includeDetails: boolean, errorRateThreshold: number, latencyThresholdMs: number, sampleSpanCount: number, bottleneckCount: number, service?: string, services?: string[] }) => {
      const { startTime, endTime, includeDetails, errorRateThreshold, latencyThresholdMs, sampleSpanCount, bottleneckCount, service, services } = params;
      try {
        // Build ES query for service health summary
        const body: any = {
          size: 0,
          query: {
            bool: {
              must: [
                {
                  range: {
                    '@timestamp': {
                      gte: startTime,
                      lte: endTime,
                    },
                  },
                },
                ...(service ? [{ term: { 'resource.attributes.service.name': service } }] : []),
                ...(services ? [{ terms: { 'resource.attributes.service.name': services } }] : []),
              ],
            },
          },
          aggs: {
            services: {
              terms: { field: 'resource.attributes.service.name', size: 100 },
              aggs: {
                error_rate: {
                  filter: { terms: { 'status.code.keyword': ['Error', 'ERROR', 'error'] } },
                },
                latency: {
                  percentiles: { field: 'duration', percents: [50, 90, 99] },
                },
                bottlenecks_by_name: {
                  terms: { field: 'name.keyword', size: bottleneckCount },
                  aggs: {
                    latencyMicroseconds: { percentiles: { field: 'duration', percents: [50, 90, 99] } },
                    error_rate: { filter: { terms: { 'status.code.keyword': ['Error', 'ERROR', 'error'] } } },
                    sample_span: {
                      top_hits: {
                        sort: [{ duration: { order: 'desc' } }],
                        size: sampleSpanCount,
                        _source: [
                          'trace_id', 'span_id', 'parent_span_id', 'name', 'duration', '@timestamp', 'status.code', 'status.message',
                          'attributes', 'resource', 'traceId', 'spanId', 'parentSpanId', 'statusCode', 'statusMessage'
                        ]
                      }
                    }
                  }
                },
              },
            },
          },
        };

        // Use tracesAdapter to run the query
        const traces = (esAdapter as any).tracesAdapter;
        if (!traces || typeof traces.queryTraces !== 'function') {
          throw new Error('tracesAdapter or queryTraces not available');
        }
        const result = await traces.queryTraces({
          size: 0,
          query: body.query,
          aggs: body.aggs
        });

        // Aggregate summary
        const summary = (result.aggregations?.services?.buckets || []).map((svc: any) => {
          const errorCount = svc.error_rate.doc_count;
          const totalCount = svc.doc_count;
          const errorRate = totalCount > 0 ? errorCount / totalCount : 0;
          const latencyMicroseconds = svc.latency.values;
          const bottlenecks = (svc.bottlenecks_by_name?.buckets || []).map((bucket: any) => {
            const samples = (bucket.sample_span.hits.hits || []).map((hit: any) => {
              const s = hit._source || {};
              return {
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                timestamp: s['@timestamp'],
                statusCode: s['status.code'],
                statusMessage: s['status.message'],
                attributes: s.attributes,
                resource: s.resource,
                duration: s.duration
              };
            });
            return {
              operation: bucket.key,
              count: bucket.doc_count,
              latencyMicroseconds: bucket.latencyMicroseconds.values,
              errorRate: bucket.doc_count > 0 ? bucket.error_rate.doc_count / bucket.doc_count : 0,
              sampleSpans: samples
            };
          });
          return {
            service: svc.key,
            errorRate,
            totalCount,
            latencyMicroseconds,
            bottlenecks: includeDetails ? bottlenecks : undefined,
            degraded: errorRate > errorRateThreshold || (latencyMicroseconds['99.0'] && latencyMicroseconds['99.0'] > latencyThresholdMs * 1000),
          };
        });

        // Return all services, marking each as degraded or not
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                startTime,
                endTime,
                services: summary
              })
            }
          ]
        };
      } catch (err) {
        logger.error('systemHealthSummary failed', { error: err instanceof Error ? err.message : String(err) });
        return ElasticGuards.formatErrorResponse(err);
      }
    }
  );
}

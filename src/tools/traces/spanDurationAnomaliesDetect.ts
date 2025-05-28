import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { logger } from '../../utils/logger.js';

/**
 * Registers the spanDurationAnomaliesDetect tool with the MCP server.
 * Detects spans with unusually high durations (latency outliers).
 */
export function registerSpanDurationAnomaliesDetectTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'spanDurationAnomaliesDetect',
    {
      startTime: z.string().describe('Start time (ISO8601, required)'),
      endTime: z.string().describe('End time (ISO8601, required)'),
      service: z.string().optional().describe('Service name (optional)'),
      operation: z.string().optional().describe('Operation/span name (optional)'),
      thresholdType: z.enum(['p99', 'stddev']).default('p99').describe('Threshold type for anomaly detection'),
      maxResults: z.number().default(20).describe('Maximum number of anomalies to return'),
    },
    async (params: { startTime: string, endTime: string, service?: string, operation?: string, thresholdType?: string, maxResults?: number }) => {
      const { startTime, endTime, service, operation, thresholdType = 'p99', maxResults = 20 } = params;
      
      try {
        logger.info('[MCP TOOL] spanDurationAnomaliesDetect called', { startTime, endTime, service, operation, thresholdType, maxResults });
        
        // Build the base bool filter
        const must: any[] = [];
        
        // Add time range filter
        if (startTime || endTime) {
          const range: any = { '@timestamp': {} };
          if (startTime) range['@timestamp'].gte = startTime;
          if (endTime) range['@timestamp'].lte = endTime;
          must.push({ range });
        }
        
        // Add service filter if provided
        if (service) {
          must.push({
            bool: {
              should: [
                { term: { 'resource.attributes.service.name': service } },
                { term: { 'Resource.service.name': service } },
                { term: { 'service.name': service } },
                { term: { 'resource.attributes.service.name': service } }
              ],
              minimum_should_match: 1
            }
          });
        }
        
        // Add operation/span name filter if provided
        if (operation) {
          must.push({
            bool: {
              should: [
                { term: { 'name': operation } },
                { term: { 'Name': operation } }
              ],
              minimum_should_match: 1
            }
          });
        }
        
        // Step 1: Get duration statistics for each operation
        const operationStatsQuery = {
          size: 0,
          query: {
            bool: {
              must
            }
          },
          aggs: {
            operations: {
              terms: {
                field: 'name.keyword',
                size: 100
              },
              aggs: {
                services: {
                  terms: {
                    script: {
                      source: `
                        def serviceName = doc['resource.attributes.service.name'].size() > 0 ? 
                          doc['resource.attributes.service.name'].value : 
                          (doc['Resource.service.name'].size() > 0 ? 
                            doc['Resource.service.name'].value : 
                            (doc['service.name'].size() > 0 ? 
                              doc['service.name'].value : 'unknown'));
                        return serviceName;
                      `
                    },
                    size: 10
                  }
                },
                duration_stats: {
                  stats: {
                    field: 'duration'
                  }
                },
                duration_percentiles: {
                  percentiles: {
                    field: 'duration',
                    percents: [50, 75, 90, 95, 99]
                  }
                }
              }
            }
          }
        };
        
        // Execute the query to get operation statistics
        logger.debug('[MCP TOOL] spanDurationAnomaliesDetect executing operation stats query', { operationStatsQuery });
        const statsResponse = await esAdapter.tracesAdapter.queryTraces(operationStatsQuery);
        logger.debug('[MCP TOOL] spanDurationAnomaliesDetect operation stats response', { aggregations: statsResponse.aggregations });
        
        // Process the results to determine thresholds for each operation
        const operationThresholds: Record<string, { 
          service: string, 
          threshold: number, 
          avg: number, 
          stddev: number, 
          p99: number 
        }> = {};
        
        if (statsResponse.aggregations?.operations?.buckets) {
          for (const opBucket of statsResponse.aggregations.operations.buckets) {
            const opName = opBucket.key;
            const stats = opBucket.duration_stats;
            const percentiles = opBucket.duration_percentiles?.values || {};
            const serviceBuckets = opBucket.services?.buckets || [];
            const primaryService = serviceBuckets.length > 0 ? serviceBuckets[0].key : 'unknown';
            
            // Calculate threshold based on selected method
            let threshold: number;
            if (thresholdType === 'p99') {
              threshold = percentiles['99.0'] || (stats.avg + 3 * stats.std_deviation);
            } else { // stddev
              threshold = stats.avg + 3 * stats.std_deviation; // 3 standard deviations
            }
            
            operationThresholds[opName] = {
              service: primaryService,
              threshold: threshold,
              avg: stats.avg,
              stddev: stats.std_deviation,
              p99: percentiles['99.0'] || 0
            };
          }
        }
        
        // Step 2: Find spans that exceed their operation's threshold
        const anomalyQueries = Object.entries(operationThresholds).map(([opName, thresholdData]) => {
          return {
            operation: opName,
            service: thresholdData.service,
            query: {
              bool: {
                must: [
                  ...must,
                  { term: { 'name.keyword': opName } },
                  { range: { 'duration': { gt: thresholdData.threshold } } }
                ]
              }
            },
            threshold: thresholdData.threshold,
            avg: thresholdData.avg,
            stddev: thresholdData.stddev,
            p99: thresholdData.p99
          };
        });
        
        // Execute queries for each operation to find anomalies
        const anomalyPromises = anomalyQueries.map(async (anomalyQuery) => {
          const query = {
            size: Math.ceil(maxResults / anomalyQueries.length),
            query: anomalyQuery.query,
            sort: [
              { 'duration': { order: 'desc' } }
            ],
            _source: [
              'trace_id', 'span_id', 'name', 'duration', '@timestamp',
              'resource.attributes.service.name', 'Resource.service.name', 'service.name',
              'status.code', 'Status.Code', 'attributes.error', 'Attributes.error'
            ]
          };
          
          const response = await esAdapter.tracesAdapter.queryTraces(query);
          
          return {
            operation: anomalyQuery.operation,
            service: anomalyQuery.service,
            threshold: anomalyQuery.threshold,
            avg: anomalyQuery.avg,
            stddev: anomalyQuery.stddev,
            p99: anomalyQuery.p99,
            anomalies: response.hits?.hits?.map((hit: any) => {
              const source = hit._source;
              const serviceName = 
                source.resource?.attributes?.['service.name'] || 
                source.Resource?.service?.name || 
                source.service?.name || 
                'unknown';
              
              // Calculate duration in milliseconds
              const durationMs = source.duration / 1000000; // Convert nanoseconds to milliseconds
              
              // Determine if span has an error
              const hasError = 
                source.status?.code === 2 || 
                source.Status?.Code === 2 || 
                source.attributes?.error === true || 
                source.Attributes?.error === true;
              
              return {
                trace_id: source.trace_id,
                span_id: source.span_id,
                operation: source.name,
                service: serviceName,
                timestamp: source['@timestamp'],
                duration_ms: durationMs,
                duration_ns: source.duration,
                has_error: hasError,
                deviation_factor: source.duration / anomalyQuery.avg
              };
            }) || []
          };
        });
        
        // Wait for all anomaly queries to complete
        const anomalyResults = await Promise.all(anomalyPromises);
        
        // Filter out operations with no anomalies and sort by most severe anomalies first
        const filteredResults = anomalyResults
          .filter(result => result.anomalies.length > 0)
          .sort((a, b) => {
            // Sort by max deviation factor (most severe anomalies first)
            const maxDevA = Math.max(...a.anomalies.map((anomaly: any) => anomaly.deviation_factor));
            const maxDevB = Math.max(...b.anomalies.map((anomaly: any) => anomaly.deviation_factor));
            return maxDevB - maxDevA;
          });
        
        // Format for MCP tool response
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                anomalies: filteredResults,
                metadata: {
                  total_operations_analyzed: Object.keys(operationThresholds).length,
                  operations_with_anomalies: filteredResults.length,
                  threshold_type: thresholdType,
                  time_range: {
                    start: startTime,
                    end: endTime
                  }
                }
              })
            }
          ]
        };
      } catch (err) {
        logger.error('[MCP TOOL] spanDurationAnomaliesDetect failed', { 
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          params: { startTime, endTime, service, operation, thresholdType, maxResults }
        });
        
        return {
          content: [
            { type: 'text', text: `Span duration anomaly detection failed: ${(err as Error).message}` }
          ],
          isError: true
        };
      }
    }
  );
}


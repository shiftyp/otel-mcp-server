import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Registers the logAnomaliesDetect tool with the MCP server.
 * Detects rare log messages and spikes in error/warning volume.
 */
export function registerLogAnomaliesDetectTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'logAnomaliesDetect',
    {
      startTime: z.string().describe('Start time (ISO8601, required)'),
      endTime: z.string().describe('End time (ISO8601, required)'),
      service: z.string().optional().describe('Service name (optional)'),
      level: z.string().optional().describe('Log level/severity (optional)'),
      maxResults: z.number().default(20).describe('Maximum number of anomalies to return'),
      minCount: z.number().default(2).describe('Minimum number of occurrences for rare messages (default: 2)'),
    },
    async (params: { startTime: string, endTime: string, service?: string, level?: string, maxResults?: number, minCount?: number }) => {
      const { startTime, endTime, service, level, maxResults, minCount = 2 } = params;
      // Build the base bool filter
      const must: any[] = [];
      if (startTime || endTime) {
        const range: any = { '@timestamp': {} };
        if (startTime) range['@timestamp'].gte = startTime;
        if (endTime) range['@timestamp'].lte = endTime;
        must.push({ range });
      }
      if (service) {
        must.push({
          bool: {
            should: [
              { term: { 'resource.service.name': service } },
              { term: { 'service.name': service } },
              { term: { 'Resource.attributes.service.name': service } },
              { term: { 'resource.attributes.service.name': service } }
            ],
            minimum_should_match: 1
          }
        });
      }
      if (level) {
        must.push({
          bool: {
            should: [
              { term: { 'level': level } },
              { term: { 'severity_text': level } },
              { term: { 'Severity': level } }
            ],
            minimum_should_match: 1
          }
        });
      }
      // Step 1: Get rare messages using terms aggregation
      const rareAgg = {
        rare_messages: {
          terms: {
            field: 'body.text',
            size: maxResults ?? 10,
            order: { _count: 'asc' }
          },
          aggs: {
            top_example: {
              top_hits: {
                size: 1,
                _source: {
                  includes: ['@timestamp','message','body.text','service.name','resource.service.name','level','severity_text','trace_id','span_id']
                }
              }
            }
          }
        }
      };

      // Spike detection aggregation (date_histogram with derivative on _count)
      const spikeAgg = {
        logs_over_time: {
          date_histogram: {
            field: '@timestamp',
            fixed_interval: '5m'
          },
          aggs: {
            count_deriv: {
              derivative: {
                buckets_path: '_count'
              }
            }
          }
        }
      };
      
      // Add a filter for error messages to focus on error spikes
      const errorFilter = [
        ...must,
        {
          bool: {
            should: [
              { term: { 'level': 'ERROR' } },
              { term: { 'severity_text': 'ERROR' } },
              { term: { 'Severity': 'ERROR' } },
              { term: { 'level': 'WARN' } },
              { term: { 'severity_text': 'WARN' } },
              { term: { 'Severity': 'WARN' } }
            ],
            minimum_should_match: 1
          }
        }
      ];


      // Create three separate query bodies for rare messages, spike detection, and error pattern spikes
      const rareBody = {
        _source: true,
        size: 0,
        query: { bool: { must } },
        aggs: { ...rareAgg }
      };

      const spikeBody = {
        _source: true,
        size: 0,
        query: { bool: { must } },
        aggs: { ...spikeAgg }
      };
      
      // Error pattern spike detection query
      // This combines date histogram with error message pattern detection
      const errorSpikeBody = {
        _source: true,
        size: 0,
        query: { bool: { must: errorFilter } },
        aggs: {
          error_time_buckets: {
            date_histogram: {
              field: '@timestamp',
              fixed_interval: '15m' // Use larger interval for error patterns
            },
            aggs: {
              error_patterns: {
                significant_text: {
                  field: 'body.text',
                  size: 3, // Top 3 significant error patterns per time bucket
                  filter_duplicate_text: true
                }
              },
              error_count: {
                value_count: {
                  field: '@timestamp'
                }
              }
            }
          }
        }
      };

      try {
        // Step 1: Run all three queries in parallel
        const [rareResp, spikeResp, errorSpikeResp] = await Promise.all([
          esAdapter.logsAdapter.queryModule.queryLogs(rareBody),
          esAdapter.logsAdapter.queryModule.queryLogs(spikeBody),
          esAdapter.logsAdapter.queryModule.queryLogs(errorSpikeBody)
        ]);
        
        // Parse initial rare messages
        const rareBuckets = rareResp.aggregations?.rare_messages?.buckets || [];
        const rareMessages = rareBuckets
          .filter((b: any) => b.doc_count >= minCount) // Apply minCount filter
          .map((b: any) => {
            const example = b.top_example?.hits?.hits?.[0]?._source || {};
            return {
              message: b.key,
              count: b.doc_count,
              example: {
                timestamp: example['@timestamp'],
                full_text: example['body.text'] || example['message'],
                service: example['service.name'] || example['resource.service.name'],
                level: example['level'] || example['severity_text'],
                trace_id: example['trace_id'],
                span_id: example['span_id']
              }
            };
          });
        
        // Step 2: For each rare message, run a significant_text query to find similar patterns
        const similarPatternPromises = rareMessages.map(async (rareMsg: any) => {
          // Create a query that uses significant_text to find similar patterns to this rare message
          const significantTextBody = {
            size: 0,
            query: {
              bool: {
                must: [
                  ...must,
                  // Use a match query with the first few words of the message to find similar patterns
                  {
                    match: {
                      'body.text': rareMsg.message.split(' ').slice(0, 3).join(' ')
                    }
                  }
                ]
              }
            },
            aggs: {
              similar_patterns: {
                significant_text: {
                  field: 'body.text',
                  size: 5,
                  filter_duplicate_text: true
                }
              }
            }
          };
          
          // Run the significant_text query
          const similarResp = await esAdapter.logsAdapter.queryModule.queryLogs(significantTextBody);
          
          // Extract similar patterns
          const similarPatterns = similarResp.aggregations?.similar_patterns?.buckets || [];
          return {
            original: rareMsg,
            similar: similarPatterns.map((p: any) => ({
              pattern: p.key,
              score: p.score,
              count: p.doc_count,
              background_count: p.bg_count
            }))
          };
        });
        
        // Wait for all similar pattern queries to complete
        const rareWithSimilar = await Promise.all(similarPatternPromises);
        
        // Parse spikes
        const buckets = spikeResp.aggregations?.logs_over_time?.buckets || [];
        const spikes = buckets
          // Filter for significant spikes (derivative > 2x the current doc_count)
          .filter((b: any) => b.count_deriv && b.count_deriv.value && b.count_deriv.value > 2 * (b.doc_count || 1))
          .map((b: any) => ({
            timestamp: b.key_as_string,
            count: b.doc_count,
            spike: b.count_deriv.value
          }));
        // Process error pattern spikes with pattern extraction and fingerprinting
        const errorTimeBuckets = errorSpikeResp.aggregations?.error_time_buckets?.buckets || [];
        
        // Helper function to extract pattern and generate a fingerprint
        const extractPattern = (message: string) => {
          // Replace variable parts with placeholders
          // 1. Replace UUIDs and hex IDs with [ID]
          let pattern = message.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]');
          // 2. Replace timestamps with [TIMESTAMP]
          pattern = pattern.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g, '[TIMESTAMP]');
          // 3. Replace numbers with [NUMBER]
          pattern = pattern.replace(/\b\d+\b/g, '[NUMBER]');
          // 4. Replace file paths with [PATH]
          pattern = pattern.replace(/(\/[\w\-.]+)+/g, '[PATH]');
          // 5. Replace line numbers in stack traces
          pattern = pattern.replace(/line \d+/g, 'line [NUMBER]');
          
          // Generate a fingerprint from the first line or first 100 chars
          const firstLine = pattern.split('\n')[0];
          const fingerprint = firstLine.length > 100 ? firstLine.substring(0, 100) : firstLine;
          
          return { pattern, fingerprint };
        };
        
        // Process error patterns with fingerprinting
        const errorPatternSpikes = errorTimeBuckets
          .filter((bucket: any) => bucket.doc_count > 0 && bucket.error_patterns?.buckets?.length > 0)
          .map((bucket: any) => {
            // Process patterns in this time bucket
            const processedPatterns = (bucket.error_patterns?.buckets || []).map((pattern: any) => {
              const { pattern: normalizedPattern, fingerprint } = extractPattern(pattern.key);
              // Get just the first line of the raw message to keep response size manageable
              const firstLine = pattern.key.split('\n')[0];
              const shortMessage = firstLine + (pattern.key.includes('\n') ? '...' : '');
              
              return {
                pattern_id: fingerprint,
                // Only include the first 150 chars of the normalized pattern to keep response size manageable
                pattern: normalizedPattern.length > 150 ? normalizedPattern.substring(0, 150) + '...' : normalizedPattern,
                raw_message: shortMessage,
                score: pattern.score,
                count: pattern.doc_count,
                background_count: pattern.bg_count
              };
            });
            
            return {
              timestamp: bucket.key_as_string,
              count: bucket.doc_count,
              error_count: bucket.error_count?.value || 0,
              patterns: processedPatterns
            };
          });

        // Format for MCP tool response
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                rareMessages: rareWithSimilar,
                spikes,
                errorPatternSpikes
              })
            }
          ]
        };
      } catch (err) {
        return {
          content: [
            { type: 'text', text: `Log anomaly detection failed: ${(err as Error).message}` }
          ],
          isError: true
        };
      }
    }
  );
}

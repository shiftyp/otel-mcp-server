import { logger } from '../../../utils/logger.js';
import { LogsSearchAdapter } from './logSearch.js';
// Minimal local ApiResponse type to avoid missing module error
// Remove this if you add @opensearch-project/opensearch types to your project
export type ApiResponse<T> = { body: T };


/**
 * Enrich results with context logs
 * @param results Results to enrich
 * @param contextWindowSize Number of logs before/after to include
 * @param options Search adapter options
 */
export async function enrichWithContext(
  results: any[],
  contextWindowSize: number,
  options: any
): Promise<void> {
  const indexPattern = 'logs-*';
  const logsSearchAdapter = new LogsSearchAdapter(options);
  
  for (const result of results) {
    try {
      // Skip if no timestamp or service
      if (!result.timestamp || !result.service) {
        continue;
      }
      
      // Find logs before and after the current log
      const contextQuery = {
        query: {
          bool: {
            must: [
              {
                term: {
                  'resource.attributes.service.name': result.service
                }
              },
              {
                range: {
                  '@timestamp': {
                    gte: new Date(new Date(result.timestamp).getTime() - (contextWindowSize * 60 * 1000)).toISOString(),
                    lte: new Date(new Date(result.timestamp).getTime() + (contextWindowSize * 60 * 1000)).toISOString()
                  }
                }
              }
            ],
            must_not: [
              {
                ids: {
                  values: [result.id]
                }
              }
            ]
          }
        },
        size: contextWindowSize * 2,
        sort: [
          {
            '@timestamp': {
              order: 'asc'
            }
          }
        ]
      };
      
      const contextResponse = await logsSearchAdapter.searchLogs(contextQuery) as ApiResponse<{ hits: { hits: Array<{ _id: string; _source: Record<string, unknown> }> } }>;
      
      if (contextResponse.body.hits && contextResponse.body.hits.hits && contextResponse.body.hits.hits.length > 0) {
        // Process context logs
        const contextLogs = contextResponse.body.hits.hits.map((hit: { _id: string; _source: Record<string, any> }) => {
          const source = hit._source;
          const timestamp = source['@timestamp'];
          const message = source.body || source.message || source['log.message'];
          const level = source.severity_text;
          const traceId = source.trace_id;
          const spanId = source.span_id;
          
          return {
            id: hit._id,
            timestamp,
            message,
            service: result.service,
            level,
            trace_id: traceId,
            span_id: spanId,
            isContext: true
          };
        });
        
        // Add context to the result
        result.context = contextLogs;
      }
    } catch (error) {
      logger.warn('[SemanticLogSearch] Error enriching result with context', {
        error: error instanceof Error ? error.message : String(error),
        resultId: result.id
      });
    }
  }
}

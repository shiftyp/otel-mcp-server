import { ElasticsearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { LogErrorsAdapter } from './logErrors.js';

export class LogsAdapter extends ElasticsearchCore {
  // Instance of LogErrorsAdapter for error-related functionality
  private errorAdapter: LogErrorsAdapter;
  
  constructor(config: any) {
    super(config);
    this.errorAdapter = new LogErrorsAdapter(config);
  }
  
  /**
   * Search OTEL logs for a pattern following OpenTelemetry specification
   * https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/logs/data-model.md
   * 
   * @param pattern Optional search pattern
   * @param serviceOrServices Optional service name or array of services to filter logs by
   * @param logLevel Optional log level to filter by (e.g., 'error', 'info')
   * @returns Array of log objects with structured data
   */
  public async searchOtelLogs(pattern: string, serviceOrServices?: string | string[], logLevel?: string, startTime?: string, endTime?: string): Promise<{
    timestamp: string;
    service: string;
    level: string;
    message: string;
    trace_id?: string;
    span_id?: string;
    attributes?: Record<string, any>;
  }[]> {
    logger.info('[ES Adapter] Searching logs', { pattern, serviceOrServices, logLevel, startTime, endTime });
    
    try {
      // Prepare service filter if provided
      const services = serviceOrServices ? 
        (Array.isArray(serviceOrServices) ? serviceOrServices : [serviceOrServices]) : 
        undefined;
      
      // Build a simple, direct query
      const query: any = {
        bool: {
          must: [
            // Time range for logs
            {
              range: {
                '@timestamp': {
                  gte: startTime || 'now-30d',  // Use provided start time or default to 30 days
                  lte: endTime || 'now'        // Use provided end time or default to now
                }
              }
            }
          ]
        }
      };
      
      // Add log level filter if provided
      if (logLevel) {
        const normalizedLevel = logLevel.toLowerCase();
        query.bool.must.push({
          bool: {
            should: [
              // OTEL mapping mode fields
              { term: { 'attributes.level': normalizedLevel } },
              { term: { 'severity_text': normalizedLevel } },
              
              // ECS mapping mode fields
              { term: { 'SeverityText': normalizedLevel.toUpperCase() } },
              { term: { 'log.level': normalizedLevel } },
              { term: { 'severity': normalizedLevel } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Add pattern search if provided
      if (pattern) {
        // Use a simpler approach that won't try to apply wildcards to numeric fields
        query.bool.must.push({
          bool: {
            should: [
              // OTEL mapping mode fields
              { wildcard: { "body": `*${pattern}*` } },
              { wildcard: { "attributes.message": `*${pattern}*` } },
              { wildcard: { "attributes.exception.message": `*${pattern}*` } },
              
              // ECS mapping mode fields
              { wildcard: { "Body": `*${pattern}*` } },
              { wildcard: { "message": `*${pattern}*` } },
              { wildcard: { "exception.message": `*${pattern}*` } },
              { wildcard: { "error.message": `*${pattern}*` } },
              { wildcard: { "log.message": `*${pattern}*` } },
              
              // For non-text fields, use a match query which is safer
              { match: { "_all": pattern } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Add service filter if provided
      if (services?.length) {
        if (!query.bool.filter) {
          query.bool.filter = [];
        }
        
        // For multiple services, create an array of term queries for exact matching
        const serviceTerms = [];
        for (const service of services) {
          // OTEL mapping mode fields
          serviceTerms.push({ term: { 'resource.attributes.service.name': service } });
          serviceTerms.push({ term: { 'resource.attributes.k8s.deployment.name': service } });
          
          // ECS mapping mode fields
          serviceTerms.push({ term: { 'resource.service.name': service } });
          serviceTerms.push({ term: { 'Resource.service.name': service } });
          serviceTerms.push({ term: { 'service.name': service } });
          serviceTerms.push({ term: { 'kubernetes.deployment.name': service } });
          serviceTerms.push({ term: { 'k8s.deployment.name': service } });
          
          // Add term queries for Kubernetes event fields that might contain service names
          serviceTerms.push({ term: { 'Body.object.regarding.name': service } });
          serviceTerms.push({ term: { 'Body.object.metadata.name': service } });
          serviceTerms.push({ term: { 'Body.object.regarding.kind': service } });
          serviceTerms.push({ term: { 'Body.object.involvedObject.name': service } });
        }
        
        query.bool.filter.push({
          bool: {
            should: serviceTerms,
            minimum_should_match: 1
          }
        });
      }
      
      // Search across all possible log indices with a simple approach
      const response = await this.request('POST', '/logs*,*logs*/_search', {
        size: 100,
        query,
        sort: [
          { '@timestamp': { order: 'desc' } }
        ],
        _source: true  // Get all fields
      }).catch(err => {
        logger.warn('[ES Adapter] Error searching logs', { error: err });
        return { hits: { hits: [] } };
      });
      
      logger.info('[ES Adapter] Log search results', { count: response.hits?.hits?.length || 0 });
      
      // Process the results, handling various OTEL log formats
      return response.hits?.hits?.map((hit: any) => {
        const source = hit._source || {};
        
        // Extract timestamp from various possible fields
        const timestamp = 
          source['@timestamp'] || 
          source['timestamp'] || 
          new Date().toISOString();
        
        // Extract service name from various possible fields
        let service = 
          source['service']?.name || 
          source['resource']?.['service.name'] || 
          source['Resource']?.['service.name'] || 
          source['Resource']?.service?.name;
          
        // For Kubernetes events, try to extract service name from object fields
        if (!service && source['Body.object.regarding.name']) {
          // Extract service name from pod name (e.g., "frontend-758f7b8695-2r6hv" → "frontend")
          const podName = source['Body.object.regarding.name'];
          const match = podName.match(/^([a-z0-9-]+)-[a-z0-9]{9,10}-[a-z0-9]{5}$/);
          if (match) {
            service = match[1]; // First capture group is the service name
          } else {
            service = podName.split('-')[0]; // Fallback to first part of name
          }
        }
        
        // Default to unknown if no service name could be extracted
        if (!service) {
          service = 'unknown';
        }
        
        // Extract log level from various possible fields
        const level = 
          source['severity_text'] || 
          source['SeverityText'] || 
          source['log']?.level || 
          source['severity'] || 
          'info';
        
        // Extract message directly from source fields
        // Try Body first since that's what might be marked as _ignored
        const message = 
          source['Body'] || 
          source['body'] ||
          source['message'] || 
          source['exception']?.message || 
          source['error']?.message || 
          JSON.stringify(source);
        
        // Extract trace ID from various possible fields
        const traceId = 
          source['trace_id'] || 
          source['trace']?.id || 
          source['TraceId'] || 
          '';
        
        // Extract span ID from various possible fields
        const spanId = 
          source['span_id'] || 
          source['span']?.id || 
          source['SpanId'] || 
          '';
        
        // Return a structured object with all the relevant log information
        const formattedMessage = typeof message === 'string' ? message : JSON.stringify(message);
        return {
          timestamp,
          service,
          level: level.toUpperCase(),
          message: formattedMessage,
          trace_id: traceId || undefined,
          span_id: spanId || undefined,
          attributes: {
            ...Object.entries(source)
              .filter(([key]) => !['@timestamp', 'timestamp', 'service', 'level', 'message', 'trace_id', 'span_id'].includes(key))
              .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
          }
        };
      }) || [{
        timestamp: new Date().toISOString(),
        service: 'log-search',
        level: 'ERROR',
        message: `No logs found matching the search criteria. This might be due to:\n - No logs matching the pattern "${pattern}"\n - No logs from the specified service(s): ${serviceOrServices ? (Array.isArray(serviceOrServices) ? serviceOrServices.join(', ') : serviceOrServices) : 'all services'}\n - Logs exist but are in fields marked as _ignored by Elasticsearch`,
        trace_id: undefined,
        span_id: undefined,
        attributes: {}
      }];
    } catch (error) {
      logger.error('[ES Adapter] Error in searchOtelLogs', { error });
      return [{
        timestamp: new Date().toISOString(),
        service: 'log-search',
        level: 'ERROR',
        message: `An error occurred while searching logs: ${error instanceof Error ? error.message : String(error)}\nPlease check the server logs for more details.`,
        trace_id: undefined,
        span_id: undefined,
        attributes: {}
      }];
    }
  }
  
  /**
   * Get the top N errors in logs for a time window
   * Following OpenTelemetry specification for logs and traces
   * 
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param N Number of top errors to return
   * @param serviceOrServices Optional service name or array of services to filter by
   * @param searchPattern Optional search pattern to filter errors
   * @param query Optional Elasticsearch query string to filter errors (e.g., "service:frontend AND message:error")
   * @returns Array of error objects with count and metadata
   */
  public async topErrors(
    startTime: string, 
    endTime: string, 
    N = 10, 
    serviceOrServices?: string | string[],
    searchPattern?: string,
    query?: string
  ): Promise<{ 
    error: string, 
    count: number, 
    level?: string, 
    service?: string, 
    timestamp?: string, 
    trace_id?: string, 
    span_id?: string 
  }[]> {
    logger.info('[ES Adapter] Finding top errors', { startTime, endTime, serviceOrServices, searchPattern, query });
    
    try {
      // First try to get errors from logs (following OTEL spec)
      // Always use 'error' as the log level for the topErrors functionality
      const logErrors = await this.errorAdapter.getErrorsFromLogs(startTime, endTime, N, serviceOrServices, searchPattern || query);
      
      // If we found errors in logs, return them
      if (logErrors.length > 0) {
        logger.info('[ES Adapter] Found errors in logs', { count: logErrors.length });
        return logErrors;
      }
      
      // If no errors in logs, try to get errors from traces
      logger.info('[ES Adapter] No errors found in logs, trying traces');
      const traceErrors = await this.errorAdapter.getErrorsFromTraces(startTime, endTime, N, serviceOrServices, searchPattern || query);
      
      if (traceErrors.length > 0) {
        logger.info('[ES Adapter] Found errors in traces', { count: traceErrors.length });
        return traceErrors;
      }
      
      // No errors found in either logs or traces
      logger.info('[ES Adapter] No errors found in logs or traces');
      return [];
    } catch (error) {
      logger.error('[ES Adapter] Error finding top errors', { error });
      return [];
    }
  }
  
  /**
   * List all log fields and their types from log indices, filtering out metadata fields.
   * @param includeSourceDocument Whether to include source document fields (default: true for logs)
   * @returns Array of { name, type, count, schema }
   */
  public async listLogFields(includeSourceDocument: boolean = true): Promise<Array<{ name: string, type: string, count: number, schema: any }>> {
    try {
      logger.debug('[LogsAdapter] listLogFields called', { includeSourceDocument });
      
      // Use a comprehensive pattern to match all possible log indices
      const resp = await this.request('GET', '/logs*,*logs*/_mapping').catch(err => {
        logger.warn('[LogsAdapter] Error getting logs mapping', { error: err });
        return {};
      });
      
      // If no indices were found, return an empty array
      if (Object.keys(resp).length === 0) {
        logger.info('[LogsAdapter] No log indices found, returning empty array');
        return [];
      }
      
      // Extract fields from the mapping response
      const fields: Array<{ name: string, type: string, count: number, schema: any }> = [];
      const processedFields = new Set<string>();
      
      for (const indexName of Object.keys(resp)) {
        const mappings = resp[indexName].mappings;
        if (!mappings || !mappings.properties) continue;
        
        // Extract fields recursively
        this.extractFields(mappings.properties, '', fields, processedFields, includeSourceDocument);
      }
      
      // Sort fields by name for consistent output
      fields.sort((a, b) => a.name.localeCompare(b.name));
      
      logger.debug('[LogsAdapter] listLogFields result', { 
        fieldCount: fields.length,
        sampleFields: fields.slice(0, 5)
      });
      
      return fields;
    } catch (error) {
      logger.error('[LogsAdapter] listLogFields error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [];
    }
  }
  
  /**
   * Helper method to recursively extract fields from Elasticsearch mappings
   */
  private extractFields(
    properties: Record<string, any>,
    prefix: string,
    result: Array<{ name: string, type: string, count: number, schema: any }>,
    processedFields: Set<string>,
    includeSourceDocument: boolean
  ): void {
    // Skip certain metadata fields unless includeSourceDocument is true
    const skipPrefixes = includeSourceDocument ? [] : ['_', '@'];
    
    for (const [fieldName, fieldDef] of Object.entries(properties)) {
      // Skip metadata fields based on prefix
      if (skipPrefixes.some(p => fieldName.startsWith(p))) continue;
      
      const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
      
      // Skip if already processed
      if (processedFields.has(fullPath)) continue;
      processedFields.add(fullPath);
      
      if (fieldDef.properties) {
        // Nested object - recurse
        this.extractFields(fieldDef.properties, fullPath, result, processedFields, includeSourceDocument);
      } else {
        // Leaf field - add to result
        result.push({
          name: fullPath,
          type: fieldDef.type || 'unknown',
          count: 0, // We don't have actual count without aggregation
          schema: fieldDef
        });
      }
    }
  }

  /**
   * Query logs with a custom query
   * Ensures _source is enabled by default to access all fields including ignored ones
   * Supports runtime_mappings and script_fields for advanced Elasticsearch queries
   */
  public async queryLogs(query: any): Promise<any> {
    // If _source isn't explicitly set to false, ensure it's enabled
    if (query._source !== false) {
      query._source = query._source || true;
    }
    
    // Log the query for debugging purposes
    logger.debug('[ES Adapter] Executing logs query', { 
      hasRuntimeMappings: !!query.runtime_mappings,
      hasScriptFields: !!query.script_fields,
      queryStructure: Object.keys(query)
    });
    
    try {
      return await this.request('POST', '/logs*,*logs*/_search', query);
    } catch (error: unknown) {
      // Provide more detailed error information for runtime field issues
      if (error instanceof Error && 
          (error.message.includes('runtime_mappings') || error.message.includes('script'))) {
        logger.error('[ES Adapter] Error with runtime mappings or scripts', { 
          error: error.message,
          query: JSON.stringify(query)
        });
        throw new Error(`Error with runtime mappings or scripts: ${error.message}`);
      }
      
      // Re-throw the original error
      throw error;
    }
  }
}

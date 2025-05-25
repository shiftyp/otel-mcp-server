import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { LogFieldsTool } from '../logFields.js';
import { LogAnomalyDetectionTool } from '../logAnomalyDetection/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register log-related tools with the MCP server
 */
export function registerLogTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const logFieldsTool = new LogFieldsTool(esAdapter);
  const logAnomalyDetectionTool = new LogAnomalyDetectionTool(esAdapter);
  
  // Note: Incident graph visualization has been moved to the consolidated MarkdownVisualizationsTool

  // Logs search
  registerMcpTool(
    server,
    'searchLogs',
    { 
      pattern: z.string().optional().describe('Search term to filter log fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter logs to only those from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter logs to only those from these services. Takes precedence over service parameter if both are provided.'),
      level: z.string().optional().describe('Log level (optional) - Filter logs by severity level (e.g., "error", "info", "warn").')
    },
    async (args: { pattern?: string, service?: string, services?: string[], level?: string }, extra: unknown) => {
      // Determine which services to use
      let serviceFilter: string | string[] | undefined = undefined;
      if (args.services && args.services.length > 0) {
        serviceFilter = args.services;
      } else if (args.service) {
        serviceFilter = args.service;
      }
      
      // Search OTEL logs in Elasticsearch for the given pattern (in message/content fields)
      logger.info('[MCP TOOL] logs.search calling searchOtelLogs', { 
        pattern: args.pattern, 
        service: args.service,
        services: args.services,
        level: args.level
      });
      
      // Define the type for log objects returned by searchOtelLogs
      type LogObject = {
        timestamp: string;
        service: string;
        level: string;
        message: string;
        trace_id?: string;
        span_id?: string;
        attributes?: Record<string, any>;
      };
      
      try {
        const logs = await esAdapter.searchOtelLogs(args.pattern || '', serviceFilter, args.level);
        
        if (!logs.length) {
          const levelInfo = args.level ? ` with level "${args.level}"` : '';
          const patternInfo = args.pattern ? ` matching "${args.pattern}"` : '';
          return { content: [{ type: 'text', text: `No logs found${patternInfo}${levelInfo}.` }] } as MCPToolOutput;
        }
        
        logger.info('[MCP TOOL] logs.search raw result', { 
          pattern: args.pattern,
          logCount: logs.length,
          firstLogSample: logs.length > 0 ? JSON.stringify(logs[0]).substring(0, 100) + '...' : 'No logs'
        });
        
        // Return the raw log objects as JSON
        const output: MCPToolOutput = { 
          content: [{ 
            type: 'text', 
            text: logs.length ? JSON.stringify(logs, null, 2) : 'No logs found.' 
          }] 
        };
        
        logger.info('[MCP TOOL] logs.search result', { 
          pattern: args.pattern, 
          service: args.service,
          services: args.services,
          logCount: logs.length 
        });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] logs.search error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error searching logs: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );

  // Log fields schema with co-occurring fields
  registerMcpTool(
    server,
    'searchForLogFields',
    { 
      search: z.string().optional().describe('Search term to filter log fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided.'),
      useSourceDocument: z.boolean().optional().default(true).describe('Whether to include source document fields (default: true for logs)')
    },
    async (args: { search?: string, service?: string, services?: string[], useSourceDocument?: boolean }, extra: unknown) => {
      try {
        logger.info('[MCP TOOL] logFieldsSchema called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get log fields, filtered by service if specified
        const fields = await logFieldsTool.getLogFields(args.search, serviceFilter, args.useSourceDocument);
        
        // Format the output
        const result = {
          totalFields: fields.length,
          fields: fields.map(field => ({
            name: field.name,
            type: field.type,
            count: field.count,
            schema: field.schema,
            coOccurringFields: field.coOccurringFields || []
          }))
        };
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
      } catch (error) {
        logger.error('[MCP TOOL] logFieldsSchema error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error retrieving log fields schema: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );

  // Note: Incident graph extraction has been moved to the consolidated MarkdownVisualizationsTool

  // Logs query
  registerMcpTool(
    server,
    'queryLogs',
    { query: z.object({
      query: z.record(z.unknown()).optional(),
      size: z.number().optional(),
      from: z.number().optional(),
      sort: z.any().optional(),
      aggs: z.record(z.unknown()).optional(),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Source fields to include (default: true - includes all fields including ignored ones)'),
      search: z.string().optional(),
      agg: z.record(z.unknown()).optional(),
      runtime_mappings: z.record(z.unknown()).optional().describe('Runtime field mappings for Elasticsearch'),
      script_fields: z.record(z.unknown()).optional().describe('Script fields for Elasticsearch')
    }).strict().describe('Query OTEL logs in Elasticsearch. Use the same query format as Elasticsearch. Run searchForLogFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      const resp = await esAdapter.queryLogs(args.query);
      const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
      logger.info('[MCP TOOL] logs result', { args, output });
      return output;
    }
  );
  
  // Log anomaly detection
  registerMcpTool(
    server,
    'detectLogAnomalies',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the time window to analyze.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the time window to analyze.'),
      service: z.string().optional().describe('Service name (optional) - The service whose logs to analyze. If not provided, logs from all services will be included unless services array is specified.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Multiple services whose logs to analyze. Takes precedence over service parameter if both are provided.'),
      methods: z.array(z.enum(['frequency', 'pattern', 'statistical', 'clustering', 'cardinality', 'ngramSimilarity'])).optional().describe('Detection methods to use (optional) - Array of methods to apply. Default is all methods.'),
      lookbackWindow: z.string().optional().describe('Lookback window (optional) - Time window for baseline, e.g., "7d" for 7 days. Default is "7d".'),
      interval: z.string().optional().describe('Interval (optional) - Time bucket size for analysis, e.g., "1h" for hourly. Default is "1h".'),
      spikeThreshold: z.number().optional().describe('Spike threshold (optional) - Multiplier above baseline to consider anomalous. Default is 3.'),
      patternKeywords: z.array(z.string()).optional().describe('Pattern keywords (optional) - Custom error patterns to search for.'),
      includeDefaultPatterns: z.boolean().optional().describe('Include default patterns (optional) - Whether to include default error patterns. Default is true.'),
      zScoreThreshold: z.number().optional().describe('Z-score threshold (optional) - Standard deviations from mean to flag as anomaly. Default is 3.'),
      percentileThreshold: z.number().optional().describe('Percentile threshold (optional) - Percentile above which to flag as anomaly. Default is 95.'),
      cardinalityThreshold: z.number().optional().describe('Cardinality threshold (optional) - Multiplier above normal cardinality to flag as anomaly. Default is 2.'),
      significancePValue: z.number().optional().describe('Significance p-value (optional) - Statistical significance level for rare event detection. Default is 0.05.'),
      maxResults: z.number().optional().describe('Max results (optional) - Maximum number of anomalies to return. Default is 100.')
    },
    async (args: any, extra: unknown) => {
      try {
        logger.info('[MCP TOOL] detectLogAnomalies called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Prepare options for the anomaly detection
        const options: any = {};
        
        // Only include specified options
        if (args.methods) options.methods = args.methods;
        if (args.lookbackWindow) options.lookbackWindow = args.lookbackWindow;
        if (args.interval) options.interval = args.interval;
        if (args.spikeThreshold) options.spikeThreshold = args.spikeThreshold;
        if (args.patternKeywords) options.patternKeywords = args.patternKeywords;
        if (args.includeDefaultPatterns !== undefined) options.includeDefaultPatterns = args.includeDefaultPatterns;
        if (args.zScoreThreshold) options.zScoreThreshold = args.zScoreThreshold;
        if (args.percentileThreshold) options.percentileThreshold = args.percentileThreshold;
        if (args.cardinalityThreshold) options.cardinalityThreshold = args.cardinalityThreshold;
        if (args.significancePValue) options.significancePValue = args.significancePValue;
        if (args.maxResults) options.maxResults = args.maxResults;
        
        // Detect log anomalies
        const anomalies = await logAnomalyDetectionTool.detectLogAnomalies(
          args.startTime,
          args.endTime,
          serviceFilter,
          options
        );
        
        // Format the output
        const output: MCPToolOutput = { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(anomalies, null, 2) 
          }] 
        };
        
        // Handle both grouped and flat response formats for logging
        if (anomalies && typeof anomalies === 'object' && 'grouped_by_service' in anomalies) {
          // Grouped response
          logger.info('[MCP TOOL] detectLogAnomalies result (grouped)', { 
            startTime: args.startTime,
            endTime: args.endTime,
            service: args.service,
            services: args.services,
            totalAnomalies: anomalies.total_anomalies,
            serviceCount: Object.keys(anomalies.services).length,
            detectionMethods: anomalies.detection_methods
          });
        } else {
          // Flat response
          const anomalyArray = Array.isArray(anomalies) ? anomalies : [];
          const detectionMethods = new Set<string>();
          
          anomalyArray.forEach((anomaly: any) => {
            if (anomaly.detection_method) {
              detectionMethods.add(anomaly.detection_method);
            }
            if (anomaly.detection_methods && Array.isArray(anomaly.detection_methods)) {
              anomaly.detection_methods.forEach((method: string) => detectionMethods.add(method));
            }
          });
          
          logger.info('[MCP TOOL] detectLogAnomalies result', { 
            startTime: args.startTime,
            endTime: args.endTime,
            service: args.service,
            services: args.services,
            anomalyCount: anomalyArray.length,
            detectionMethods: Array.from(detectionMethods)
          });
        }
        
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] detectLogAnomalies error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error detecting log anomalies: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );
}

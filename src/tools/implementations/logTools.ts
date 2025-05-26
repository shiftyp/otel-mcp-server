import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { LogsTableTool } from '../visualizations/logsTable.js';
import { LogFieldsTool } from '../logFields.js';
import { LogAnomalyDetectionTool } from '../logAnomalyDetection/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register log-related tools with the MCP server
 */
export function registerLogTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const logFieldsTool = new LogFieldsTool(esAdapter);
  const logAnomalyDetectionTool = new LogAnomalyDetectionTool(esAdapter);

  // Logs search
  registerMcpTool(
    server,
    'findLogs',
    { 
      pattern: z.string().optional().describe('Text to search within log messages and fields'),
      service: z.string().optional().describe('Filter to logs from a specific service.'),
      services: z.array(z.string()).optional().describe('Filter to logs from multiple services (overrides service parameter)'),
      level: z.string().optional().describe('Filter by log severity (e.g., "error", "info", "warn")'),
      timeRange: z.object({
        start: z.string().describe('Start time in ISO 8601 format or Elasticsearch date math (e.g., "now-24h")'),
        end: z.string().describe('End time in ISO 8601 format or Elasticsearch date math (e.g., "now")')
      }).optional().describe('Time window for log search')
    },
    async (args: { pattern?: string, service?: string, services?: string[], level?: string, timeRange?: { start: string, end: string } }, extra: unknown) => {
      // Determine which services to use
      let serviceFilter: string | string[] | undefined = undefined;
      if (args.services && args.services.length > 0) {
        serviceFilter = args.services;
      } else if (args.service) {
        serviceFilter = args.service;
      }
      
      // Extract time range if provided
      const startTime = args.timeRange?.start;
      const endTime = args.timeRange?.end;
      
      // Search OTEL logs in Elasticsearch for the given pattern (in message/content fields)
      logger.info('[MCP TOOL] logs.search calling searchOtelLogs', { 
        pattern: args.pattern, 
        service: args.service,
        services: args.services,
        level: args.level,
        startTime,
        endTime
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
        const logs = await esAdapter.searchOtelLogs(args.pattern || '', serviceFilter, args.level, startTime, endTime);
        
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
    'logFieldsGet',
    { 
      search: z.string().optional().describe('Filter fields by name pattern'),
      service: z.string().optional().describe('Filter to fields from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to fields from multiple services (overrides service parameter)'),
      useSourceDocument: z.boolean().optional().default(true).describe('Include source document fields in results')
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
    'logsQuery',
    { query: z.object({
      query: z.record(z.unknown()).optional().describe('Elasticsearch query object'),
      size: z.number().optional().describe('Maximum number of results to return'),
      from: z.number().optional().describe('Starting offset for pagination'),
      sort: z.any().optional().describe('Sort order for results'),
      aggs: z.record(z.unknown()).optional().describe('Aggregation definitions'),
      _source: z.union([z.array(z.string()), z.boolean()]).optional().default(true).describe('Fields to include in results'),
      search: z.string().optional().describe('Simple text search across fields'),
      agg: z.record(z.unknown()).optional().describe('Simplified aggregation definition'),
      runtime_mappings: z.record(z.unknown()).optional().describe('Dynamic field definitions'),
      script_fields: z.record(z.unknown()).optional().describe('Computed fields using scripts')
    }).strict().describe('Execute custom Elasticsearch query against log data') },
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
    'logAnomaliesDetect',
    {
      timeRange: z.object({
        start: z.string().describe('Start time in ISO 8601 format'),
        end: z.string().describe('End time in ISO 8601 format')
      }).describe('Time window for analysis'),
      service: z.string().optional().describe('Filter to logs from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to logs from multiple services (overrides service parameter)'),
      methods: z.array(z.enum(['frequency', 'pattern', 'statistical', 'clustering', 'cardinality', 'ngramSimilarity'])).optional().describe('Detection methods to apply'),
      thresholds: z.object({
        spike: z.number().optional().describe('Multiplier above baseline (default: 3)'),
        zScore: z.number().optional().describe('Standard deviations from mean (default: 3)'),
        percentile: z.number().optional().describe('Percentile threshold (default: 95)'),
        cardinality: z.number().optional().describe('Cardinality multiplier (default: 2)'),
        significance: z.number().optional().describe('P-value for statistical tests (default: 0.05)')
      }).optional().describe('Detection sensitivity settings'),
      options: z.object({
        lookbackWindow: z.string().optional().describe('Time window for baseline, e.g., "7d" for 7 days'),
        interval: z.string().optional().describe('Time bucket size for analysis: "30m" (30 min), "1h" (hourly), "1d" (daily), "1w" (weekly)'),
        patternKeywords: z.array(z.string()).optional().describe('Custom error patterns to search for'),
        includeDefaultPatterns: z.boolean().optional().describe('Include default error patterns (default: true)')
      }).optional().describe('Analysis configuration options'),
      interval: z.string().optional().describe('Time bucket size for analysis: "30m" (30 min), "1h" (hourly), "1d" (daily), "1w" (weekly)'),
      lookbackWindow: z.string().optional().describe('Time window for baseline, e.g., "7d" for 7 days'),
      maxResults: z.number().optional().describe('Maximum number of anomalies to return (default: 100)')
    },
    async (args: any, extra: unknown) => {
      try {
        logger.info('[MCP TOOL] logAnomaliesDetect called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Prepare options for the anomaly detection
        const options: any = {};
        
        // Extract time range
        const startTime = args.timeRange?.start || args.startTime;
        const endTime = args.timeRange?.end || args.endTime;
        
        if (!startTime || !endTime) {
          throw new Error('Time range is required (either as timeRange object or startTime/endTime parameters)');
        }
        
        // Add detection methods if specified
        if (args.methods) options.methods = args.methods;
        
        // Add threshold settings if specified
        if (args.thresholds) {
          if (args.thresholds.spike) options.spikeThreshold = args.thresholds.spike;
          if (args.thresholds.zScore) options.zScoreThreshold = args.thresholds.zScore;
          if (args.thresholds.percentile) options.percentileThreshold = args.thresholds.percentile;
          if (args.thresholds.cardinality) options.cardinalityThreshold = args.thresholds.cardinality;
          if (args.thresholds.significance) options.significancePValue = args.thresholds.significance;
        }
        
        // Add legacy threshold parameters for backward compatibility
        if (args.spikeThreshold) options.spikeThreshold = args.spikeThreshold;
        if (args.zScoreThreshold) options.zScoreThreshold = args.zScoreThreshold;
        if (args.percentileThreshold) options.percentileThreshold = args.percentileThreshold;
        if (args.cardinalityThreshold) options.cardinalityThreshold = args.cardinalityThreshold;
        if (args.significancePValue) options.significancePValue = args.significancePValue;
        
        // Add analysis options
        if (args.options) {
          if (args.options.lookbackWindow) options.lookbackWindow = args.options.lookbackWindow;
          if (args.options.interval) options.interval = args.options.interval;
          if (args.options.patternKeywords) options.patternKeywords = args.options.patternKeywords;
          if (args.options.includeDefaultPatterns !== undefined) options.includeDefaultPatterns = args.options.includeDefaultPatterns;
        }
        
        // Add top-level options (these take precedence over nested options)
        if (args.lookbackWindow) options.lookbackWindow = args.lookbackWindow;
        if (args.interval) options.interval = args.interval;
        
        // Add legacy options for backward compatibility
        if (args.patternKeywords) options.patternKeywords = args.patternKeywords;
        if (args.includeDefaultPatterns !== undefined) options.includeDefaultPatterns = args.includeDefaultPatterns;
        
        // Add max results
        if (args.maxResults) options.maxResults = args.maxResults;
        
        // Detect log anomalies
        const anomalies = await logAnomalyDetectionTool.detectLogAnomalies(
          startTime,
          endTime,
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

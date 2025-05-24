import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { IncidentGraphTool } from '../incidentGraph.js';
import { LogFieldsTool } from '../logFields.js';
import { LogAnomalyDetectionTool } from '../logAnomalyDetection/index.js';

/**
 * Register log-related tools with the MCP server
 */
export function registerLogTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const incidentGraphTool = new IncidentGraphTool(esAdapter);
  const logFieldsTool = new LogFieldsTool(esAdapter);
  const logAnomalyDetectionTool = new LogAnomalyDetectionTool(esAdapter);

  // Logs search
  server.tool(
    'searchLogs',
    { 
      pattern: z.string().optional().describe('Search term to filter log fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter logs to only those from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter logs to only those from these services. Takes precedence over service parameter if both are provided.')
    },
    async (args: { pattern?: string, service?: string, services?: string[] }) => {
      // Determine which services to use
      let serviceFilter: string | string[] | undefined = undefined;
      if (args.services && args.services.length > 0) {
        serviceFilter = args.services;
      } else if (args.service) {
        serviceFilter = args.service;
      }
      
      // Search OTEL logs in Elasticsearch for the given pattern (in message/content fields)
      const logs = await esAdapter.searchOtelLogs(args.pattern || '', serviceFilter);
      const output: MCPToolOutput = { content: [{ type: 'text', text: logs.length ? logs.join('\n\n') : 'No logs found.' }] };
      logger.info('[MCP TOOL] logs.search result', { 
        pattern: args.pattern, 
        service: args.service,
        services: args.services,
        logCount: logs.length 
      });
      return output;
    }
  );

  // Log fields schema with co-occurring fields
  server.tool(
    'searchForLogFields',
    { 
      search: z.string().optional().describe('Search term to filter log fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided.')
    },
    async (args: { search?: string, service?: string, services?: string[] }, _extra: unknown) => {
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
        const fields = await logFieldsTool.getLogFields(args.search, serviceFilter);
        
        // Format the output
        const result = {
          totalFields: fields.length,
          fields: fields.map(field => ({
            name: field.name,
            type: field.type,
            count: field.count,
            schema: field.schema,
            coOccurringFields: field.coOccurringFields?.slice(0, 20) || []
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

  // Incident graph extraction
  server.tool(
    'extractIncidentGraph',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the incident window.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the incident window.'),
      service: z.string().optional().describe('Service name (optional) - Focus on a single service if provided.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Focus on multiple services. Takes precedence over service parameter if both are provided.')
    },
    async (args: { startTime: string, endTime: string, service?: string, services?: string[] }, _extra: unknown) => {
      // Determine which services to use
      let serviceFilter: string | undefined = undefined;
      if (args.services && args.services.length > 0) {
        // If multiple services are specified, we'll need to run the extraction for each service
        // and then combine the results
        const multiServiceResults = await Promise.all(
          args.services.map(service => 
            incidentGraphTool.extractIncidentGraph(args.startTime, args.endTime, service)
          )
        );
        
        // Combine the results
        const combinedResult = {
          nodes: [] as any[],
          edges: [] as any[],
          annotations: { 
            title: `Incident Graph for Multiple Services (${args.services.join(', ')})`,
            description: `Time window: ${args.startTime} to ${args.endTime}`,
            services: args.services
          }
        };
        
        // Track nodes we've already added to avoid duplicates
        const nodeIds = new Set<string>();
        const edgeKeys = new Set<string>(); // format: "from-to"
        
        // Combine nodes and edges from all service results
        multiServiceResults.forEach(serviceResult => {
          // Add unique nodes
          (serviceResult.nodes || []).forEach((node: any) => {
            if (!nodeIds.has(node.id)) {
              nodeIds.add(node.id);
              combinedResult.nodes.push(node);
            }
          });
          
          // Add unique edges
          (serviceResult.edges || []).forEach((edge: any) => {
            const edgeKey = `${edge.from}-${edge.to}`;
            if (!edgeKeys.has(edgeKey)) {
              edgeKeys.add(edgeKey);
              combinedResult.edges.push(edge);
            }
          });
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(combinedResult, null, 2) 
          }] 
        };
      } else if (args.service) {
        serviceFilter = args.service;
      }
      
      // If single service or no service specified, use the standard approach
      const result = await incidentGraphTool.extractIncidentGraph(args.startTime, args.endTime, serviceFilter);
      return { 
        content: [{ 
          type: 'text', 
          text: JSON.stringify(result, null, 2) 
        }] 
      };
    }
  );

  // Logs query
  server.tool(
    'queryLogs',
    { query: z.object({
      query: z.record(z.unknown()).optional(),
      size: z.number().optional(),
      from: z.number().optional(),
      sort: z.any().optional(),
      aggs: z.record(z.unknown()).optional(),
      _source: z.union([z.array(z.string()), z.boolean()]).optional(),
      search: z.string().optional(),
      agg: z.record(z.unknown()).optional()
    }).strict().describe('Query OTEL logs in Elasticsearch. Use the same query format as Elasticsearch. Run searchForLogFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      const resp = await esAdapter.queryLogs(args.query);
      const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(resp) }] };
      logger.info('[MCP TOOL] logs result', { args, output });
      return output;
    }
  );
  
  // Log anomaly detection
  server.tool(
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
    async (args, _extra) => {
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

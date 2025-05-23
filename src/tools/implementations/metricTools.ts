import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { AnomalyDetectionTool } from '../anomalyDetection.js';
import { OtelMetricsTools } from '../otelMetrics.js';

/**
 * Register metrics-related tools with the MCP server
 */
export function registerMetricTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const anomalyDetectionTool = new AnomalyDetectionTool(esAdapter);
  const otelMetricsTools = new OtelMetricsTools(esAdapter);

  // Search for metrics fields
  server.tool(
    'searchMetricsFields',
    { 
      search: z.string().optional().describe('Search term to filter metric fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided.')
    },
    async (args: { search?: string, service?: string, services?: string[] }, _extra: unknown) => {
      try {
        logger.info('[MCP TOOL] searchMetricsFields called', { args });
        
        // Determine which services to use
        let serviceFilter: string | string[] | undefined = undefined;
        if (args.services && args.services.length > 0) {
          serviceFilter = args.services;
        } else if (args.service) {
          serviceFilter = args.service;
        }
        
        // Get all metric fields from Elasticsearch, filtered by service if specified
        const allFields = await otelMetricsTools.getAllMetricFields(args.search, serviceFilter);
        const schemas = await otelMetricsTools.getGroupedMetricSchemas(args.search);
        
        // Format the output with schema information
        const fields = allFields.map(fieldName => {
          // Find the schema information for this field
          let type = 'unknown';
          let schema = null;
          
          // Look through all schemas to find this field
          for (const [metricName, fieldSchema] of Object.entries(schemas)) {
            for (const [field, fieldType] of Object.entries(fieldSchema)) {
              if (field === fieldName || `metric.${field}` === fieldName) {
                type = fieldType;
                schema = { type: fieldType };
                break;
              }
            }
            if (schema) break;
          }
          
          return {
            name: fieldName,
            type,
            schema,
            count: 0, // We don't have count information for metrics
            coOccurringFields: [] // We don't track co-occurring fields for metrics yet
          };
        });
        
        const result = {
          totalFields: fields.length,
          fields
        };
        
        return { 
          content: [{ 
            type: 'text', 
            text: JSON.stringify(result, null, 2) 
          }] 
        };
      } catch (error) {
        logger.error('[MCP TOOL] searchMetricsFields error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error retrieving metric fields: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );

  // OTEL metrics range
  server.tool(
    'generateMetricsRangeAggregation',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the metric aggregation window.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the metric aggregation window.'),
      metricField: z.string().optional().describe('Metric field (optional) - The metric field to aggregate. Use searchMetricsFields to get a list of available fields and their schemas.'),
      service: z.string().optional().describe('Service name (optional) - The service whose metrics to aggregate. Use listServices to get a list of available services.')
    },
    async (args: { startTime: string, endTime: string, metricField?: string, service?: string }) => {
      const metrics = await esAdapter.aggregateOtelMetricsRange(
        args.startTime,
        args.endTime,
        args.metricField,
        args.service
      );
      
      const output: MCPToolOutput = {
        content: [{ type: 'text', text: metrics.length ? metrics.join('\n\n') : 'No metrics found.' }]
      };
      
      logger.info('[MCP TOOL] otelmetricsrange result', { args, metricCount: metrics.length });
      return output;
    }
  );

  // Metrics query
  server.tool(
    'queryMetrics',
    { query: z.object({
      query: z.record(z.unknown()).optional(),
      size: z.number().optional(),
      from: z.number().optional(),
      sort: z.unknown().optional(),
      _source: z.union([z.array(z.string()), z.boolean()]).optional(),
      search: z.string().optional(),
      agg: z.record(z.unknown()).optional(),
      aggs: z.record(z.unknown()).optional()
    }).strict().describe('Query OTEL metrics in Elasticsearch. Use the same query format as Elasticsearch. Run searchMetricsFields to get a list of available fields and their schemas.') },
    async (args: { query?: any }) => {
      try {
        logger.info('[MCP TOOL] queryMetrics called', { args });
        
        // Construct the Elasticsearch query
        const query = args.query || {};
        const indexPattern = '.ds-metrics-*';
        
        // Execute the query
        const response = await esAdapter.callEsRequest('POST', `/${indexPattern}/_search`, query);
        
        const output: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
        logger.info('[MCP TOOL] queryMetrics result', { hits: response.hits?.total?.value || 0 });
        return output;
      } catch (error) {
        logger.error('[MCP TOOL] queryMetrics error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error querying metrics: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );

  // Anomaly metric detection with flexible hybrid approach
  server.tool(
    'detectMetricAnomalies',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the time window.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the time window.'),
      service: z.string().optional().describe('Service name (optional) - The service whose metrics to analyze. If not provided, metrics from all services will be included unless services array is specified. Use listServices to get a list of available services.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Multiple services whose metrics to analyze. Takes precedence over service parameter if both are provided.'),
      metricField: z.string().optional().describe('Metric field (optional) - The specific metric field to analyze. If not provided, all numeric fields will be analyzed and results will be grouped by field. Use searchMetricsFields to get a list of available fields and their schemas.'),
      absoluteThreshold: z.number().optional().describe('Absolute value threshold. If not provided, mean will be used.'),
      zScoreThreshold: z.number().optional().describe('Z-score threshold (default: 3) - Number of standard deviations above mean to flag as anomaly.'),
      percentileThreshold: z.number().optional().describe('Percentile threshold (default: 95) - Flag values above this percentile.'),
      iqrMultiplier: z.number().optional().describe('IQR multiplier (default: 1.5) - For IQR-based outlier detection.'),
      changeThreshold: z.number().optional().describe('Rate of change threshold as percentage (default: 50) - Flag sudden changes.'),
      interval: z.string().optional().describe('Time interval for buckets (default: "1m").'),
      maxResults: z.number().optional().describe('Maximum number of results to return (default: 100).')
    },
    async (args: { 
      startTime: string, 
      endTime: string, 
      metricField?: string, 
      service?: string, 
      services?: string[],
      absoluteThreshold?: number,
      zScoreThreshold?: number,
      percentileThreshold?: number,
      iqrMultiplier?: number,
      changeThreshold?: number,
      interval?: string,
      maxResults?: number
    }) => {
      const options = {
        absoluteThreshold: args.absoluteThreshold,
        zScoreThreshold: args.zScoreThreshold,
        percentileThreshold: args.percentileThreshold,
        iqrMultiplier: args.iqrMultiplier,
        changeThreshold: args.changeThreshold,
        interval: args.interval,
        maxResults: args.maxResults
      };
      
      // Determine which service parameter to use (services array takes precedence)
      const serviceParam = args.services && args.services.length > 0 ? args.services : args.service;
      
      const anomalies = await anomalyDetectionTool.detectMetricAnomalies(
        args.startTime,
        args.endTime,
        args.metricField,
        serviceParam,
        options
      );
      
      const output: MCPToolOutput = {
        content: [{ type: 'text', text: JSON.stringify(anomalies, null, 2) }]
      };
      
      // Handle both grouped and flat response formats for logging
      if (anomalies && typeof anomalies === 'object' && 'grouped_by_service' in anomalies) {
        // Grouped response
        logger.info('[MCP TOOL] detectMetricAnomalies result (grouped)', { 
          args, 
          totalAnomalies: anomalies.total_anomalies,
          serviceCount: Object.keys(anomalies.services).length
        });
      } else {
        // Flat response
        const anomalyArray = Array.isArray(anomalies) ? anomalies : [];
        logger.info('[MCP TOOL] detectMetricAnomalies result', { 
          args, 
          anomalyCount: anomalyArray.length,
          detectionMethods: anomalyArray.length > 0 ? 
            [...new Set(anomalyArray.flatMap((a: any) => a.detection_methods))] : []
        });
      }
      return output;
    }
  );

  // Span duration anomaly detection with flexible hybrid approach
  server.tool(
    'detectSpanDurationAnomalies',
    {
      startTime: z.string().describe('Start time (ISO 8601) - The beginning of the time window.'),
      endTime: z.string().describe('End time (ISO 8601) - The end of the time window.'),
      service: z.string().optional().describe('Service name (optional) - The service whose spans to analyze. If not provided, spans from all services will be included unless services array is specified. Use listServices to get a list of available services.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Multiple services whose spans to analyze. Takes precedence over service parameter if both are provided.'),
      operation: z.string().optional().describe('Operation name (optional) - The specific operation to analyze. If not provided, all operations will be analyzed and results will be grouped by operation.'),
      absoluteThreshold: z.number().optional().describe('Absolute duration threshold in nanoseconds (default: 1000000 = 1ms).'),
      zScoreThreshold: z.number().optional().describe('Z-score threshold (default: 3) - Number of standard deviations above mean to flag as anomaly.'),
      percentileThreshold: z.number().optional().describe('Percentile threshold (default: 95) - Flag spans above this percentile.'),
      iqrMultiplier: z.number().optional().describe('IQR multiplier (default: 1.5) - For IQR-based outlier detection.'),
      maxResults: z.number().optional().describe('Maximum number of results to return (default: 100).'),
      groupByOperation: z.boolean().optional().describe('Whether to analyze each operation separately (default: true).')
    },
    async (args: { 
      startTime: string, 
      endTime: string, 
      service?: string, 
      services?: string[],
      operation?: string, 
      absoluteThreshold?: number,
      zScoreThreshold?: number,
      percentileThreshold?: number,
      iqrMultiplier?: number,
      maxResults?: number,
      groupByOperation?: boolean
    }) => {
      const options = {
        absoluteThreshold: args.absoluteThreshold,
        zScoreThreshold: args.zScoreThreshold,
        percentileThreshold: args.percentileThreshold,
        iqrMultiplier: args.iqrMultiplier,
        maxResults: args.maxResults,
        groupByOperation: args.groupByOperation
      };
      
      // Determine which service parameter to use (services array takes precedence)
      const serviceParam = args.services && args.services.length > 0 ? args.services : args.service;
      
      const anomalies = await anomalyDetectionTool.detectSpanDurationAnomalies(
        args.startTime,
        args.endTime,
        serviceParam,
        args.operation,
        options
      );
      
      const output: MCPToolOutput = {
        content: [{ type: 'text', text: JSON.stringify(anomalies, null, 2) }]
      };
      
      // Handle both grouped and flat response formats for logging
      if (anomalies && typeof anomalies === 'object' && 'grouped_by_service' in anomalies) {
        // Grouped response
        logger.info('[MCP TOOL] detectSpanDurationAnomalies result (grouped)', { 
          args, 
          totalAnomalies: anomalies.total_anomalies,
          serviceCount: Object.keys(anomalies.services).length
        });
      } else {
        // Flat response
        const anomalyArray = Array.isArray(anomalies) ? anomalies : [];
        logger.info('[MCP TOOL] detectSpanDurationAnomalies result', { 
          args, 
          anomalyCount: anomalyArray.length,
          detectionMethods: anomalyArray.length > 0 ? 
            [...new Set(anomalyArray.flatMap((a: any) => a.detection_methods))] : []
        });
      }
      return output;
    }
  );
}

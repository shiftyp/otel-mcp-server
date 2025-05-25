import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { AnomalyDetectionTool } from '../anomalyDetection/index.js';
import { OtelMetricsTools } from '../otelMetrics.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register metrics-related tools with the MCP server
 */
export function registerMetricTools(server: McpServer, esAdapter: ElasticsearchAdapter) {
  const anomalyDetectionTool = new AnomalyDetectionTool(esAdapter);
  const otelMetricsTools = new OtelMetricsTools(esAdapter);

  // Search for metrics fields
  registerMcpTool(
    server,
    'searchMetricsFields',
    { 
      search: z.string().optional().describe('Search term to filter metric fields.'),
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided.'),
      useSourceDocument: z.boolean().optional().default(false).describe('Whether to include source document fields (default: false for metrics)')
    },
    async (args: { search?: string, service?: string, services?: string[], useSourceDocument?: boolean }, _extra: unknown) => {
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
        const { fields: allFields, coOccurrences } = await otelMetricsTools.getAllMetricFields(args.search, serviceFilter, args.useSourceDocument);
        const schemas = await otelMetricsTools.getGroupedMetricSchemas(args.search);
        
        // Use a recent time range for metric type detection (last 24 hours)
        const endTime = new Date().toISOString();
        const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        // Format the output with schema information and detected metric type
        const fieldsPromises = allFields.map(async (fieldName) => {
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
          
          // Only attempt to detect metric type for numeric fields
          let metricTypeInfo = {
            metricType: 'unknown',
            isGauge: false,
            isCounter: false,
            isMonotonicCounter: false,
            isEnum: false,
            isUnknown: true
          };
          
          if (type === 'number' || type === 'float' || type === 'integer' || type === 'long' || type === 'double') {
            try {
              // Detect the metric type
              const metricType = await otelMetricsTools.detectMetricType(
                fieldName,
                startTime,
                endTime,
                serviceFilter
              );
              
              metricTypeInfo = {
                metricType: metricType,
                isGauge: metricType === 'gauge',
                isCounter: metricType === 'counter',
                isMonotonicCounter: metricType === 'monotonic_counter',
                isEnum: metricType === 'enum',
                isUnknown: metricType === 'unknown'
              };
            } catch (error) {
              logger.warn(`[MCP TOOL] Error detecting metric type for ${fieldName}:`, error);
            }
          }
          
          return {
            name: fieldName,
            type,
            schema,
            metricType: metricTypeInfo.metricType,
            typeInfo: metricTypeInfo,
            count: 0, // We don't have count information for metrics
            coOccurringFields: coOccurrences[fieldName] || [] // Include co-occurring fields
          };
        });
        
        // Wait for all field processing to complete
        const fields = await Promise.all(fieldsPromises);
        
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
  registerMcpTool(
    server,
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
  registerMcpTool(
    server,
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
  registerMcpTool(
    server,
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
      significancePValue: z.number().optional().describe('Significance p-value (default: 0.05) - Statistical significance level for rare value detection.'),
      rareTransitionPValue: z.number().optional().describe('Rare transition p-value (default: 0.03) - Significance level for rare transitions between values.'),
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
      significancePValue?: number,
      rareTransitionPValue?: number,
      interval?: string,
      maxResults?: number
    }) => {
      const options = {
        absoluteThreshold: args.absoluteThreshold,
        zScoreThreshold: args.zScoreThreshold,
        percentileThreshold: args.percentileThreshold,
        iqrMultiplier: args.iqrMultiplier,
        changeThreshold: args.changeThreshold,
        significancePValue: args.significancePValue,
        rareTransitionPValue: args.rareTransitionPValue,
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
  registerMcpTool(
    server,
    'spanDurationAnomaliesDetect',
    {
      timeRange: z.object({
        start: z.string().describe('Start time in ISO 8601 format'),
        end: z.string().describe('End time in ISO 8601 format')
      }).describe('Time window for analysis'),
      service: z.string().optional().describe('Filter to spans from a specific service'),
      services: z.array(z.string()).optional().describe('Filter to spans from multiple services (overrides service parameter)'),
      operation: z.string().optional().describe('Filter to a specific operation name'),
      thresholds: z.object({
        absolute: z.number().optional().describe('Minimum duration in nanoseconds (default: 1000000)'),
        zScore: z.number().optional().describe('Standard deviations from mean (default: 3)'),
        percentile: z.number().optional().describe('Percentile threshold (default: 95)'),
        iqrMultiplier: z.number().optional().describe('IQR multiplier for outlier detection (default: 1.5)'),
        significance: z.number().optional().describe('P-value for statistical tests (default: 0.05)')
      }).optional().describe('Detection sensitivity settings'),
      groupByOperation: z.boolean().optional().describe('Analyze each operation separately (default: true)'),
      maxResults: z.number().optional().describe('Maximum number of anomalies to return (default: 100)')
    },
    async (args: any) => {
      // Extract time range
      const startTime = args.timeRange?.start || args.startTime;
      const endTime = args.timeRange?.end || args.endTime;
      
      if (!startTime || !endTime) {
        throw new Error('Time range is required (either as timeRange object or startTime/endTime parameters)');
      }
      
      // Prepare options for the anomaly detection
      const options: any = {
        maxResults: args.maxResults,
        groupByOperation: args.groupByOperation
      };
      
      // Add threshold settings if specified
      if (args.thresholds) {
        if (args.thresholds.absolute) options.absoluteThreshold = args.thresholds.absolute;
        if (args.thresholds.zScore) options.zScoreThreshold = args.thresholds.zScore;
        if (args.thresholds.percentile) options.percentileThreshold = args.thresholds.percentile;
        if (args.thresholds.iqrMultiplier) options.iqrMultiplier = args.thresholds.iqrMultiplier;
        if (args.thresholds.significance) options.significancePValue = args.thresholds.significance;
      }
      
      // Add legacy threshold parameters for backward compatibility
      if (args.absoluteThreshold) options.absoluteThreshold = args.absoluteThreshold;
      if (args.zScoreThreshold) options.zScoreThreshold = args.zScoreThreshold;
      if (args.percentileThreshold) options.percentileThreshold = args.percentileThreshold;
      if (args.iqrMultiplier) options.iqrMultiplier = args.iqrMultiplier;
      if (args.significancePValue) options.significancePValue = args.significancePValue;
      
      // Determine which service parameter to use (services array takes precedence)
      const serviceParam = args.services && args.services.length > 0 ? args.services : args.service;
      
      const anomalies = await anomalyDetectionTool.detectSpanDurationAnomalies(
        startTime,
        endTime,
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
        logger.info('[MCP TOOL] spanDurationAnomaliesDetect result (grouped)', { 
          args, 
          totalAnomalies: anomalies.total_anomalies,
          serviceCount: Object.keys(anomalies.services).length
        });
      } else {
        // Flat response
        const anomalyArray = Array.isArray(anomalies) ? anomalies : [];
        logger.info('[MCP TOOL] spanDurationAnomaliesDetect result', { 
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

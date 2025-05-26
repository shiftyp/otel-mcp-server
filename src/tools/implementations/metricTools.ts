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
      service: z.string().optional().describe('Service name (optional) - Filter fields to only those present in data from this service. Use servicesGet tool to find available services.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Filter fields to only those present in data from these services. Takes precedence over service parameter if both are provided. Use servicesGet tool to find available services.'),
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
        
        // Get actual field types from Elasticsearch using the MetricsAdapter
        const metricFields = await esAdapter.listMetricFields();
        
        // Create a map of field names to their types
        const fieldTypeMap = new Map<string, string>();
        metricFields.forEach(field => {
          fieldTypeMap.set(field.name, field.type);
        });
        
        // Get co-occurring fields information
        const { fields: allFields, coOccurrences } = await otelMetricsTools.getAllMetricFields(args.search, serviceFilter, args.useSourceDocument);
        
        // Filter fields based on search term if provided
        let filteredFields = allFields.filter(fieldName => fieldTypeMap.has(fieldName));
        if (args.search && args.search.trim() !== '') {
          const searchTerm = args.search.toLowerCase();
          filteredFields = filteredFields.filter(fieldName => fieldName.toLowerCase().includes(searchTerm));
        }
        
        // Format the output with schema information
        const fieldsPromises = filteredFields.map(async (fieldName) => {
          // Get the actual datatype from Elasticsearch
          const type = fieldTypeMap.get(fieldName) || 'unknown';
          
          // Create the schema object with the actual type
          const schema = type !== 'unknown' ? { type } : {};
          
          // We no longer need to detect metric type as we're removing that information from the output
          
          return {
            name: fieldName,
            type, // This is the actual datatype from Elasticsearch
            schema, // This is the actual schema from Elasticsearch
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
      service: z.string().optional().describe('Service name (optional) - The service whose metrics to aggregate. Use servicesGet tool to find available services.')
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
      service: z.string().optional().describe('Service name (optional) - The service whose metrics to analyze. If not provided, metrics from all services will be included unless services array is specified. Use servicesGet tool to find available services.'),
      services: z.array(z.string()).optional().describe('Services array (optional) - Multiple services whose metrics to analyze. Takes precedence over service parameter if both are provided. Use servicesGet tool to find available services.'),
      metricField: z.string().describe('Metric field - The specific metric field to analyze. Use searchMetricsFields to get a list of available fields and their schemas.'),
      metricType: z.enum(['gauge', 'counter', 'monotonic_counter', 'enum', 'unknown']).describe('Metric type - The type of metric to use for anomaly detection. Determines which algorithms to apply.'),
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
      metricField: string, 
      metricType: 'gauge' | 'counter' | 'monotonic_counter' | 'enum' | 'unknown',
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
      
      // Convert string metric type to enum value (now required)
      const { MetricType } = await import('../../tools/otelMetrics.js');
      let metricTypeEnum;
      switch (args.metricType) {
        case 'gauge': metricTypeEnum = MetricType.GAUGE; break;
        case 'counter': metricTypeEnum = MetricType.COUNTER; break;
        case 'monotonic_counter': metricTypeEnum = MetricType.MONOTONIC_COUNTER; break;
        case 'enum': metricTypeEnum = MetricType.ENUM; break;
        default: metricTypeEnum = MetricType.UNKNOWN; break;
      }
      
      let result = await anomalyDetectionTool.detectMetricAnomalies(
        args.startTime,
        args.endTime,
        args.metricField,
        metricTypeEnum,
        serviceParam,
        options
      );
      
      // Handle the case where the result is an array of field names instead of anomalies
      if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') {
        logger.info('[MCP TOOL] detectMetricAnomalies returned field names, processing fields', { fieldCount: result.length });
        
        // Process up to 5 fields to avoid excessive processing
        const fieldsToProcess = result.slice(0, 5);
        const allAnomalies: any[] = [];
        const fieldResults: any = {};
        
        for (const field of fieldsToProcess) {
          try {
            logger.info(`[MCP TOOL] Processing field: ${field}`);
            const fieldResult = await anomalyDetectionTool.detectMetricAnomalies(
              args.startTime,
              args.endTime,
              field,
              metricTypeEnum,
              serviceParam,
              options
            );
            
            if (fieldResult.anomalies && fieldResult.anomalies.length > 0) {
              allAnomalies.push(...fieldResult.anomalies);
              fieldResults[field] = {
                anomalyCount: fieldResult.anomalies.length,
                metricType: fieldResult.metricType
              };
            }
          } catch (error) {
            logger.error(`[MCP TOOL] Error processing field: ${field}`, { error });
          }
        }
        
        // Sort all anomalies by deviation (descending) and limit to maxResults
        const maxResults = args.maxResults || 100;
        const sortedAnomalies = allAnomalies
          .sort((a, b) => (b.deviation || 0) - (a.deviation || 0))
          .slice(0, maxResults);
        
        result = {
          anomalies: sortedAnomalies,
          processedFields: fieldResults,
          potentialFields: result
        };
      }
      
      const output: MCPToolOutput = {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
      };
      
      // Handle different response formats for logging
      if (result && typeof result === 'object') {
        if ('grouped_by_service' in result) {
          // Grouped response
          logger.info('[MCP TOOL] detectMetricAnomalies result (grouped)', { 
            args, 
            totalAnomalies: result.total_anomalies,
            serviceCount: Object.keys(result.services).length
          });
        } else if ('anomalies' in result) {
          // Anomalies response
          logger.info('[MCP TOOL] detectMetricAnomalies result', { 
            args, 
            anomalyCount: result.anomalies?.length || 0,
            processedFields: Object.keys(result.processedFields || {})
          });
        } else {
          // Other object response
          logger.info('[MCP TOOL] detectMetricAnomalies result', { 
            args, 
            resultType: 'object',
            keys: Object.keys(result)
          });
        }
      } else if (Array.isArray(result)) {
        // Array response
        logger.info('[MCP TOOL] detectMetricAnomalies result', { 
          args, 
          resultType: 'array',
          length: result.length
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
      service: z.string().optional().describe('Filter to spans from a specific service. Use servicesGet tool to find available services.'),
      services: z.array(z.string()).optional().describe('Filter to spans from multiple services (overrides service parameter). Use servicesGet tool to find available services.'),
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

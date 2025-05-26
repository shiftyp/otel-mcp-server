import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { groupMetricSchemasByMetricName, GroupedMetricSchemas, getAllMetricFieldPaths, getMetricSchemasWithFields } from '../../adapters/schemas/metricSchemas.js';
import { logger } from '../../utils/logger.js';

// Define a type for the callEsRequest function
type EsRequestFunction = (method: string, url: string, body?: any) => Promise<any>;

/**
 * Enum representing different types of metrics
 */
export enum MetricType {
  GAUGE = 'gauge',
  COUNTER = 'counter',
  MONOTONIC_COUNTER = 'monotonic_counter',
  ENUM = 'enum',
  UNKNOWN = 'unknown'
}

/**
 * Tools for querying and aggregating OTEL metrics.
 */
export class MetricFieldsTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * List all available metric fields with their types
   * @returns Array of metric field information
   */
  async listMetricFields() {
    try {
      logger.debug('[OtelMetricsTools] listMetricFields called');
      
      // Get all metric fields from Elasticsearch
      const metricFields = await this.esAdapter.listMetricFields();
      
      // Sort fields by name
      metricFields.sort((a, b) => a.name.localeCompare(b.name));
      
      logger.debug('[OtelMetricsTools] listMetricFields result', { 
        fieldCount: metricFields.length,
        sampleFields: metricFields.slice(0, 5)
      });
      
      return metricFields;
    } catch (error) {
      logger.error('[OtelMetricsTools] listMetricFields error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get metric schemas grouped by metric name
   * @returns Grouped metric schemas
   */
  async getMetricSchemas(): Promise<GroupedMetricSchemas> {
    try {
      logger.debug('[OtelMetricsTools] getMetricSchemas called');
      
      // Get all metric fields from Elasticsearch
      const metricFields = await this.esAdapter.listMetricFields();
      
      // Get metric schemas with fields
      const metricSchemas = await getMetricSchemasWithFields(this.esAdapter as unknown as EsRequestFunction);
      
      // Group schemas by metric name
      // Using any type assertion to fix type error
      const groupedSchemas = groupMetricSchemasByMetricName(metricSchemas as any);
      
      logger.debug('[OtelMetricsTools] getMetricSchemas result', { 
        metricCount: Object.keys(groupedSchemas).length,
        sampleMetrics: Object.keys(groupedSchemas).slice(0, 5)
      });
      
      return groupedSchemas;
    } catch (error) {
      logger.error('[OtelMetricsTools] getMetricSchemas error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Get all field paths for metrics
   * @returns Array of field paths
   */
  async getAllMetricFieldPaths(): Promise<string[]> {
    try {
      logger.debug('[OtelMetricsTools] getAllMetricFieldPaths called');
      
      // Get all metric field paths
      const fieldPaths = await getAllMetricFieldPaths(this.esAdapter as unknown as EsRequestFunction);
      
      logger.debug('[OtelMetricsTools] getAllMetricFieldPaths result', { 
        fieldCount: fieldPaths.length,
        sampleFields: fieldPaths.slice(0, 5)
      });
      
      return fieldPaths;
    } catch (error) {
      logger.error('[OtelMetricsTools] getAllMetricFieldPaths error', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}

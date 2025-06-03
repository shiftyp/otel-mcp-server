import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

/**
 * Zod schema for metric anomaly detection arguments
 */
const MetricAnomaliesDetectSchema = {
  from: z.string().describe('Start time (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time (ISO 8601 format or relative like "now")'),
  metricName: z.string().describe('Name of the metric to analyze'),
  service: z.string().optional().describe('Service name to filter results (optional)'),
  aggregation: z.enum(['avg', 'max', 'min', 'sum']).optional().describe('Aggregation method for metric values'),
  sensitivity: z.number().min(0).max(1).optional().describe('Statistical confidence level 0-1 (default: 0.95)')
};

type MetricAnomaliesDetectArgs = MCPToolSchema<typeof MetricAnomaliesDetectSchema>;

/**
 * Tool for detecting metric anomalies
 */
export class MetricAnomaliesDetectTool extends BaseTool<typeof MetricAnomaliesDetectSchema> {
  // Static schema property
  static readonly schema = MetricAnomaliesDetectSchema;

  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'detectMetricAnomalies',
      category: ToolCategory.ANALYSIS,
      description: 'Detect metric anomalies using statistical methods or ML to identify performance degradation',
      requiredCapabilities: []
    });
  }

  protected getSchema() {
    return MetricAnomaliesDetectSchema;
  }

  protected async executeImpl(args: MetricAnomaliesDetectArgs): Promise<any> {
    const config = ConfigLoader.get();
    const capabilities = this.adapter.getCapabilities();

    // Use ML-based anomaly detection if available
    if (capabilities.ml.anomalyDetection) {
      try {
        const result = await this.adapter.detectAnomalies(
          config.telemetry.indices.metrics,
          {
            field: args.metricName,
            method: 'zscore',
            threshold: 1 - (args.sensitivity || 0.95)
          },
          { from: args.from, to: args.to }
        );

        return this.formatJsonOutput({
          method: 'ml-based',
          anomalies: result,
          summary: {
            totalAnomalies: result.length,
            metrics: [...new Set(result.map((a: any) => a.field))]
          }
        });
      } catch (error) {
        // Fall back to statistical method
      }
    }

    // Statistical anomaly detection fallback
    const query = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: { gte: args.from, lte: args.to } } }
        ],
        filter: [] as any[]
      }
    };

    if (args.service) {
      query.bool.filter.push({ term: { [config.telemetry.fields.service]: args.service } });
    }

    // Get time series data
    const result = await this.adapter.query(
      config.telemetry.indices.metrics,
      query,
      {
        size: 0,
        aggregations: {
          time_series: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m'
            },
            aggs: {
              metric_value: {
                [args.aggregation || 'avg']: {
                  field: args.metricName
                }
              }
            }
          }
        }
      }
    );

    const buckets = result.aggregations?.time_series?.buckets || [];
    const values = buckets.map((b: any) => b.metric_value?.value || 0);

    // Calculate statistics
    const mean = values.reduce((sum: number, v: number) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(
      values.reduce((sum: number, v: number) => sum + Math.pow(v - mean, 2), 0) / values.length
    );

    // Detect anomalies (values outside 2 standard deviations)
    const sensitivity = args.sensitivity || 0.95;
    const threshold = stdDev * (1 + (1 - sensitivity) * 3); // Scale threshold based on sensitivity

    const anomalies = buckets
      .map((bucket: any, index: number) => ({
        timestamp: bucket.key_as_string,
        value: bucket.metric_value?.value || 0,
        deviation: Math.abs((bucket.metric_value?.value || 0) - mean) / stdDev,
        index
      }))
      .filter((point: any) => Math.abs(point.value - mean) > threshold)
      .map((point: any) => ({
        timestamp: point.timestamp,
        metric: args.metricName,
        value: point.value,
        expectedValue: mean,
        deviation: point.deviation,
        anomalyScore: Math.min(point.deviation / 3, 1) // Normalize to 0-1
      }));

    return this.formatJsonOutput({
      method: 'statistical',
      anomalies,
      statistics: {
        mean,
        stdDev,
        threshold,
        totalDataPoints: values.length,
        anomalyRate: anomalies.length / values.length
      },
      summary: {
        totalAnomalies: anomalies.length,
        metrics: [args.metricName]
      }
    });
  }
}
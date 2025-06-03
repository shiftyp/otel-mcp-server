import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { MCPToolSchema } from '../../../types.js';

/**
 * Zod schema for log anomaly detection arguments
 */
const LogAnomaliesDetectSchema = {
  from: z.string().describe('Start time (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time (ISO 8601 format or relative like "now")'),
  service: z.string().optional().describe('Service name to filter results (optional)'),
  level: z.string().optional().describe('Log level to filter (e.g., error, warning)'),
  field: z.string().optional().describe('Field to analyze for anomalies (default: message)'),
  minCount: z.number().min(1).optional().describe('Minimum occurrences required (default: 2)'),
  maxResults: z.number().min(1).max(100).optional().describe('Maximum number of results to return (default: 20)')
};

type LogAnomaliesDetectArgs = MCPToolSchema<typeof LogAnomaliesDetectSchema>;

/**
 * Tool for detecting log anomalies
 */
export class LogAnomaliesDetectTool extends BaseTool<typeof LogAnomaliesDetectSchema> {
  // Static schema property
  static readonly schema = LogAnomaliesDetectSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'detectLogAnomalies',
      category: ToolCategory.ANALYSIS,
      description: 'Detect unusual log patterns and volume spikes using statistical analysis to identify system issues',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return LogAnomaliesDetectSchema;
  }
  
  protected async executeImpl(args: LogAnomaliesDetectArgs): Promise<any> {
    const config = ConfigLoader.get();
    const capabilities = this.adapter.getCapabilities();
    
    // Use ML-based anomaly detection if available
    if (capabilities.ml.anomalyDetection) {
      try {
        const anomalyResults = await this.adapter.detectAnomalies(
          config.telemetry.indices.logs,
          {
            field: args.field || 'message',
            method: 'zscore',
            threshold: 2.5
          },
          { from: args.from, to: args.to }
        );
        
        return this.formatJsonOutput({
          method: 'ml-based',
          anomalies: anomalyResults,
          summary: {
            totalAnomalies: anomalyResults.length,
            fields: [...new Set(anomalyResults.map(a => a.field))]
          }
        });
      } catch (error) {
        // Fall back to statistical method
        logger.debug('ML anomaly detection failed, falling back to statistical method', { error });
      }
    }
    
    // Statistical anomaly detection fallback
    const patternResults = await this.adapter.analyzeLogPatterns(
      {
        field: args.field || 'message',
        minSupport: 0.001 // Very low support to find rare patterns
      },
      { from: args.from, to: args.to }
    );
    
    // Identify rare patterns (anomalies)
    const totalLogs = patternResults.reduce((sum, p) => sum + p.count, 0);
    const anomalies = patternResults
      .filter(p => p.frequency < 0.001) // Less than 0.1% occurrence
      .slice(0, args.maxResults || 20);
    
    // Check for volume spikes
    const volumeQuery = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: {
            gte: args.from,
            lte: args.to
          } } }
        ],
        filter: [] as any[]
      }
    };
    
    if (args.service) {
      volumeQuery.bool.filter.push({ term: { [config.telemetry.fields.service]: args.service } });
    }
    
    if (args.level) {
      volumeQuery.bool.filter.push({ term: { level: args.level } });
    }
    
    const volumeResult = await this.adapter.query(
      config.telemetry.indices.logs,
      volumeQuery,
      {
        size: 0,
        aggregations: {
          volume_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              by_level: {
                terms: {
                  field: 'level',
                  size: 10
                }
              }
            }
          }
        }
      }
    );
    
    const volumeBuckets = volumeResult.aggregations?.volume_over_time?.buckets || [];
    const avgVolume = volumeBuckets.reduce((sum: number, b: any) => sum + b.doc_count, 0) / Math.max(volumeBuckets.length, 1);
    
    const volumeSpikes = volumeBuckets
      .filter((b: any) => b.doc_count > avgVolume * 2) // 2x average = spike
      .map((b: any) => ({
        timestamp: b.key_as_string,
        count: b.doc_count,
        levels: b.by_level?.buckets || [],
        spikeRatio: b.doc_count / avgVolume
      }));
    
    return this.formatJsonOutput({
      method: 'statistical',
      rarePatterns: anomalies,
      volumeSpikes,
      summary: {
        totalPatterns: patternResults.length,
        rarePatterns: anomalies.length,
        totalLogs,
        averageVolumePer5Min: avgVolume,
        spikesDetected: volumeSpikes.length
      }
    });
  }
}
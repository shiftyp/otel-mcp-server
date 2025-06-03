import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogField } from '../core/types.js';

/**
 * Field value statistics
 */
export interface FieldStats {
  field: string;
  type: string;
  cardinality: number;
  topValues: Array<{ value: any; count: number }>;
  hasNulls: boolean;
  nullCount?: number;
}

/**
 * Field analysis options
 */
export interface FieldAnalysisOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  sampleSize?: number;
  topValuesLimit?: number;
}

/**
 * Log field analyzer
 */
export class LogFieldAnalyzer {
  constructor(private readonly adapter: LogsCoreAdapter) {}

  /**
   * Get all available log fields
   */
  public async getFields(
    filter?: string,
    service?: string | string[]
  ): Promise<LogField[]> {
    logger.info('[LogFieldAnalyzer] Getting log fields', { filter, service });

    const fields = await this.adapter.getLogFields();
    
    // Filter by name if provided
    let filteredFields = fields;
    if (filter) {
      const pattern = filter.toLowerCase();
      filteredFields = fields.filter(f => 
        f.field.toLowerCase().includes(pattern)
      );
    }

    // If service filter is provided, check field usage
    if (service) {
      const usedFields = await this.getFieldsUsedByService(service);
      filteredFields = filteredFields.filter(f => 
        usedFields.includes(f.field)
      );
    }

    return filteredFields;
  }

  /**
   * Analyze field statistics
   */
  public async analyzeField(
    fieldName: string,
    options: FieldAnalysisOptions = {}
  ): Promise<FieldStats> {
    logger.info('[LogFieldAnalyzer] Analyzing field', { fieldName, options });

    const query: any = {
      size: 0,
      query: { bool: { filter: [] } },
      aggs: {
        field_stats: {
          cardinality: {
            field: fieldName
          }
        },
        top_values: {
          terms: {
            field: fieldName,
            size: options.topValuesLimit || 10
          }
        },
        null_count: {
          missing: {
            field: fieldName
          }
        }
      }
    };

    // Add filters
    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    // Limit sample size for performance
    if (options.sampleSize) {
      query.size = 0; // We're using aggregations
      query.query.bool.filter.push({
        script: {
          script: {
            source: "Math.random() < params.rate",
            params: {
              rate: Math.min(options.sampleSize / 10000, 1)
            }
          }
        }
      });
    }

    const response = await this.adapter.searchLogs(query);
    const aggs = response.aggregations || {};

    // Get field type from mapping
    const fields = await this.adapter.getLogFields();
    const fieldInfo = fields.find(f => f.field === fieldName);

    return {
      field: fieldName,
      type: fieldInfo?.type || 'unknown',
      cardinality: aggs.field_stats?.value || 0,
      topValues: (aggs.top_values?.buckets || []).map((b: any) => ({
        value: b.key,
        count: b.doc_count
      })),
      hasNulls: (aggs.null_count?.doc_count || 0) > 0,
      nullCount: aggs.null_count?.doc_count
    };
  }

  /**
   * Analyze multiple fields
   */
  public async analyzeFields(
    fieldNames: string[],
    options: FieldAnalysisOptions = {}
  ): Promise<FieldStats[]> {
    const results = await Promise.all(
      fieldNames.map(field => this.analyzeField(field, options))
    );
    
    return results;
  }

  /**
   * Get fields with high cardinality
   */
  public async getHighCardinalityFields(
    threshold: number = 1000,
    options: FieldAnalysisOptions = {}
  ): Promise<FieldStats[]> {
    logger.info('[LogFieldAnalyzer] Finding high cardinality fields', { threshold });

    const fields = await this.getFields();
    const fieldStats: FieldStats[] = [];

    // Analyze fields in batches
    const batchSize = 10;
    for (let i = 0; i < fields.length; i += batchSize) {
      const batch = fields.slice(i, i + batchSize);
      const batchStats = await Promise.all(
        batch.map(f => this.analyzeField(f.field, options))
      );
      
      fieldStats.push(...batchStats.filter(s => s.cardinality > threshold));
    }

    return fieldStats.sort((a, b) => b.cardinality - a.cardinality);
  }

  /**
   * Suggest fields for grouping/aggregation
   */
  public async suggestGroupingFields(
    options: FieldAnalysisOptions = {}
  ): Promise<Array<{ field: string; reason: string; cardinality: number }>> {
    logger.info('[LogFieldAnalyzer] Suggesting grouping fields');

    const fields = await this.getFields();
    const suggestions: Array<{ field: string; reason: string; cardinality: number }> = [];

    // Analyze categorical fields
    const categoricalFields = fields.filter(f => 
      f.type === 'keyword' || 
      f.field.includes('level') ||
      f.field.includes('status') ||
      f.field.includes('type') ||
      f.field.includes('category')
    );

    for (const field of categoricalFields) {
      const stats = await this.analyzeField(field.field, options);
      
      if (stats.cardinality > 1 && stats.cardinality < 100) {
        suggestions.push({
          field: field.field,
          reason: `Good cardinality for grouping (${stats.cardinality} unique values)`,
          cardinality: stats.cardinality
        });
      }
    }

    return suggestions.sort((a, b) => a.cardinality - b.cardinality);
  }

  /**
   * Get fields used by a specific service
   */
  private async getFieldsUsedByService(
    service: string | string[]
  ): Promise<string[]> {
    const services = Array.isArray(service) ? service : [service];
    
    // Sample logs from the service
    const query = {
      size: 100,
      query: {
        terms: { 'service.name': services }
      }
    };

    const response = await this.adapter.searchLogs(query);
    const usedFields = new Set<string>();

    // Extract all field paths from the sample
    for (const hit of response.hits?.hits || []) {
      this.extractFieldPaths(hit._source, '', usedFields);
    }

    return Array.from(usedFields);
  }

  /**
   * Extract all field paths from an object
   */
  private extractFieldPaths(
    obj: any,
    prefix: string,
    fields: Set<string>
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      fields.add(fieldPath);
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.extractFieldPaths(value, fieldPath, fields);
      }
    }
  }
}
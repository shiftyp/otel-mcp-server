import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for metric field discovery and management
 */
export class MetricFieldsModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * List all metric fields and their types from metrics indices, filtering out metadata fields.
   * @returns Array of { name, type }
   */
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    logger.info('[ES Adapter] listMetricFields called');
    
    // Use a comprehensive pattern to match all possible metrics indices
    logger.info('[ES Adapter] About to request metrics mapping');
    const resp = await this.esCore.callEsRequest('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping').catch(err => {
      logger.warn('[ES Adapter] Error getting metrics mapping', { error: err.message, stack: err.stack });
      return {};
    });
    
    logger.info('[ES Adapter] Got metrics mapping response', { 
      responseKeys: Object.keys(resp),
      responseSize: JSON.stringify(resp).length
    });
    
    // If no indices were found, return an empty array
    if (Object.keys(resp).length === 0) {
      logger.info('[ES Adapter] No metrics indices found, returning empty array');
      return [];
    }
    
    // Use a minimal ignoreFields set for metrics
    const ignoreFields = new Set([
      '_id', '_index', '_score', '_source', '_type', '_version'
    ]);
    
    // Process the mapping to extract field information
    const fields: Array<{ name: string, type: string }> = [];
    const fieldTypes: Record<string, string> = {};
    
    // Iterate through each index
    for (const indexName of Object.keys(resp)) {
      const indexMapping = resp[indexName].mappings;
      
      // Process properties if they exist
      if (indexMapping.properties) {
        this.processProperties(indexMapping.properties, '', fieldTypes, ignoreFields);
      }
      
      // Process runtime fields if they exist
      if (indexMapping.runtime) {
        this.processRuntimeFields(indexMapping.runtime, fieldTypes);
      }
    }
    
    // Convert the collected data into the result format
    for (const fieldName of Object.keys(fieldTypes)) {
      fields.push({
        name: fieldName,
        type: fieldTypes[fieldName]
      });
    }
    
    // Sort fields by name for consistency
    fields.sort((a, b) => a.name.localeCompare(b.name));
    
    logger.info('[ES Adapter] Returning metric fields', { count: fields.length });
    return fields;
  }

  /**
   * Process properties from Elasticsearch mapping
   * @param properties Properties object from mapping
   * @param prefix Current field name prefix
   * @param fieldTypes Object to track field types
   * @param ignoreFields Set of fields to ignore
   */
  private processProperties(
    properties: Record<string, any>,
    prefix: string,
    fieldTypes: Record<string, string>,
    ignoreFields: Set<string>
  ): void {
    for (const propName of Object.keys(properties)) {
      const property = properties[propName];
      const fieldName = prefix ? `${prefix}.${propName}` : propName;
      
      // Skip ignored fields
      if (ignoreFields.has(fieldName)) {
        continue;
      }
      
      // Determine the field type
      if (property.type) {
        fieldTypes[fieldName] = property.type;
      }
      
      // Recursively process nested properties
      if (property.properties) {
        this.processProperties(property.properties, fieldName, fieldTypes, ignoreFields);
      }
      
      // Handle special case for fields with multiple types
      if (property.fields) {
        this.processProperties(property.fields, fieldName, fieldTypes, ignoreFields);
      }
    }
  }

  /**
   * Process runtime fields from Elasticsearch mapping
   * @param runtimeFields Runtime fields object from mapping
   * @param fieldTypes Object to track field types
   */
  private processRuntimeFields(
    runtimeFields: Record<string, any>,
    fieldTypes: Record<string, string>
  ): void {
    for (const fieldName of Object.keys(runtimeFields)) {
      const runtimeField = runtimeFields[fieldName];
      
      // Determine the field type
      if (runtimeField.type) {
        fieldTypes[fieldName] = `runtime_${runtimeField.type}`;
      }
    }
  }
}

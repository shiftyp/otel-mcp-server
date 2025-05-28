import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Module for log field discovery and management
 */
export class LogFieldsModule {
  private esCore: ElasticsearchCore;

  constructor(esCore: ElasticsearchCore) {
    this.esCore = esCore;
  }

  /**
   * List all log fields and their types from logs indices
   * @param includeSourceDocument Whether to include fields from the _source document
   * @returns Array of { name, type, count, schema }
   */
  public async listLogFields(includeSourceDocument: boolean = true): Promise<Array<{ name: string, type: string, count: number, schema: any }>> {
    logger.info('[ES Adapter] listLogFields called', { includeSourceDocument });
    
    // Use a comprehensive pattern to match all possible logs indices
    logger.info('[ES Adapter] About to request logs mapping');
    const resp = await this.esCore.callEsRequest('GET', '/.ds-logs-*,logs*,*logs*,otel-logs*/_mapping').catch(err => {
      logger.warn('[ES Adapter] Error getting logs mapping', { error: err.message, stack: err.stack });
      return {};
    });
    
    logger.info('[ES Adapter] Got logs mapping response', { 
      responseKeys: Object.keys(resp),
      responseSize: JSON.stringify(resp).length
    });
    
    // If no indices were found, return an empty array
    if (Object.keys(resp).length === 0) {
      logger.info('[ES Adapter] No logs indices found, returning empty array');
      return [];
    }
    
    // Process the mapping to extract field information
    const fields: Array<{ name: string, type: string, count: number, schema: any }> = [];
    const fieldCounts: Record<string, number> = {};
    const fieldTypes: Record<string, string> = {};
    const fieldSchemas: Record<string, any> = {};
    
    // Iterate through each index
    for (const indexName of Object.keys(resp)) {
      const indexMapping = resp[indexName].mappings;
      
      // Process properties if they exist
      if (indexMapping.properties) {
        this.processProperties(indexMapping.properties, '', fieldCounts, fieldTypes, fieldSchemas);
      }
      
      // Process runtime fields if they exist
      if (indexMapping.runtime) {
        this.processRuntimeFields(indexMapping.runtime, fieldCounts, fieldTypes, fieldSchemas);
      }
      
      // Process _source fields if requested
      if (includeSourceDocument && indexMapping._source) {
        this.processSourceFields(indexMapping._source, fieldCounts, fieldTypes, fieldSchemas);
      }
    }
    
    // Convert the collected data into the result format
    for (const fieldName of Object.keys(fieldCounts)) {
      fields.push({
        name: fieldName,
        type: fieldTypes[fieldName] || 'unknown',
        count: fieldCounts[fieldName] || 0,
        schema: fieldSchemas[fieldName] || {}
      });
    }
    
    // Sort fields by name for consistency
    fields.sort((a, b) => a.name.localeCompare(b.name));
    
    logger.info('[ES Adapter] Returning log fields', { count: fields.length });
    return fields;
  }

  /**
   * Process properties from Elasticsearch mapping
   * @param properties Properties object from mapping
   * @param prefix Current field name prefix
   * @param fieldCounts Object to track field counts
   * @param fieldTypes Object to track field types
   * @param fieldSchemas Object to track field schemas
   */
  private processProperties(
    properties: Record<string, any>,
    prefix: string,
    fieldCounts: Record<string, number>,
    fieldTypes: Record<string, string>,
    fieldSchemas: Record<string, any>
  ): void {
    for (const propName of Object.keys(properties)) {
      const property = properties[propName];
      const fieldName = prefix ? `${prefix}.${propName}` : propName;
      
      // Track this field
      fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
      
      // Determine the field type
      if (property.type) {
        fieldTypes[fieldName] = property.type;
        fieldSchemas[fieldName] = { ...property };
      }
      
      // Recursively process nested properties
      if (property.properties) {
        this.processProperties(property.properties, fieldName, fieldCounts, fieldTypes, fieldSchemas);
      }
      
      // Handle special case for fields with multiple types
      if (property.fields) {
        this.processProperties(property.fields, fieldName, fieldCounts, fieldTypes, fieldSchemas);
      }
    }
  }

  /**
   * Process runtime fields from Elasticsearch mapping
   * @param runtimeFields Runtime fields object from mapping
   * @param fieldCounts Object to track field counts
   * @param fieldTypes Object to track field types
   * @param fieldSchemas Object to track field schemas
   */
  private processRuntimeFields(
    runtimeFields: Record<string, any>,
    fieldCounts: Record<string, number>,
    fieldTypes: Record<string, string>,
    fieldSchemas: Record<string, any>
  ): void {
    for (const fieldName of Object.keys(runtimeFields)) {
      const runtimeField = runtimeFields[fieldName];
      
      // Track this field
      fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
      
      // Determine the field type
      if (runtimeField.type) {
        fieldTypes[fieldName] = `runtime_${runtimeField.type}`;
        fieldSchemas[fieldName] = { ...runtimeField, runtime: true };
      }
    }
  }

  /**
   * Process _source fields from Elasticsearch mapping
   * @param sourceFields Source fields object from mapping
   * @param fieldCounts Object to track field counts
   * @param fieldTypes Object to track field types
   * @param fieldSchemas Object to track field schemas
   */
  private processSourceFields(
    sourceFields: Record<string, any>,
    fieldCounts: Record<string, number>,
    fieldTypes: Record<string, string>,
    fieldSchemas: Record<string, any>
  ): void {
    // Add _source field
    fieldCounts['_source'] = (fieldCounts['_source'] || 0) + 1;
    fieldTypes['_source'] = 'object';
    fieldSchemas['_source'] = { type: 'object' };
    
    // Add other metadata fields if they exist
    const metaFields = ['_id', '_index', '_score', '_type'];
    for (const metaField of metaFields) {
      fieldCounts[metaField] = (fieldCounts[metaField] || 0) + 1;
      fieldTypes[metaField] = 'keyword';
      fieldSchemas[metaField] = { type: 'keyword', meta: true };
    }
  }
}

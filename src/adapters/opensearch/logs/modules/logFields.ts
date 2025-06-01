import { LogCore } from './logCore.js';
import { logger } from '../../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../../utils/errorHandling.js';

/**
 * Field management functionality for the OpenSearch Logs Adapter
 */
export class LogFields extends LogCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * List available log fields
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(includeSourceDoc?: boolean): Promise<any[] | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogFields] listLogFields called');
      
      const index = this.getLogsIndexPattern();
      logger.info(`[OpenSearch LogFields] Using index pattern: ${index}`);
      
      // First try to get a sample document to extract fields
      const sampleQuery = {
        size: 1,
        query: { match_all: {} }
      };
      
      logger.info(`[OpenSearch LogFields] Executing sample query: ${JSON.stringify(sampleQuery)}`);
      const sampleResult = await this.callRequest('POST', `/${index}/_search`, sampleQuery);
      logger.info(`[OpenSearch LogFields] Sample query result: ${JSON.stringify(sampleResult).substring(0, 200)}...`);
      
      if (sampleResult?.hits?.hits?.length > 0) {
        logger.info('[OpenSearch LogFields] Found sample document, extracting fields');
        const sampleDoc = sampleResult.hits.hits[0]._source;
        logger.info(`[OpenSearch LogFields] Sample document keys: ${Object.keys(sampleDoc).join(', ')}`);
        const fields = this.extractFieldsFromSampleDocument(sampleDoc);
        logger.info(`[OpenSearch LogFields] Extracted ${fields.length} fields from sample document`);
        
        // Sort fields by name
        fields.sort((a, b) => a.name.localeCompare(b.name));
        
        return fields;
      }
      
      // If no sample document, fall back to mappings
      logger.info('[OpenSearch LogFields] No sample document found, trying mappings');
      const result = await this.callRequest('GET', `/${index}/_mapping`, null);
      logger.info(`[OpenSearch LogFields] Mapping result keys: ${result ? Object.keys(result).join(', ') : 'null or undefined'}`);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        logger.error(`[OpenSearch LogFields] Error getting mappings: ${errorMessage}`);
        return createErrorResponse(`Error listing log fields: ${errorMessage}`);
      }
      
      // Extract fields from mappings
      const fields: any[] = [];
      const processedFields = new Set<string>();
      
      // Process each index
      Object.keys(result).forEach(indexName => {
        logger.info(`[OpenSearch LogFields] Processing index: ${indexName}`);
        logger.info(`[OpenSearch LogFields] Index structure: ${JSON.stringify(Object.keys(result[indexName]))}`);
        
        if (result[indexName].mappings) {
          logger.info(`[OpenSearch LogFields] Mappings structure: ${JSON.stringify(Object.keys(result[indexName].mappings))}`);
        }
        
        // Pass the entire index object to extractFields
        // The extractFields method will handle the different mapping structures
        this.extractFields(result[indexName], '', fields, processedFields, includeSourceDoc);
      });
      
      logger.info(`[OpenSearch LogFields] Extracted ${fields.length} fields from mappings`);
      
      // Sort fields by name
      fields.sort((a, b) => a.name.localeCompare(b.name));
      
      return fields;
    } catch (error) {
      return createErrorResponse(`Error listing log fields: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get log fields with optional search filter
   * @param search Optional search term to filter fields
   */
  public async getLogFields(search?: string): Promise<any[] | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogFields] getLogFields called', { search });
      
      // Get all fields
      const allFields = await this.listLogFields(true);
      
      if (isErrorResponse(allFields)) {
        return allFields;
      }
      
      // Filter fields by search term if provided
      if (search && search.trim() !== '') {
        const normalizedSearch = search.toLowerCase().trim();
        return allFields.filter(field => 
          field.name.toLowerCase().includes(normalizedSearch)
        );
      }
      
      return allFields;
    } catch (error) {
      return createErrorResponse(`Error getting log fields: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Extract fields from a sample document
   * @param doc The sample document to extract fields from
   * @returns Array of field objects with name and type
   */
  private extractFieldsFromSampleDocument(doc: Record<string, any>): Array<{name: string, type: string}> {
    const fields: Array<{name: string, type: string}> = [];
    const processedFields = new Set<string>();
    
    // Recursively extract fields from the document
    this.extractFieldsFromObject(doc, '', fields, processedFields);
    
    return fields;
  }
  
  /**
   * Recursively extract fields from an object
   * @param obj The object to extract fields from
   * @param prefix The prefix for the field name
   * @param fields Array to store extracted fields
   * @param processedFields Set to track processed fields
   */
  private extractFieldsFromObject(
    obj: Record<string, any>,
    prefix: string,
    fields: Array<{name: string, type: string}>,
    processedFields: Set<string>
  ): void {
    Object.entries(obj).forEach(([key, value]) => {
      const fieldName = prefix ? `${prefix}.${key}` : key;
      
      // Skip already processed fields
      if (processedFields.has(fieldName)) {
        return;
      }
      
      processedFields.add(fieldName);
      
      // Determine OpenSearch field type based on JavaScript type
      let fieldType: string;
      
      if (value === null) {
        fieldType = 'null';
      } else if (Array.isArray(value)) {
        fieldType = 'array';
        // Check first element for array type if available
        if (value.length > 0) {
          const firstElement = value[0];
          if (typeof firstElement === 'object' && firstElement !== null) {
            // Process array of objects
            this.extractFieldsFromObject(firstElement, fieldName, fields, processedFields);
          }
        }
      } else if (typeof value === 'object') {
        // For objects, add the field and recursively process its properties
        fields.push({
          name: fieldName,
          type: 'object'
        });
        
        this.extractFieldsFromObject(value, fieldName, fields, processedFields);
        return; // Skip adding the field again
      } else if (typeof value === 'number') {
        // Differentiate between integer and float
        fieldType = Number.isInteger(value) ? 'long' : 'float';
      } else if (typeof value === 'string') {
        // Check if it's a date
        if (!isNaN(Date.parse(value)) && value.includes('T')) {
          fieldType = 'date';
        } else {
          fieldType = 'text';
        }
      } else if (typeof value === 'boolean') {
        fieldType = 'boolean';
      } else {
        // Default to string for other types
        fieldType = 'keyword';
      }
      
      // Add the field
      fields.push({
        name: fieldName,
        type: fieldType
      });
    });
  }
  
  /**
   * Extract fields recursively from mappings
   */
  private extractFields(
    properties: any,
    prefix: string,
    fields: any[],
    processedFields: Set<string>,
    includeSourceDoc?: boolean
  ): void {
    logger.info(`[OpenSearch LogFields] extractFields called with prefix: ${prefix}`);
    logger.info(`[OpenSearch LogFields] properties type: ${typeof properties}`);
    
    if (!properties || typeof properties !== 'object') {
      logger.warn(`[OpenSearch LogFields] Invalid properties object: ${properties}`);
      return;
    }
    
    // Handle the case where the mappings structure is different
    // In OpenSearch, the mappings structure is: index -> mappings -> properties -> field properties
    if (properties.mappings && properties.mappings.properties) {
      logger.info('[OpenSearch LogFields] Found mappings.properties structure, recursing');
      this.extractFields(properties.mappings.properties, prefix, fields, processedFields, includeSourceDoc);
      return;
    }

    Object.keys(properties).forEach(fieldName => {
      const fieldInfo = properties[fieldName];
      const fullName = prefix ? `${prefix}.${fieldName}` : fieldName;
      
      // Skip already processed fields
      if (processedFields.has(fullName)) {
        return;
      }
      
      // Skip source document fields if not requested
      if (!includeSourceDoc && fullName.startsWith('_source')) {
        return;
      }
      
      processedFields.add(fullName);
      
      // Add field to the list
      if (fieldInfo.type) {
        fields.push({
          name: fullName,
          type: fieldInfo.type
        });
      }
      
      // Process nested properties recursively
      if (fieldInfo.properties) {
        this.extractFields(fieldInfo.properties, fullName, fields, processedFields, includeSourceDoc);
      }
      
      // Process nested fields for object type
      if (fieldInfo.fields) {
        Object.keys(fieldInfo.fields).forEach(nestedField => {
          const nestedFieldInfo = fieldInfo.fields[nestedField];
          const nestedFullName = `${fullName}.${nestedField}`;
          
          if (!processedFields.has(nestedFullName) && nestedFieldInfo.type) {
            processedFields.add(nestedFullName);
            fields.push({
              name: nestedFullName,
              type: nestedFieldInfo.type
            });
          }
        });
      }
    });
  }
}

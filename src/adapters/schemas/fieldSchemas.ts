import { BaseSearchAdapter } from '../base/searchAdapter.js';
import { logger } from '../../utils/logger.js';

/**
 * Interface for field information
 */
export interface FieldInfo {
  name: string;
  type: string;
  path: string;
  count: number;
  schema: any; // Complete schema object
  coOccurringFields?: string[];
}

/**
 * Get field mappings for a specific index pattern
 */
export async function getFieldMappings(
  searchAdapter: BaseSearchAdapter,
  indexPattern: string
): Promise<Record<string, { type: string; path: string; schema: any }>> {
  try {
    logger.info('[FieldSchemas] Getting field mappings', { indexPattern });
    const response = await searchAdapter.callApi('GET', `/${indexPattern}/_mapping`);
    
    // Process the mapping response to extract field information
    const fields: Record<string, { type: string; path: string; schema: any }> = {};
    
    // Iterate through each index
    for (const indexName of Object.keys(response)) {
      const mappings = response[indexName].mappings;
      const properties = mappings.properties || {};
      
      // Process each property recursively
      processProperties(properties, '', fields);
    }
    
    logger.info('[FieldSchemas] Field mappings retrieved', { 
      indexPattern, 
      fieldCount: Object.keys(fields).length 
    });
    
    return fields;
  } catch (error) {
    logger.error('[FieldSchemas] Error getting field mappings', { 
      indexPattern, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return {};
  }
}

/**
 * Process mapping properties recursively
 */
function processProperties(
  properties: any,
  path: string,
  result: Record<string, { type: string; path: string; schema: any }>
): void {
  for (const [fieldName, fieldInfo] of Object.entries<any>(properties)) {
    const fieldPath = path ? `${path}.${fieldName}` : fieldName;
    
    if (fieldInfo.type) {
      // This is a leaf field
      result[fieldPath] = {
        type: fieldInfo.type,
        path: fieldPath,
        schema: { ...fieldInfo } // Include the complete schema object
      };
      
      // Check for keyword sub-fields
      if (fieldInfo.fields) {
        for (const [subFieldName, subFieldInfo] of Object.entries<any>(fieldInfo.fields)) {
          const subFieldPath = `${fieldPath}.${subFieldName}`;
          result[subFieldPath] = {
            type: subFieldInfo.type,
            path: subFieldPath,
            schema: { ...subFieldInfo } // Include the complete schema object
          };
        }
      }
    } else if (fieldInfo.properties) {
      // This is a nested object, process its properties
      // Add the object itself as a field with its schema
      result[fieldPath] = {
        type: 'object',
        path: fieldPath,
        schema: { ...fieldInfo } // Include the complete schema object
      };
      // Process its properties
      processProperties(fieldInfo.properties, fieldPath, result);
    }
  }
}


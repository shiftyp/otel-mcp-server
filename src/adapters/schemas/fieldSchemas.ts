import { ElasticsearchAdapter } from '../elasticsearch/index.js';
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
  esClient: ElasticsearchAdapter,
  indexPattern: string
): Promise<Record<string, { type: string; path: string; schema: any }>> {
  try {
    logger.info('[FieldSchemas] Getting field mappings', { indexPattern });
    const response = await esClient.callEsRequest('GET', `/${indexPattern}/_mapping`);
    
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

/**
 * Get field statistics and co-occurring fields
 */
export async function getFieldStats(
  esClient: ElasticsearchAdapter,
  indexPattern: string,
  search?: string
): Promise<FieldInfo[]> {
  try {
    // First get the field mappings
    const fieldMappings = await getFieldMappings(esClient, indexPattern);
    
    // Filter fields by search term if provided
    let filteredFields = Object.entries(fieldMappings);
    if (search && search.trim() !== '') {
      const searchTerm = search.toLowerCase();
      filteredFields = filteredFields.filter(([fieldName]) => 
        fieldName.toLowerCase().includes(searchTerm)
      );
    }
    
    // Get field statistics and co-occurring fields
    const fieldStats: FieldInfo[] = [];
    
    for (const [fieldName, fieldInfo] of filteredFields) {
      // Get document count for this field
      const countResponse = await esClient.callEsRequest('POST', `/${indexPattern}/_search`, {
        size: 0,
        query: {
          exists: {
            field: fieldName
          }
        }
      });
      
      const count = countResponse.hits?.total?.value || 0;
      
      // Get co-occurring fields (fields that appear in the same documents)
      const coOccurringFields: string[] = [];
      
      if (count > 0) {
        // Sample a few documents with this field to find co-occurring fields
        const sampleResponse = await esClient.callEsRequest('POST', `/${indexPattern}/_search`, {
          size: 5,
          query: {
            exists: {
              field: fieldName
            }
          }
        });
        
        // Extract all fields from the sample documents
        const sampleDocs = sampleResponse.hits?.hits || [];
        for (const doc of sampleDocs) {
          const docFields = extractFieldPaths(doc._source);
          for (const docField of docFields) {
            if (docField !== fieldName && !coOccurringFields.includes(docField)) {
              coOccurringFields.push(docField);
            }
          }
        }
      }
      
      fieldStats.push({
        name: fieldName,
        type: fieldInfo.type,
        path: fieldInfo.path,
        count,
        schema: fieldInfo.schema,
        coOccurringFields: coOccurringFields.sort()
      });
    }
    
    // Sort by field name
    fieldStats.sort((a, b) => a.name.localeCompare(b.name));
    
    logger.info('[FieldSchemas] Field stats retrieved', { 
      indexPattern, 
      fieldCount: fieldStats.length 
    });
    
    return fieldStats;
  } catch (error) {
    logger.error('[FieldSchemas] Error getting field stats', { 
      indexPattern, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return [];
  }
}

/**
 * Extract all field paths from a document
 */
function extractFieldPaths(obj: any, path: string = '', result: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') {
    return result;
  }
  
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    result.push(currentPath);
    
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      extractFieldPaths(value, currentPath, result);
    }
  }
  
  return result;
}

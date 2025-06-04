/**
 * Utility functions for trace attribute clustering
 */

/**
 * Get a value from an object using a path string (e.g., 'Attributes.http.url')
 * 
 * @param obj The object to extract the value from
 * @param path The path to the value (e.g., 'Attributes.http.url')
 * @returns The value at the specified path, or undefined if not found
 */
export function getValueByPath(obj: any, path: string): any {
  if (!obj || !path) {
    return undefined;
  }
  
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Build query filters for trace attribute search
 * 
 * @param startTime Start time for the search
 * @param endTime End time for the search
 * @param attributeKey The attribute key to filter by (optional if useTextContent is true)
 * @param service Optional service name to filter by
 * @param queryString Optional Elasticsearch query string for additional filtering
 * @param useTextContent Whether to use text content instead of a specific attribute
 * @returns Array of filters for the query
 */
export function buildTraceFilters(
  startTime: string,
  endTime: string,
  telemetryFields: Record<string, string>,
  attributeKey?: string,
  service?: string,
  queryString?: string,
  useTextContent?: boolean
): any[] {
  const filters: any[] = [
    {
      range: {
        '@timestamp': {
          gte: startTime,
          lte: endTime
        }
      }
    }
  ];
  
  // Only add the exists filter if we're filtering by a specific attribute
  // and not using text content
  if (attributeKey && !useTextContent) {
    // For trace.id field, we need to use the correct field name in logs
    if (attributeKey === 'trace.id' || attributeKey === 'TraceId') {
      filters.push({
        exists: {
          field: telemetryFields.traceId
        }
      });
    } else {
      filters.push({
        exists: {
          field: attributeKey
        }
      });
    }
  } else if (useTextContent) {
    // When using text content, ensure we have trace data by requiring trace.id
    filters.push({
      exists: {
        field: telemetryFields.traceId
      }
    });
  }
  
  // Add service filter if specified
  if (service) {
    // Support wildcard patterns in service names
    if (service.includes('*')) {
      filters.push({
        wildcard: {
          [telemetryFields.service]: service
        }
      });
    } else {
      filters.push({
        term: {
          [telemetryFields.service]: service
        }
      });
    }
  }
  
  // Add query string filter if specified
  if (queryString) {
    filters.push({
      query_string: {
        query: queryString,
        analyze_wildcard: true,
        default_field: '*'
      }
    });
  }
  
  return filters;
}

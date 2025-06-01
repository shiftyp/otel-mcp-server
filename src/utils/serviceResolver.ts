import { createTermQuery, createWildcardQuery, createQueryStringQuery, BaseQuery } from './queryBuilder.js';
import { createErrorResponse, ErrorResponse } from './errorHandling.js';

/**
 * Service field paths for different telemetry types
 */
export const SERVICE_FIELD_PATHS = {
  TRACES: 'Resource.service.name',
  LOGS: 'Resource.service.name',
  METRICS: 'service.name',
  // Add any other service field paths as needed
};

/**
 * Options for service name resolution
 */
export interface ServiceResolverOptions {
  exactMatch?: boolean;
  allowWildcards?: boolean;
  caseSensitive?: boolean;
  fieldPath?: string;
}

/**
 * Default options for service resolution
 */
const DEFAULT_OPTIONS: ServiceResolverOptions = {
  exactMatch: false,
  allowWildcards: true,
  caseSensitive: false,
  fieldPath: undefined
};

/**
 * Utility class for consistent service name handling across the codebase
 */
export class ServiceResolver {
  /**
   * Creates a query for filtering by service name
   * @param serviceName Service name or pattern
   * @param telemetryType Type of telemetry (traces, logs, metrics)
   * @param options Service resolver options
   * @returns Query for filtering by service
   */
  static createServiceQuery(
    serviceName: string,
    telemetryType: 'TRACES' | 'LOGS' | 'METRICS',
    options: ServiceResolverOptions = {}
  ): BaseQuery | ErrorResponse {
    try {
      const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
      const fieldPath = mergedOptions.fieldPath || SERVICE_FIELD_PATHS[telemetryType];
      
      if (!fieldPath) {
        return createErrorResponse(`Unknown telemetry type: ${telemetryType}`);
      }
      
      // Handle empty service name
      if (!serviceName || serviceName.trim() === '') {
        return createErrorResponse('Service name cannot be empty');
      }
      
      // Apply case sensitivity
      let normalizedServiceName = serviceName;
      if (!mergedOptions.caseSensitive) {
        normalizedServiceName = serviceName.toLowerCase();
      }
      
      // Handle exact matches
      if (mergedOptions.exactMatch) {
        return createTermQuery(fieldPath, normalizedServiceName);
      }
      
      // Handle wildcards
      if (mergedOptions.allowWildcards) {
        // If service name already contains wildcards, use as is
        if (normalizedServiceName.includes('*')) {
          return createWildcardQuery(fieldPath, normalizedServiceName);
        }
        
        // Otherwise, add wildcards for partial matching
        return createWildcardQuery(fieldPath, `*${normalizedServiceName}*`);
      }
      
      // Default to query_string for flexibility
      return createQueryStringQuery(`${fieldPath}:*${normalizedServiceName}*`);
    } catch (error) {
      return createErrorResponse(`Error creating service query: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Normalizes a service name for consistent comparison
   * @param serviceName Service name to normalize
   * @param options Normalization options
   * @returns Normalized service name
   */
  static normalizeServiceName(
    serviceName: string,
    options: { caseSensitive?: boolean } = {}
  ): string {
    if (!serviceName) {
      return '';
    }
    
    let normalized = serviceName.trim();
    
    if (!options.caseSensitive) {
      normalized = normalized.toLowerCase();
    }
    
    return normalized;
  }
  
  /**
   * Checks if a service name matches a pattern
   * @param serviceName Service name to check
   * @param pattern Pattern to match against
   * @param options Matching options
   * @returns True if the service name matches the pattern
   */
  static matchesPattern(
    serviceName: string,
    pattern: string,
    options: { caseSensitive?: boolean } = {}
  ): boolean {
    const normalizedService = this.normalizeServiceName(serviceName, options);
    const normalizedPattern = this.normalizeServiceName(pattern, options);
    
    // Handle exact match
    if (normalizedService === normalizedPattern) {
      return true;
    }
    
    // Handle wildcard patterns
    if (normalizedPattern.includes('*')) {
      const regexPattern = normalizedPattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');
      
      const regex = new RegExp(`^${regexPattern}$`, options.caseSensitive ? '' : 'i');
      return regex.test(normalizedService);
    }
    
    // Handle partial match
    return normalizedService.includes(normalizedPattern);
  }
  
  /**
   * Filters an array of services by a pattern
   * @param services Array of service names
   * @param pattern Pattern to filter by
   * @param options Filtering options
   * @returns Filtered array of services
   */
  static filterServices(
    services: string[],
    pattern: string,
    options: { caseSensitive?: boolean } = {}
  ): string[] {
    if (!pattern || pattern.trim() === '') {
      return services;
    }
    
    return services.filter(service => 
      this.matchesPattern(service, pattern, options)
    );
  }
}

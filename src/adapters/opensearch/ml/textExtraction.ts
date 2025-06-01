/**
 * Centralized text extraction utilities for embedding generation
 * 
 * This module provides functions to extract text content from various telemetry data types
 * using the same approach as the OpenSearch painless scripts used in the ingest pipelines.
 * This ensures consistency between how embeddings are generated at runtime and how they're
 * generated in the OpenSearch pipeline.
 */

import { logger } from '../../../utils/logger.js';

/**
 * Extract text content from an object following the same approach as the OpenSearch painless scripts
 * 
 * @param source The source object to extract text from
 * @param options Options for text extraction
 * @returns The extracted text content
 */
export function extractTextContent(source: any, options: TextExtractionOptions = {}): string {
  if (!source || typeof source !== 'object') {
    return '';
  }

  const textContent: string[] = [];
  
  // Default field sets for different data types
  const defaultTextFields = [
    // Common text fields
    'message', 'body', 'Body', 'name', 'Name', 'title', 'description', 'Description',
    // Error-related fields
    'error.message', 'exception.message', 'error.stack', 'exception.stack',
    // Trace-specific fields
    'span.name', 'SpanId', 'TraceId', 'TraceStatusDescription',
    // Metric-specific fields
    'metric.name', 'metric.description',
    // Log-specific fields from our discovered structure
    'log_name', 'event.action', 'kubernetes.pod.name', 'kubernetes.namespace',
    'url.path', 'url.full', 'service.name'
  ];
  
  const defaultDimensionFields = [
    // Common dimension fields (lowercase)
    'labels', 'dimensions', 'attributes', 'tags', 'resource.attributes',
    // Common dimension fields (capitalized for traces)
    'Attributes', 'Resource', 'Resource.attributes', 'Events',
    // Log-specific dimension fields
    'kubernetes', 'service', 'agent', 'destination', 'source', 'k8s', 'upstream'
  ];
  
  const defaultValueFields = [
    // Common value fields
    'value', 'count', 'Duration',
    // Metric-specific value fields
    'metric.value', 'gauge.value',
    // Log-specific value fields
    '@timestamp'
  ];
  
  // Determine which fields to use based on options
  let textFields: string[];
  let dimensionFields: string[];
  let valueFields: string[];
  
  if (options.useOnlyRelevantFields) {
    // Only use the explicitly provided fields
    textFields = options.textFields || [];
    dimensionFields = options.dimensionFields || [];
    valueFields = options.valueFields || [];
    
    logger.debug('Using only relevant fields for text extraction', {
      textFields,
      dimensionFields,
      valueFields
    });
  } else {
    // Use provided fields or fall back to defaults
    textFields = options.textFields || defaultTextFields;
    dimensionFields = options.dimensionFields || defaultDimensionFields;
    valueFields = options.valueFields || defaultValueFields;
  }
  
  // Extract text from primary text fields
  for (const field of textFields) {
    const fieldValue = getNestedValue(source, field);
    if (fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim().length > 0) {
      textContent.push(String(fieldValue));
    }
  }
  
  // Extract dimension/label/attribute fields
  for (const mapField of dimensionFields) {
    const dimensionMap = getNestedValue(source, mapField);
    if (dimensionMap && typeof dimensionMap === 'object' && !Array.isArray(dimensionMap)) {
      for (const [key, value] of Object.entries(dimensionMap)) {
        if (value !== undefined && value !== null && String(value).trim().length > 0) {
          textContent.push(`${key}:"${value}"`);
        }
      }
    }
  }
  
  // Include metric value information if available
  for (const valueField of valueFields) {
    const metricValue = getNestedValue(source, valueField);
    if (metricValue !== undefined && metricValue !== null) {
      textContent.push(`value:${metricValue}`);
      break; // Only include the first value field found
    }
  }
  
  // Join all text content with spaces
  return textContent.join(' ');
}

/**
 * Get a nested value from an object using dot notation
 * 
 * @param obj The object to get the value from
 * @param path The path to the value using dot notation
 * @returns The value at the specified path or undefined if not found
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  
  // Handle direct property access first
  if (obj.hasOwnProperty(path)) {
    return obj[path];
  }
  
  // Handle nested property access
  const parts = path.split('.');
  let current = obj;
  
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    
    current = current[part];
  }
  
  return current;
}

/**
 * Options for text extraction
 */
export interface TextExtractionOptions {
  /** Specific text fields to extract (e.g., 'message', 'name') */
  textFields?: string[];
  /** Dimension/label/attribute fields to extract (e.g., 'labels', 'attributes') */
  dimensionFields?: string[];
  /** Value fields to extract (e.g., 'count', 'value') */
  valueFields?: string[];
  /** Whether to only use the relevant fields specified */
  useOnlyRelevantFields?: boolean;
}

/**
 * Create a text extractor function for a specific data type
 * 
 * @param options Options for text extraction
 * @returns A function that extracts text from an object
 */
export function createTextExtractor<T>(options: TextExtractionOptions = {}): (item: T) => string {
  return (item: T): string => {
    try {
      return extractTextContent(item, options);
    } catch (error) {
      logger.warn('[TextExtraction] Error extracting text content', {
        error: error instanceof Error ? error.message : String(error),
        item: typeof item === 'object' ? JSON.stringify(item).substring(0, 200) : String(item)
      });
      
      // Fallback to string representation if extraction fails
      return String(item);
    }
  };
}

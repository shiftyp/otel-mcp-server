import { ElasticsearchDataError, DataType } from './errors.js';
import { DataAvailabilityGuards } from './dataAvailability.js';
import { ErrorResponseFormatter } from './errorResponse.js';

/**
 * ElasticGuards class that combines all guard functionality
 * This class maintains the original API for backward compatibility
 */
export class ElasticGuards {
  // Re-export the ElasticsearchDataError class
  static ElasticsearchDataError = ElasticsearchDataError;

  // Data availability methods
  static checkLogsAvailability = DataAvailabilityGuards.checkLogsAvailability;
  static checkMetricsAvailability = DataAvailabilityGuards.checkMetricsAvailability;
  static checkTracesAvailability = DataAvailabilityGuards.checkTracesAvailability;

  // Error response formatting
  static formatErrorResponse = ErrorResponseFormatter.formatErrorResponse;
}

// Export individual classes for direct imports
export { 
  ElasticsearchDataError,
  DataAvailabilityGuards,
  ErrorResponseFormatter
};

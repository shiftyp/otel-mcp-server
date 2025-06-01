import { MCPToolContentItem, MCPToolOutput } from '../../types.js';
import { ElasticsearchDataError, DataType } from './errors.js';
import { logger } from '../logger.js';

/**
 * Functions for formatting error responses for MCP tools
 */
export class ErrorResponseFormatter {
  /**
   * Format an error into a standardized MCP tool output response
   * @param error The error to format
   * @param params Optional parameters that were part of the original request
   * @returns Formatted MCP tool output
   */
  static formatErrorResponse(error: unknown, params?: Record<string, any>): MCPToolOutput {
    // Helper: check if value is a plain object (not array/function/null)
    function isPlainObject(val: unknown): val is Record<string, unknown> {
      return typeof val === 'object' && val !== null && !Array.isArray(val);
    }
    // Log the error for debugging
    logger.error('[ErrorResponseFormatter] Formatting error response', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      params
    });

    // Default error message and content
    let errorMessage = 'An unexpected error occurred';
    let errorContent: MCPToolContentItem[] = [];
    let suggestions: string[] = [];

    // Handle different error types
    if (error instanceof ElasticsearchDataError) {
      // Handle data availability errors
      errorMessage = error.message;
      suggestions = this.getSuggestionsForDataError(error.dataType);
      
      // Add more detailed information for debugging
      errorContent.push({
        type: 'text',
        text: `Data Type: ${error.dataType}\nDetails: ${JSON.stringify(error.details, null, 2)}`
      });
    } else if (
      isPlainObject(error) &&
      ('name' in error && (error as any).name === 'ConnectionError' ||
      ('message' in error && typeof (error as any).message === 'string' && (error as any).message.includes('ECONNREFUSED')))
    ) {
      // Handle Elasticsearch connection errors
      errorMessage = 'Could not connect to Elasticsearch. Please ensure Elasticsearch is running and accessible.';
      suggestions = [
        'Check if Elasticsearch is running',
        'Verify Elasticsearch connection settings',
        'Check network connectivity to Elasticsearch',
        'Ensure Elasticsearch security settings allow connections'
      ];
    } else if (
      isPlainObject(error) &&
      'meta' in error && isPlainObject(error.meta) &&
      'body' in error.meta && isPlainObject(error.meta.body) &&
      'error' in error.meta.body && isPlainObject(error.meta.body.error) &&
      'type' in error.meta.body.error && error.meta.body.error.type === 'index_not_found_exception'
    ) {
      // Handle index not found errors
      const indexName = (isPlainObject(error) && 'meta' in error && isPlainObject(error.meta) && 'body' in error.meta && isPlainObject(error.meta.body) && 'error' in error.meta.body && isPlainObject(error.meta.body.error) && 'index' in error.meta.body.error)
        ? error.meta.body.error.index
        : 'unknown';
      errorMessage = `Index not found: ${indexName}`;
      suggestions = [
        'Ensure OpenTelemetry data is being sent to Elasticsearch',
        'Check index naming patterns in the configuration',
        'Verify index lifecycle management settings'
      ];
    } else if (
      isPlainObject(error) &&
      'meta' in error && isPlainObject(error.meta) &&
      'body' in error.meta && isPlainObject(error.meta.body) &&
      'error' in error.meta.body && isPlainObject(error.meta.body.error) &&
      'type' in error.meta.body.error && error.meta.body.error.type === 'search_phase_execution_exception'
    ) {
      // Handle search execution errors
      errorMessage = 'Error executing search query';
      
      // Extract more specific error details if available
      const rootCause = (isPlainObject(error) && 'meta' in error && isPlainObject(error.meta) && 'body' in error.meta && isPlainObject(error.meta.body) && 'error' in error.meta.body && isPlainObject(error.meta.body.error) && 'root_cause' in error.meta.body.error && Array.isArray(error.meta.body.error.root_cause))
        ? error.meta.body.error.root_cause[0]
        : undefined;
      if (rootCause) {
        errorMessage += `: ${rootCause.type} - ${rootCause.reason}`;
      }
      
      suggestions = [
        'Check the syntax of your search query',
        'Verify field names and types in your query',
        'Ensure the query is compatible with your Elasticsearch version'
      ];
    } else if (
      isPlainObject(error) &&
      'meta' in error && isPlainObject(error.meta) &&
      'body' in error.meta && isPlainObject(error.meta.body) &&
      'error' in error.meta.body && isPlainObject(error.meta.body.error) &&
      'type' in error.meta.body.error
    ) {
      // Handle other Elasticsearch API errors
      const errorType = (isPlainObject(error) && 'meta' in error && isPlainObject(error.meta) && 'body' in error.meta && isPlainObject(error.meta.body) && 'error' in error.meta.body && isPlainObject(error.meta.body.error) && 'type' in error.meta.body.error)
        ? error.meta.body.error.type
        : 'unknown';
      errorMessage = `Elasticsearch API error: ${errorType}`;
      
      if (isPlainObject(error) && 'meta' in error && isPlainObject(error.meta) && 'body' in error.meta && isPlainObject(error.meta.body) && 'error' in error.meta.body && isPlainObject(error.meta.body.error) && 'reason' in error.meta.body.error && typeof error.meta.body.error.reason === 'string') {
        errorMessage += ` - ${error.meta.body.error.reason}`;
      }
      
      suggestions = this.getSuggestionsForApiError(typeof errorType === 'string' ? errorType : String(errorType));
    } else if (error instanceof Error) {
      // Handle generic Error objects
      errorMessage = error.message || 'Unknown error';
      
      // Include stack trace for debugging if available
      if (error.stack) {
        errorContent.push({
          type: 'text',
          text: `Stack Trace: ${error.stack}`
        });
      }
    } else if (typeof error === 'string') {
      // Handle string errors
      errorMessage = error;
    }

    // Construct the final error response
    const response: MCPToolOutput = {
      content: [
        {
          type: 'text',
          text: errorMessage
        },
        ...errorContent
      ]
    };

    // Add suggestions if available
    if (suggestions.length > 0) {
      response.content.push({
        type: 'text',
        text: '**Suggestions:**\n\n' + suggestions.map(s => `- ${s}`).join('\n')
      });
    }

    return response;
  }

  /**
   * Get suggestions for data availability errors
   * @param dataType The type of data that is unavailable
   * @returns Array of suggestion strings
   */
  private static getSuggestionsForDataError(dataType: DataType): string[] {
    const commonSuggestions = [
      'Ensure the OpenTelemetry Collector is properly configured',
      'Check that the Elasticsearch exporter is enabled in the collector',
      'Verify that Elasticsearch is running and accessible',
      'Check for errors in the OpenTelemetry Collector logs'
    ];

    switch (dataType) {
      case 'logs':
        return [
          ...commonSuggestions,
          'Ensure applications are configured to send logs to the OpenTelemetry Collector',
          'Check that log processors in the collector pipeline are correctly configured'
        ];
      case 'metrics':
        return [
          ...commonSuggestions,
          'Ensure applications are configured to send metrics to the OpenTelemetry Collector',
          'Check that metric processors in the collector pipeline are correctly configured',
          'Verify that metrics scraping is enabled for relevant endpoints'
        ];
      case 'traces':
        return [
          ...commonSuggestions,
          'Ensure applications are configured to send traces to the OpenTelemetry Collector',
          'Check that trace processors in the collector pipeline are correctly configured',
          'Verify that instrumentation is properly set up in your applications'
        ];
      default:
        return commonSuggestions;
    }
  }

  /**
   * Get suggestions for Elasticsearch API errors
   * @param errorType The type of Elasticsearch API error
   * @returns Array of suggestion strings
   */
  private static getSuggestionsForApiError(errorType?: string): string[] {
    const commonSuggestions = [
      'Check Elasticsearch logs for more detailed error information',
      'Verify Elasticsearch configuration settings',
      'Ensure your query syntax is correct'
    ];

    if (!errorType) return commonSuggestions;

    switch (errorType) {
      case 'parsing_exception':
        return [
          'Check the syntax of your query',
          'Verify field names and types in your query',
          'Ensure all parentheses and brackets are properly closed'
        ];
      case 'index_not_found_exception':
        return [
          'Verify the index name is correct',
          'Check if the index exists in Elasticsearch',
          'Ensure the index pattern matches your Elasticsearch indices'
        ];
      case 'search_phase_execution_exception':
        return [
          'Check for invalid field references in your query',
          'Verify that all fields in your query exist in the index',
          'Check for type mismatches in your query conditions'
        ];
      default:
        return commonSuggestions;
    }
  }
}

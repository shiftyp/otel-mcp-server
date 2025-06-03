import { logger } from './logger.js';

/**
 * Standard error response format for all adapters and tools
 */
export interface ErrorResponse {
  error: boolean;
  message: string;
  details?: Record<string, unknown>;
  code?: string;
  status?: number;
}

/**
 * Creates a standardized error response object
 * @param message Error message
 * @param details Additional error details
 * @param code Error code
 * @param status HTTP status code
 * @returns Standardized error response
 */
export function createErrorResponse(
  message: string,
  details?: Record<string, unknown>,
  code?: string,
  status?: number
): ErrorResponse {
  return {
    error: true,
    message,
    details,
    code,
    status
  };
}

/**
 * Handles errors in a consistent way across the codebase
 * @param error Error object or string
 * @param context Additional context for the error
 * @returns Standardized error response
 */
export function handleError(error: unknown, context?: string): ErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const contextPrefix = context ? `[${context}] ` : '';
  const fullMessage = `${contextPrefix}${errorMessage}`;
  
  logger.error(fullMessage);
  
  if (error instanceof Error && error.stack) {
    logger.debug(error.stack);
  }
  
  const errorObj = error as any; // Type assertion for code and status properties
  return createErrorResponse(
    fullMessage,
    error instanceof Error ? { stack: error.stack } : undefined,
    errorObj?.code,
    errorObj?.status
  );
}

/**
 * Checks if a response is an error response
 * @param response Any response object
 * @returns True if the response is an error response
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return response !== null && 
         typeof response === 'object' && 
         'error' in response &&
         (response as ErrorResponse).error === true;
}

/**
 * Wraps an async function with error handling
 * @param fn Async function to wrap
 * @param context Context for error logging
 * @returns Wrapped function that returns a standardized response
 */
export function withErrorHandling<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  context?: string
): (...args: Args) => Promise<T | ErrorResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return handleError(error, context);
    }
  };
}

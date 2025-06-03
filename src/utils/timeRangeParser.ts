import { createErrorResponse, ErrorResponse } from './errorHandling.js';

/**
 * Represents a time range with start and end times
 */
export interface TimeRange {
  startTime: string;
  endTime: string;
}

/**
 * Time units for relative time expressions
 */
type TimeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

/**
 * Maps time units to milliseconds
 */
const TIME_UNIT_TO_MS: Record<TimeUnit, number> = {
  's': 1000,
  'm': 60 * 1000,
  'h': 60 * 60 * 1000,
  'd': 24 * 60 * 60 * 1000,
  'w': 7 * 24 * 60 * 60 * 1000,
  'M': 30 * 24 * 60 * 60 * 1000, // Approximate
  'y': 365 * 24 * 60 * 60 * 1000 // Approximate
};

/**
 * Parses a relative time expression (e.g., "now-1h")
 * @param expression Relative time expression
 * @returns ISO timestamp string
 */
export function parseRelativeTime(expression: string): string {
  // Handle 'now' case
  if (expression === 'now') {
    return new Date().toISOString();
  }

  // Parse relative time expressions like "now-1h"
  const relativeTimeRegex = /^now(-|\+)(\d+)([smhdwMy])$/;
  const match = expression.match(relativeTimeRegex);

  if (!match) {
    throw new Error(`Invalid relative time expression: ${expression}`);
  }

  const [, operation, valueStr, unit] = match;
  const value = parseInt(valueStr, 10);
  const timeUnit = unit as TimeUnit;
  
  if (!(timeUnit in TIME_UNIT_TO_MS)) {
    throw new Error(`Invalid time unit: ${timeUnit}`);
  }

  const now = new Date();
  const milliseconds = value * TIME_UNIT_TO_MS[timeUnit];
  
  if (operation === '-') {
    now.setTime(now.getTime() - milliseconds);
  } else {
    now.setTime(now.getTime() + milliseconds);
  }

  return now.toISOString();
}

/**
 * Validates and normalizes a timestamp string
 * @param timestamp ISO timestamp or relative time expression
 * @returns Normalized ISO timestamp
 */
export function normalizeTimestamp(timestamp: string): string {
  // Check if it's a relative time expression
  if (timestamp.startsWith('now')) {
    return parseRelativeTime(timestamp);
  }

  // Validate ISO format
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }
    return date.toISOString();
  } catch (error) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }
}

/**
 * Parses and validates a time range
 * @param startTime Start time (ISO timestamp or relative expression)
 * @param endTime End time (ISO timestamp or relative expression)
 * @returns Normalized time range or error response
 */
export function parseTimeRange(
  startTime: string,
  endTime: string
): TimeRange | ErrorResponse {
  try {
    const normalizedStartTime = normalizeTimestamp(startTime);
    const normalizedEndTime = normalizeTimestamp(endTime);

    // Validate that start time is before end time
    if (new Date(normalizedStartTime) >= new Date(normalizedEndTime)) {
      return createErrorResponse('Start time must be before end time');
    }

    return {
      startTime: normalizedStartTime,
      endTime: normalizedEndTime
    };
  } catch (error) {
    return createErrorResponse(`Time range parsing error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets a default time range (e.g., last hour)
 * @returns Default time range
 */
export function getDefaultTimeRange(): TimeRange {
  return {
    startTime: parseRelativeTime('now-1h'),
    endTime: parseRelativeTime('now')
  };
}

/**
 * Formats a timestamp for display
 * @param timestamp ISO timestamp
 * @param format Format type
 * @returns Formatted timestamp string
 */
export function formatTimestamp(
  timestamp: string,
  format: 'short' | 'medium' | 'long' = 'medium'
): string {
  const date = new Date(timestamp);
  
  switch (format) {
    case 'short':
      return date.toLocaleString(undefined, { 
        hour: 'numeric', 
        minute: 'numeric' 
      });
    case 'long':
      return date.toLocaleString(undefined, { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric', 
        second: 'numeric' 
      });
    case 'medium':
    default:
      return date.toLocaleString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric' 
      });
  }
}

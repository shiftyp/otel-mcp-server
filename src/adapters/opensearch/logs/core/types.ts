/**
 * Core log entry structure
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, any>;
}

/**
 * Log query options
 */
export interface LogQueryOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  level?: string | string[];
  traceId?: string;
  spanId?: string;
  query?: string;
  size?: number;
  from?: number;
  sort?: Array<{ [key: string]: { order: 'asc' | 'desc' } }>;
  fields?: string[];
}

/**
 * Log aggregation options
 */
export interface LogAggregationOptions {
  field: string;
  interval?: string;
  size?: number;
  minDocCount?: number;
}

/**
 * Log search response
 */
export interface LogSearchResponse {
  logs: LogEntry[];
  total: number;
  aggregations?: Record<string, any>;
}

/**
 * Log field information
 */
export interface LogField {
  field: string;
  type: string;
  properties?: string[];
}

/**
 * Log statistics
 */
export interface LogStats {
  totalLogs: number;
  errorRate: number;
  warningRate: number;
  avgMessageLength: number;
  uniqueServices: number;
  timeRange: {
    start: string;
    end: string;
  };
}
/**
 * Types for trace tools
 */

// Define interface for enhanced error object
export interface EnhancedError {
  error: string;
  count: number;
  level?: string;
  service?: string;
  timestamp?: string;
  trace_id?: string;
  span_id?: string;
  trace?: {
    id: string;
    duration: number;
    spanCount: number;
    services: string[];
    rootOperation: string;
  };
  metrics?: Record<string, any>;
}

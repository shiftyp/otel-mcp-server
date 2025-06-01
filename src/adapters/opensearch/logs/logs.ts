/**
 * OpenSearch Logs Adapter
 * This file is a simple re-export of the LogsAdapter class
 * The implementation has been refactored into smaller, more focused modules
 */

export { LogsAdapter } from './logsAdapter.js';

// Re-export types and interfaces that might be used by consumers
export interface LogVector {
  id: string;
  timestamp: string;
  message: string;
  vector: number[];
  service?: string;
  level?: string;
}

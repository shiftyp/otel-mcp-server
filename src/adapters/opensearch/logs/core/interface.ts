import { SearchRequest, SearchResponse } from '../../../../types/elasticsearch.js';
import { FieldInfo, LogEntry } from '../../../../types/telemetry.js';

/**
 * Interface for logs adapter core functionality
 * Used by various analysis modules
 */
export interface ILogsAdapter {
  searchLogs(query: SearchRequest): Promise<SearchResponse<LogEntry>>;
  queryLogs(query: SearchRequest): Promise<SearchResponse<LogEntry>>;
  getLogFields(): Promise<FieldInfo[]>;
  getServices(timeRange?: { from: string; to: string }): Promise<string[]>;
  getLogLevelStats(timeRange?: { from: string; to: string }, service?: string): Promise<Record<string, number>>;
}
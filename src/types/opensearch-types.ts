/**
 * Re-export commonly used OpenSearch types for convenience
 */

import { Client, ClientOptions, ApiError } from '@opensearch-project/opensearch';

// Re-export commonly used types at top level
export { Client, ClientOptions, ApiError };

// Custom telemetry-specific types that extend OpenSearch documents
export interface LogDocument {
  '@timestamp': string;
  message: string;
  level: string;
  'service.name'?: string;
  'trace.id'?: string;
  'span.id'?: string;
  [key: string]: unknown;
}

export interface TraceDocument {
  '@timestamp': string;
  'trace.id': string;
  'span.id': string;
  'parent.id'?: string;
  'service.name': string;
  'span.name': string;
  duration: number;
  'span.kind'?: string;
  'span.status.code'?: string;
  [key: string]: unknown;
}

export interface MetricDocument {
  '@timestamp': string;
  'service.name': string;
  'metric.name': string;
  value: number;
  [key: string]: unknown;
}

// Type aliases for common OpenSearch types with our documents
export interface SearchResponse<T = unknown> {
  took?: number;
  timed_out: boolean;
  _shards: {
    total: number;
    successful: number;
    skipped?: number;
    failed?: number;
  };
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
    };
    max_score?: number | null;
    hits: Array<{
      _index: string;
      _type?: string;
      _id: string;
      _score?: number | null;
      _source: T;
      _seq_no?: number;
      _primary_term?: number;
      highlight?: Record<string, string[]>;
      sort?: Array<string | number | null>;
    }>;
  };
  aggregations?: Record<string, any>;
}

export type LogSearchResponse = SearchResponse<LogDocument>;
export type TraceSearchResponse = SearchResponse<TraceDocument>;
export type MetricSearchResponse = SearchResponse<MetricDocument>;

// Query DSL types - define them directly since OpenSearch types are complex
export interface Query {
  bool?: BoolQuery;
  match?: Record<string, any>;
  match_phrase?: Record<string, any>;
  term?: Record<string, any>;
  terms?: Record<string, any[]>;
  range?: Record<string, any>;
  exists?: { field: string };
  wildcard?: Record<string, any>;
  query_string?: {
    query: string;
    fields?: string[];
    default_field?: string;
  };
  match_all?: Record<string, any>;
  [key: string]: any;
}

export interface BoolQuery {
  must?: Query | Query[];
  filter?: Query | Query[];
  should?: Query | Query[];
  must_not?: Query | Query[];
  minimum_should_match?: number | string;
  boost?: number;
}

// Sort types
export type Sort = string | Record<string, any> | Array<string | Record<string, any>>;
export type SortOrder = 'asc' | 'desc';
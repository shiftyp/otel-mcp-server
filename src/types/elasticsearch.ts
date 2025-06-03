/**
 * Elasticsearch/OpenSearch Query DSL Types
 * These types provide structure for query objects while maintaining flexibility
 */

// Basic query types
export interface MatchQuery {
  match: Record<string, string | { query: string; operator?: 'and' | 'or' }>;
}

export interface TermQuery {
  term: Record<string, string | number | boolean>;
}

export interface TermsQuery {
  terms: Record<string, (string | number | boolean)[]>;
}

export interface RangeQuery {
  range: Record<string, {
    gte?: string | number;
    gt?: string | number;
    lte?: string | number;
    lt?: string | number;
    format?: string;
  }>;
}

export interface ExistsQuery {
  exists: { field: string };
}

export interface BoolQuery {
  bool: {
    must?: QueryDSL | QueryDSL[];
    filter?: QueryDSL | QueryDSL[];
    should?: QueryDSL | QueryDSL[];
    must_not?: QueryDSL | QueryDSL[];
    minimum_should_match?: number | string;
  };
}

// Compound query type
export type QueryDSL = 
  | MatchQuery 
  | TermQuery 
  | TermsQuery 
  | RangeQuery 
  | ExistsQuery 
  | BoolQuery
  | { match_all: Record<string, never> }
  | { [key: string]: unknown }; // Fallback for other query types

// Sort types
export type SortOrder = 'asc' | 'desc' | string;

export interface SortField {
  [field: string]: SortOrder | {
    order: SortOrder;
    missing?: '_first' | '_last';
    mode?: 'min' | 'max' | 'sum' | 'avg' | 'median';
  };
}

export type Sort = string | SortField | (string | SortField)[];

// Aggregation types
export interface AggregationContainer {
  // Metric aggregations
  avg?: { field: string };
  sum?: { field: string };
  min?: { field: string };
  max?: { field: string };
  stats?: { field: string };
  extended_stats?: { field: string };
  cardinality?: { field: string; precision_threshold?: number };
  value_count?: { field: string };
  percentiles?: { field: string; percents?: number[] };
  
  // Bucket aggregations
  terms?: {
    field: string;
    size?: number;
    order?: Record<string, SortOrder>;
    min_doc_count?: number;
  };
  date_histogram?: {
    field: string;
    fixed_interval?: string;
    calendar_interval?: string;
    format?: string;
    min_doc_count?: number;
  };
  histogram?: {
    field: string;
    interval: number;
    min_doc_count?: number;
  };
  range?: {
    field: string;
    ranges: Array<{ from?: number; to?: number; key?: string }>;
  };
  filter?: QueryDSL;
  filters?: {
    filters: Record<string, QueryDSL>;
  };
  
  // Sub-aggregations
  aggs?: Record<string, AggregationContainer>;
  aggregations?: Record<string, AggregationContainer>;
}

export type Aggregations = Record<string, AggregationContainer>;

// Search request body
export interface SearchRequest {
  query?: QueryDSL;
  size?: number;
  from?: number;
  sort?: Sort;
  _source?: boolean | string | string[];
  aggregations?: Aggregations;
  aggs?: Aggregations;
  track_total_hits?: boolean | number;
  timeout?: string;
}

// Search response types
export interface SearchHit<T = unknown> {
  _index: string;
  _id: string;
  _score: number | null;
  _source: T;
  fields?: Record<string, unknown[]>;
  highlight?: Record<string, string[]>;
}

export interface SearchResponse<T = unknown> {
  took: number;
  timed_out: boolean;
  _shards: {
    total: number;
    successful: number;
    skipped: number;
    failed: number;
  };
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
    };
    max_score: number | null;
    hits: SearchHit<T>[];
  };
  aggregations?: Record<string, AggregationResult>;
}

// Aggregation result types
export interface AggregationResult {
  value?: number;
  doc_count?: number;
  buckets?: BucketResult[];
  values?: Record<string, number>;
  // Extended stats
  count?: number;
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
  sum_of_squares?: number;
  variance?: number;
  std_deviation?: number;
  std_deviation_bounds?: {
    upper: number;
    lower: number;
  };
}

export interface BucketResult {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
  [key: string]: unknown; // Sub-aggregations
}

// Field mapping types
export interface FieldMapping {
  type: 'text' | 'keyword' | 'long' | 'integer' | 'short' | 'byte' | 
        'double' | 'float' | 'boolean' | 'date' | 'object' | 'nested';
  fields?: Record<string, FieldMapping>;
  format?: string;
  index?: boolean;
  store?: boolean;
}

export interface MappingResponse {
  [index: string]: {
    mappings: {
      properties: Record<string, FieldMapping>;
    };
  };
}
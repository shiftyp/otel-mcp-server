import { TimeRange } from './timeRangeParser.js';

/**
 * Common query types used across the codebase
 */
export enum QueryType {
  MATCH = 'match',
  MATCH_PHRASE = 'match_phrase',
  TERM = 'term',
  TERMS = 'terms',
  RANGE = 'range',
  WILDCARD = 'wildcard',
  QUERY_STRING = 'query_string',
  BOOL = 'bool',
  EXISTS = 'exists'
}

/**
 * Base interface for all Elasticsearch queries
 */
export interface BaseQuery {
  [key: string]: any;
}

/**
 * Interface for Elasticsearch bool query
 */
export interface BoolQuery extends BaseQuery {
  bool: {
    must?: BaseQuery[];
    must_not?: BaseQuery[];
    should?: BaseQuery[];
    filter?: BaseQuery[];
    minimum_should_match?: number;
  };
}

/**
 * Interface for Elasticsearch query with size and from parameters
 */
export interface PaginatedQuery extends BaseQuery {
  size?: number;
  from?: number;
  sort?: any[];
  _source?: string[] | boolean;
  track_total_hits?: boolean | number;
}

/**
 * Creates a match query
 * @param field Field to match
 * @param value Value to match
 * @returns Match query object
 */
export function createMatchQuery(field: string, value: any): BaseQuery {
  return {
    [QueryType.MATCH]: {
      [field]: value
    }
  };
}

/**
 * Creates a match phrase query
 * @param field Field to match
 * @param value Phrase to match
 * @returns Match phrase query object
 */
export function createMatchPhraseQuery(field: string, value: string): BaseQuery {
  return {
    [QueryType.MATCH_PHRASE]: {
      [field]: value
    }
  };
}

/**
 * Creates a term query
 * @param field Field to match
 * @param value Exact value to match
 * @returns Term query object
 */
export function createTermQuery(field: string, value: any): BaseQuery {
  return {
    [QueryType.TERM]: {
      [field]: value
    }
  };
}

/**
 * Creates a terms query
 * @param field Field to match
 * @param values Array of values to match
 * @returns Terms query object
 */
export function createTermsQuery(field: string, values: any[]): BaseQuery {
  return {
    [QueryType.TERMS]: {
      [field]: values
    }
  };
}

/**
 * Creates a range query
 * @param field Field to apply range to
 * @param gte Greater than or equal value
 * @param lte Less than or equal value
 * @param gt Greater than value
 * @param lt Less than value
 * @returns Range query object
 */
export function createRangeQuery(
  field: string,
  gte?: any,
  lte?: any,
  gt?: any,
  lt?: any
): BaseQuery {
  const rangeParams: any = {};
  
  if (gte !== undefined) rangeParams.gte = gte;
  if (lte !== undefined) rangeParams.lte = lte;
  if (gt !== undefined) rangeParams.gt = gt;
  if (lt !== undefined) rangeParams.lt = lt;
  
  return {
    [QueryType.RANGE]: {
      [field]: rangeParams
    }
  };
}

/**
 * Creates a wildcard query
 * @param field Field to match
 * @param value Wildcard pattern
 * @returns Wildcard query object
 */
export function createWildcardQuery(field: string, value: string): BaseQuery {
  return {
    [QueryType.WILDCARD]: {
      [field]: value
    }
  };
}

/**
 * Creates a query string query
 * @param queryString Query string
 * @param fields Optional array of fields to search
 * @returns Query string query object
 */
export function createQueryStringQuery(
  queryString: string,
  fields?: string[]
): BaseQuery {
  const query: any = {
    [QueryType.QUERY_STRING]: {
      query: queryString
    }
  };
  
  if (fields && fields.length > 0) {
    query[QueryType.QUERY_STRING].fields = fields;
  }
  
  return query;
}

/**
 * Creates an exists query
 * @param field Field that must exist
 * @returns Exists query object
 */
export function createExistsQuery(field: string): BaseQuery {
  return {
    [QueryType.EXISTS]: {
      field
    }
  };
}

/**
 * Creates a bool query
 * @param params Bool query parameters
 * @returns Bool query object
 */
export function createBoolQuery(params: {
  must?: BaseQuery[];
  mustNot?: BaseQuery[];
  should?: BaseQuery[];
  filter?: BaseQuery[];
  minimumShouldMatch?: number;
}): BoolQuery {
  const boolQuery: BoolQuery = { bool: {} };
  
  if (params.must && params.must.length > 0) {
    boolQuery.bool.must = params.must;
  }
  
  if (params.mustNot && params.mustNot.length > 0) {
    boolQuery.bool.must_not = params.mustNot;
  }
  
  if (params.should && params.should.length > 0) {
    boolQuery.bool.should = params.should;
  }
  
  if (params.filter && params.filter.length > 0) {
    boolQuery.bool.filter = params.filter;
  }
  
  if (params.minimumShouldMatch !== undefined) {
    boolQuery.bool.minimum_should_match = params.minimumShouldMatch;
  }
  
  return boolQuery;
}

/**
 * Creates a time range query for the specified field
 * @param field Timestamp field
 * @param timeRange Time range object
 * @returns Range query for the time field
 */
export function createTimeRangeQuery(
  field: string,
  timeRange: TimeRange
): BaseQuery {
  return createRangeQuery(
    field,
    timeRange.startTime,
    timeRange.endTime
  );
}

/**
 * Creates a service filter query with support for wildcards
 * @param serviceField Field containing the service name
 * @param serviceName Service name or pattern
 * @returns Query for filtering by service
 */
export function createServiceQuery(
  serviceField: string,
  serviceName: string
): BaseQuery {
  // If serviceName contains wildcard characters, use wildcard query
  if (serviceName.includes('*')) {
    return createWildcardQuery(serviceField, serviceName);
  }
  
  // If no wildcards, check if it's a partial match request
  if (!serviceName.startsWith('*') && !serviceName.endsWith('*')) {
    // For exact matches, use term query for better performance
    return createTermQuery(serviceField, serviceName);
  }
  
  // For other cases, use query_string for flexibility
  return createQueryStringQuery(`${serviceField}:${serviceName}`);
}

/**
 * Creates a paginated query
 * @param baseQuery Base query to paginate
 * @param size Number of results per page
 * @param from Starting offset
 * @param sort Sort criteria
 * @param source Fields to include in _source
 * @returns Paginated query
 */
export function createPaginatedQuery(
  baseQuery: BaseQuery,
  size?: number,
  from?: number,
  sort?: any[],
  source?: string[] | boolean
): PaginatedQuery {
  const query: PaginatedQuery = { ...baseQuery };
  
  if (size !== undefined) {
    query.size = size;
  }
  
  if (from !== undefined) {
    query.from = from;
  }
  
  if (sort) {
    query.sort = sort;
  }
  
  if (source !== undefined) {
    query._source = source;
  }
  
  // Always track total hits for accurate pagination
  query.track_total_hits = true;
  
  return query;
}

/**
 * Creates an aggregation query
 * @param baseQuery Base query
 * @param aggregations Aggregation definitions
 * @returns Query with aggregations
 */
export function createAggregationQuery(
  baseQuery: BaseQuery,
  aggregations: Record<string, any>
): BaseQuery {
  return {
    ...baseQuery,
    size: 0, // Set size to 0 for pure aggregation queries
    aggs: aggregations
  };
}

/**
 * Creates a runtime field definition
 * @param fieldName Runtime field name
 * @param type Field type
 * @param script Painless script
 * @returns Runtime field definition
 */
export function createRuntimeField(
  fieldName: string,
  type: string,
  script: string
): Record<string, any> {
  return {
    [fieldName]: {
      type,
      script: {
        source: script
      }
    }
  };
}

/**
 * Creates a complete query with runtime fields
 * @param baseQuery Base query
 * @param runtimeFields Runtime field definitions
 * @returns Query with runtime fields
 */
export function createQueryWithRuntimeFields(
  baseQuery: BaseQuery,
  runtimeFields: Record<string, any>
): BaseQuery {
  return {
    ...baseQuery,
    runtime_mappings: runtimeFields
  };
}

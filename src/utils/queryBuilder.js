"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryType = void 0;
exports.createMatchQuery = createMatchQuery;
exports.createMatchPhraseQuery = createMatchPhraseQuery;
exports.createTermQuery = createTermQuery;
exports.createTermsQuery = createTermsQuery;
exports.createRangeQuery = createRangeQuery;
exports.createWildcardQuery = createWildcardQuery;
exports.createQueryStringQuery = createQueryStringQuery;
exports.createExistsQuery = createExistsQuery;
exports.createBoolQuery = createBoolQuery;
exports.createTimeRangeQuery = createTimeRangeQuery;
exports.createServiceQuery = createServiceQuery;
exports.createPaginatedQuery = createPaginatedQuery;
exports.createAggregationQuery = createAggregationQuery;
exports.createRuntimeField = createRuntimeField;
exports.createQueryWithRuntimeFields = createQueryWithRuntimeFields;
/**
 * Common query types used across the codebase
 */
var QueryType;
(function (QueryType) {
    QueryType["MATCH"] = "match";
    QueryType["MATCH_PHRASE"] = "match_phrase";
    QueryType["TERM"] = "term";
    QueryType["TERMS"] = "terms";
    QueryType["RANGE"] = "range";
    QueryType["WILDCARD"] = "wildcard";
    QueryType["QUERY_STRING"] = "query_string";
    QueryType["BOOL"] = "bool";
    QueryType["EXISTS"] = "exists";
})(QueryType || (exports.QueryType = QueryType = {}));
/**
 * Creates a match query
 * @param field Field to match
 * @param value Value to match
 * @returns Match query object
 */
function createMatchQuery(field, value) {
    var _a, _b;
    return _a = {},
        _a[QueryType.MATCH] = (_b = {},
            _b[field] = value,
            _b),
        _a;
}
/**
 * Creates a match phrase query
 * @param field Field to match
 * @param value Phrase to match
 * @returns Match phrase query object
 */
function createMatchPhraseQuery(field, value) {
    var _a, _b;
    return _a = {},
        _a[QueryType.MATCH_PHRASE] = (_b = {},
            _b[field] = value,
            _b),
        _a;
}
/**
 * Creates a term query
 * @param field Field to match
 * @param value Exact value to match
 * @returns Term query object
 */
function createTermQuery(field, value) {
    var _a, _b;
    return _a = {},
        _a[QueryType.TERM] = (_b = {},
            _b[field] = value,
            _b),
        _a;
}
/**
 * Creates a terms query
 * @param field Field to match
 * @param values Array of values to match
 * @returns Terms query object
 */
function createTermsQuery(field, values) {
    var _a, _b;
    return _a = {},
        _a[QueryType.TERMS] = (_b = {},
            _b[field] = values,
            _b),
        _a;
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
function createRangeQuery(field, gte, lte, gt, lt) {
    var _a, _b;
    var rangeParams = {};
    if (gte !== undefined)
        rangeParams.gte = gte;
    if (lte !== undefined)
        rangeParams.lte = lte;
    if (gt !== undefined)
        rangeParams.gt = gt;
    if (lt !== undefined)
        rangeParams.lt = lt;
    return _a = {},
        _a[QueryType.RANGE] = (_b = {},
            _b[field] = rangeParams,
            _b),
        _a;
}
/**
 * Creates a wildcard query
 * @param field Field to match
 * @param value Wildcard pattern
 * @returns Wildcard query object
 */
function createWildcardQuery(field, value) {
    var _a, _b;
    return _a = {},
        _a[QueryType.WILDCARD] = (_b = {},
            _b[field] = value,
            _b),
        _a;
}
/**
 * Creates a query string query
 * @param queryString Query string
 * @param fields Optional array of fields to search
 * @returns Query string query object
 */
function createQueryStringQuery(queryString, fields) {
    var _a;
    var query = (_a = {},
        _a[QueryType.QUERY_STRING] = {
            query: queryString
        },
        _a);
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
function createExistsQuery(field) {
    var _a;
    return _a = {},
        _a[QueryType.EXISTS] = {
            field: field
        },
        _a;
}
/**
 * Creates a bool query
 * @param params Bool query parameters
 * @returns Bool query object
 */
function createBoolQuery(params) {
    var boolQuery = { bool: {} };
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
function createTimeRangeQuery(field, timeRange) {
    return createRangeQuery(field, timeRange.startTime, timeRange.endTime);
}
/**
 * Creates a service filter query with support for wildcards
 * @param serviceField Field containing the service name
 * @param serviceName Service name or pattern
 * @returns Query for filtering by service
 */
function createServiceQuery(serviceField, serviceName) {
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
    return createQueryStringQuery("".concat(serviceField, ":").concat(serviceName));
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
function createPaginatedQuery(baseQuery, size, from, sort, source) {
    var query = __assign({}, baseQuery);
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
function createAggregationQuery(baseQuery, aggregations) {
    return __assign(__assign({}, baseQuery), { size: 0, aggs: aggregations });
}
/**
 * Creates a runtime field definition
 * @param fieldName Runtime field name
 * @param type Field type
 * @param script Painless script
 * @returns Runtime field definition
 */
function createRuntimeField(fieldName, type, script) {
    var _a;
    return _a = {},
        _a[fieldName] = {
            type: type,
            script: {
                source: script
            }
        },
        _a;
}
/**
 * Creates a complete query with runtime fields
 * @param baseQuery Base query
 * @param runtimeFields Runtime field definitions
 * @returns Query with runtime fields
 */
function createQueryWithRuntimeFields(baseQuery, runtimeFields) {
    return __assign(__assign({}, baseQuery), { runtime_mappings: runtimeFields });
}

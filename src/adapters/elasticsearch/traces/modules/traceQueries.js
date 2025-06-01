"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceQueries = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
var traceCore_js_1 = require("./traceCore.js");
var traceScripts_js_1 = require("../../scripts/traces/traceScripts.js");
/**
 * Functionality for querying trace data
 */
var TraceQueries = /** @class */ (function (_super) {
    __extends(TraceQueries, _super);
    function TraceQueries() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /**
     * Execute a query against the traces index
     */
    TraceQueries.prototype.queryTraces = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var searchQuery, response, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        // Ensure we have a query object
                        if (!query) {
                            query = { query: { match_all: {} } };
                        }
                        // If a search string is provided, convert it to a query_string query
                        if (query.search && typeof query.search === 'string') {
                            searchQuery = {
                                query_string: {
                                    query: query.search,
                                    default_operator: 'AND',
                                    fields: [
                                        'trace_id^5',
                                        'span_id^5',
                                        'name^4',
                                        'resource.attributes.service.name^4',
                                        'Resource.service.name^4',
                                        'service.name^4',
                                        'attributes.*^3',
                                        'Attributes.*^3',
                                        'status.code^2',
                                        'Status.Code^2',
                                        '*'
                                    ]
                                }
                            };
                            // Replace the query with the query_string
                            query.query = searchQuery;
                            delete query.search;
                        }
                        // Set reasonable defaults
                        if (!query.size) {
                            query.size = 20;
                        }
                        // Execute the query
                        logger_js_1.logger.debug('[ES Adapter] Executing trace query', { query: query });
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _a.sent();
                        return [2 /*return*/, response];
                    case 2:
                        error_1 = _a.sent();
                        logger_js_1.logger.error('[ES Adapter] Error executing trace query', {
                            error: error_1 instanceof Error ? error_1.message : String(error_1),
                            stack: error_1 instanceof Error ? error_1.stack : undefined,
                            query: query
                        });
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get a list of services from trace data
     */
    TraceQueries.prototype.getServices = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response, services, _i, _a, bucket, serviceName, versions, _b, _c, versionBucket, error_2;
            var _d, _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        _g.trys.push([0, 2, , 3]);
                        query = {
                            size: 0,
                            aggs: {
                                services: {
                                    terms: {
                                        script: {
                                            source: traceScripts_js_1.getServiceName
                                        },
                                        size: 100
                                    },
                                    aggs: {
                                        versions: {
                                            terms: {
                                                script: {
                                                    source: traceScripts_js_1.getServiceVersion
                                                },
                                                size: 20
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        // Add time range if provided
                        if (startTime || endTime) {
                            query.query = {
                                bool: {
                                    filter: []
                                }
                            };
                            if (startTime) {
                                query.query.bool.filter.push({
                                    range: {
                                        '@timestamp': {
                                            gte: new Date(startTime).toISOString()
                                        }
                                    }
                                });
                            }
                            if (endTime) {
                                query.query.bool.filter.push({
                                    range: {
                                        '@timestamp': {
                                            lte: new Date(endTime).toISOString()
                                        }
                                    }
                                });
                            }
                        }
                        // Add search filter if provided
                        if (search) {
                            if (!query.query) {
                                query.query = { bool: { filter: [] } };
                            }
                            query.query.bool.filter.push({
                                bool: {
                                    should: [
                                        { wildcard: { 'resource.attributes.service.name': "*".concat(search, "*") } },
                                        { wildcard: { 'Resource.service.name': "*".concat(search, "*") } },
                                        { wildcard: { 'service.name': "*".concat(search, "*") } }
                                    ],
                                    minimum_should_match: 1
                                }
                            });
                        }
                        // Execute the query
                        logger_js_1.logger.debug('[ES Adapter] Getting services from traces', { query: query });
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _g.sent();
                        services = [];
                        if ((_e = (_d = response.aggregations) === null || _d === void 0 ? void 0 : _d.services) === null || _e === void 0 ? void 0 : _e.buckets) {
                            for (_i = 0, _a = response.aggregations.services.buckets; _i < _a.length; _i++) {
                                bucket = _a[_i];
                                serviceName = bucket.key;
                                versions = [];
                                // Add versions
                                if ((_f = bucket.versions) === null || _f === void 0 ? void 0 : _f.buckets) {
                                    for (_b = 0, _c = bucket.versions.buckets; _b < _c.length; _b++) {
                                        versionBucket = _c[_b];
                                        if (versionBucket.key !== 'unknown') {
                                            versions.push(versionBucket.key);
                                        }
                                    }
                                }
                                services.push({
                                    name: serviceName,
                                    versions: versions
                                });
                            }
                        }
                        return [2 /*return*/, services];
                    case 2:
                        error_2 = _g.sent();
                        logger_js_1.logger.error('[ES Adapter] Error getting services from traces', {
                            error: error_2 instanceof Error ? error_2.message : String(error_2),
                            stack: error_2 instanceof Error ? error_2.stack : undefined
                        });
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get operations for a specific service
     */
    TraceQueries.prototype.getOperations = function (service) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response, operations, _i, _a, bucket, error_3;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        query = {
                            size: 0,
                            query: {
                                bool: {
                                    should: [
                                        { term: { 'resource.attributes.service.name': service } },
                                        { term: { 'Resource.service.name': service } },
                                        { term: { 'service.name': service } }
                                    ],
                                    minimum_should_match: 1
                                }
                            },
                            aggs: {
                                operations: {
                                    terms: {
                                        field: 'name',
                                        size: 100
                                    }
                                }
                            }
                        };
                        // Execute the query
                        logger_js_1.logger.debug('[ES Adapter] Getting operations for service', { service: service, query: query });
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _d.sent();
                        operations = [];
                        if ((_c = (_b = response.aggregations) === null || _b === void 0 ? void 0 : _b.operations) === null || _c === void 0 ? void 0 : _c.buckets) {
                            for (_i = 0, _a = response.aggregations.operations.buckets; _i < _a.length; _i++) {
                                bucket = _a[_i];
                                operations.push(bucket.key);
                            }
                        }
                        return [2 /*return*/, operations];
                    case 2:
                        error_3 = _d.sent();
                        logger_js_1.logger.error('[ES Adapter] Error getting operations for service', {
                            error: error_3 instanceof Error ? error_3.message : String(error_3),
                            stack: error_3 instanceof Error ? error_3.stack : undefined,
                            service: service
                        });
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return TraceQueries;
}(traceCore_js_1.TraceCore));
exports.TraceQueries = TraceQueries;

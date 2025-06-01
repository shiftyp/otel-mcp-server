"use strict";
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
exports.MetricQueryModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
/**
 * Module for direct metric querying functionality
 */
var MetricQueryModule = /** @class */ (function () {
    function MetricQueryModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * Execute a direct query against metric indices
     * @param query Elasticsearch query object
     * @returns Query results
     */
    MetricQueryModule.prototype.queryMetrics = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var indexPattern, response, error_1;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] queryMetrics called');
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 3, , 4]);
                        indexPattern = '.ds-metrics-*,metrics*,*metrics*,otel-metric*';
                        // Add default sort by timestamp if not specified
                        if (!query.sort) {
                            query.sort = [{ '@timestamp': { order: 'desc' } }];
                        }
                        // Execute the query
                        logger_js_1.logger.debug('[ES Adapter] Executing direct metric query', {
                            indexPattern: indexPattern,
                            querySize: query.size || 'default',
                            queryFrom: query.from || 'default'
                        });
                        return [4 /*yield*/, this.esCore.callEsRequest('POST', "".concat(indexPattern, "/_search"), query)];
                    case 2:
                        response = _e.sent();
                        // Log the response size
                        logger_js_1.logger.info('[ES Adapter] Metric query returned results', {
                            totalHits: ((_b = (_a = response.hits) === null || _a === void 0 ? void 0 : _a.total) === null || _b === void 0 ? void 0 : _b.value) || 0,
                            returnedHits: ((_d = (_c = response.hits) === null || _c === void 0 ? void 0 : _c.hits) === null || _d === void 0 ? void 0 : _d.length) || 0
                        });
                        return [2 /*return*/, response];
                    case 3:
                        error_1 = _e.sent();
                        logger_js_1.logger.error('[ES Adapter] Error executing metric query', { error: error_1 });
                        throw error_1;
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Count metrics matching a query
     * @param query Elasticsearch query object
     * @returns Count result
     */
    MetricQueryModule.prototype.countMetrics = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var indexPattern, countQuery, response, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] countMetrics called');
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        indexPattern = '.ds-metrics-*,metrics*,*metrics*,otel-metric*';
                        countQuery = { query: query.query };
                        logger_js_1.logger.debug('[ES Adapter] Executing metric count query');
                        return [4 /*yield*/, this.esCore.callEsRequest('POST', "".concat(indexPattern, "/_count"), countQuery)];
                    case 2:
                        response = _a.sent();
                        // Return the count
                        logger_js_1.logger.info('[ES Adapter] Metric count query returned', { count: response.count });
                        return [2 /*return*/, response.count || 0];
                    case 3:
                        error_2 = _a.sent();
                        logger_js_1.logger.error('[ES Adapter] Error executing metric count query', { error: error_2 });
                        return [2 /*return*/, 0];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get a sample of metrics for exploration
     * @param size Number of metrics to sample
     * @returns Sample of metrics
     */
    MetricQueryModule.prototype.sampleMetrics = function () {
        return __awaiter(this, arguments, void 0, function (size) {
            var query;
            if (size === void 0) { size = 10; }
            return __generator(this, function (_a) {
                logger_js_1.logger.info('[ES Adapter] sampleMetrics called', { size: size });
                query = {
                    size: size,
                    query: {
                        function_score: {
                            query: { match_all: {} },
                            random_score: {}
                        }
                    }
                };
                return [2 /*return*/, this.queryMetrics(query)];
            });
        });
    };
    /**
     * Get available metric names
     * @param service Optional service name to filter by
     * @returns Array of metric names with counts
     */
    MetricQueryModule.prototype.getMetricNames = function (service) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response, metricNames, error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] getMetricNames called', { service: service });
                        query = {
                            size: 0,
                            query: {
                                bool: {
                                    must: []
                                }
                            },
                            aggs: {
                                metric_names: {
                                    terms: {
                                        field: 'name',
                                        size: 1000,
                                        order: { '_count': 'desc' }
                                    }
                                }
                            }
                        };
                        // Add service filter if provided
                        if (service) {
                            query.query.bool.must.push({
                                bool: {
                                    should: [
                                        { term: { 'resource.service.name': service } },
                                        { term: { 'service.name': service } },
                                        { term: { 'Resource.attributes.service.name': service } },
                                        { term: { 'resource.attributes.service.name': service } }
                                    ],
                                    minimum_should_match: 1
                                }
                            });
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.queryMetrics(query)];
                    case 2:
                        response = _a.sent();
                        // Process the results
                        if (!response.aggregations || !response.aggregations.metric_names || !response.aggregations.metric_names.buckets) {
                            return [2 /*return*/, []];
                        }
                        metricNames = response.aggregations.metric_names.buckets.map(function (bucket) { return ({
                            name: bucket.key,
                            count: bucket.doc_count
                        }); });
                        logger_js_1.logger.info('[ES Adapter] Returning metric names', { count: metricNames.length });
                        return [2 /*return*/, metricNames];
                    case 3:
                        error_3 = _a.sent();
                        logger_js_1.logger.error('[ES Adapter] Error getting metric names', { error: error_3 });
                        return [2 /*return*/, []];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return MetricQueryModule;
}());
exports.MetricQueryModule = MetricQueryModule;

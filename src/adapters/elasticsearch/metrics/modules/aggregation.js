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
exports.MetricAggregationModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
/**
 * Module for metric aggregation functionality
 */
var MetricAggregationModule = /** @class */ (function () {
    function MetricAggregationModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * Aggregate metrics over a time range
     * @param options Aggregation options
     * @returns Aggregated metrics data
     */
    MetricAggregationModule.prototype.aggregateOtelMetricsRange = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var metricName, service, startTime, endTime, _a, interval, _b, percentiles, _c, dimensions, _d, filters, esQuery, _i, _e, _f, key, value, aggs, _g, dimensions_1, dimension, searchRequest, response, buckets, error_1;
            var _h;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] aggregateOtelMetricsRange called', { options: options });
                        metricName = options.metricName, service = options.service, startTime = options.startTime, endTime = options.endTime, _a = options.interval, interval = _a === void 0 ? '1m' : _a, _b = options.percentiles, percentiles = _b === void 0 ? [50, 95, 99] : _b, _c = options.dimensions, dimensions = _c === void 0 ? [] : _c, _d = options.filters, filters = _d === void 0 ? {} : _d;
                        esQuery = {
                            bool: {
                                must: [
                                    // Match the metric name
                                    {
                                        bool: {
                                            should: [
                                                { term: { 'name': metricName } },
                                                { term: { 'metric.name': metricName } },
                                                { term: { 'metricset.name': metricName } }
                                            ],
                                            minimum_should_match: 1
                                        }
                                    },
                                    // Add time range filter
                                    {
                                        range: {
                                            '@timestamp': {
                                                gte: startTime,
                                                lte: endTime
                                            }
                                        }
                                    }
                                ]
                            }
                        };
                        // Add service filter if provided
                        if (service) {
                            esQuery.bool.must.push({
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
                        // Add custom filters if provided
                        for (_i = 0, _e = Object.entries(filters); _i < _e.length; _i++) {
                            _f = _e[_i], key = _f[0], value = _f[1];
                            esQuery.bool.must.push({
                                term: (_h = {}, _h[key] = value, _h)
                            });
                        }
                        aggs = {
                            // Time-based histogram
                            time_buckets: {
                                date_histogram: {
                                    field: '@timestamp',
                                    fixed_interval: interval
                                },
                                aggs: {
                                    // Basic stats
                                    metric_stats: {
                                        stats: {
                                            field: 'value'
                                        }
                                    }
                                }
                            }
                        };
                        // Add percentiles if requested
                        if (percentiles && percentiles.length > 0) {
                            aggs.time_buckets.aggs.metric_percentiles = {
                                percentiles: {
                                    field: 'value',
                                    percents: percentiles
                                }
                            };
                        }
                        // Add dimension aggregations if requested
                        if (dimensions && dimensions.length > 0) {
                            for (_g = 0, dimensions_1 = dimensions; _g < dimensions_1.length; _g++) {
                                dimension = dimensions_1[_g];
                                aggs.time_buckets.aggs["dimension_".concat(dimension)] = {
                                    terms: {
                                        field: dimension,
                                        size: 10
                                    }
                                };
                            }
                        }
                        searchRequest = {
                            index: '.ds-metrics-*,metrics*,*metrics*,otel-metric*',
                            body: {
                                size: 0, // We only need aggregations
                                query: esQuery,
                                aggs: aggs
                            }
                        };
                        _j.label = 1;
                    case 1:
                        _j.trys.push([1, 3, , 4]);
                        // Execute the search
                        logger_js_1.logger.debug('[ES Adapter] Executing metrics aggregation', { request: JSON.stringify(searchRequest) });
                        return [4 /*yield*/, this.esCore.callEsRequest('POST', "".concat(searchRequest.index, "/_search"), searchRequest.body)];
                    case 2:
                        response = _j.sent();
                        // Process the results
                        if (!response.aggregations || !response.aggregations.time_buckets || !response.aggregations.time_buckets.buckets) {
                            logger_js_1.logger.info('[ES Adapter] No metrics found for aggregation');
                            return [2 /*return*/, {
                                    metricName: metricName,
                                    service: service,
                                    timeRange: { start: startTime, end: endTime },
                                    interval: interval,
                                    buckets: []
                                }];
                        }
                        buckets = response.aggregations.time_buckets.buckets.map(function (bucket) {
                            var result = {
                                timestamp: bucket.key_as_string || new Date(bucket.key).toISOString(),
                                value: bucket.metric_stats.avg || 0,
                                count: bucket.metric_stats.count || 0,
                                min: bucket.metric_stats.min,
                                max: bucket.metric_stats.max,
                                avg: bucket.metric_stats.avg,
                                sum: bucket.metric_stats.sum
                            };
                            // Add percentiles if available
                            if (bucket.metric_percentiles && bucket.metric_percentiles.values) {
                                result.percentiles = {};
                                for (var _i = 0, percentiles_1 = percentiles; _i < percentiles_1.length; _i++) {
                                    var percentile = percentiles_1[_i];
                                    var key = percentile.toString();
                                    result.percentiles[key] = bucket.metric_percentiles.values[key];
                                }
                            }
                            // Add dimensions if available
                            if (dimensions && dimensions.length > 0) {
                                result.dimensions = {};
                                for (var _a = 0, dimensions_2 = dimensions; _a < dimensions_2.length; _a++) {
                                    var dimension = dimensions_2[_a];
                                    var dimensionAgg = bucket["dimension_".concat(dimension)];
                                    if (dimensionAgg && dimensionAgg.buckets && dimensionAgg.buckets.length > 0) {
                                        result.dimensions[dimension] = dimensionAgg.buckets.map(function (dimBucket) { return ({
                                            key: dimBucket.key,
                                            count: dimBucket.doc_count
                                        }); });
                                    }
                                }
                            }
                            return result;
                        });
                        logger_js_1.logger.info('[ES Adapter] Returning aggregated metrics', {
                            metricName: metricName,
                            service: service,
                            bucketCount: buckets.length
                        });
                        return [2 /*return*/, {
                                metricName: metricName,
                                service: service,
                                timeRange: { start: startTime, end: endTime },
                                interval: interval,
                                buckets: buckets
                            }];
                    case 3:
                        error_1 = _j.sent();
                        logger_js_1.logger.error('[ES Adapter] Error aggregating metrics', { error: error_1 });
                        return [2 /*return*/, {
                                metricName: metricName,
                                service: service,
                                timeRange: { start: startTime, end: endTime },
                                interval: interval,
                                buckets: []
                            }];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return MetricAggregationModule;
}());
exports.MetricAggregationModule = MetricAggregationModule;

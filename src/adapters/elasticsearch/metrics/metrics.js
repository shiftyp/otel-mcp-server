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
exports.MetricsAdapter = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var index_js_1 = require("./modules/index.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
var serviceResolver_js_1 = require("../../../utils/serviceResolver.js");
/**
 * Adapter for interacting with metrics in Elasticsearch
 * This class delegates functionality to specialized modules
 */
var MetricsAdapter = /** @class */ (function (_super) {
    __extends(MetricsAdapter, _super);
    function MetricsAdapter(options) {
        var _this = _super.call(this, options) || this;
        // Initialize modules
        _this.fieldsModule = new index_js_1.MetricFieldsModule(_this);
        _this.aggregationModule = new index_js_1.MetricAggregationModule(_this);
        _this.queryModule = new index_js_1.MetricQueryModule(_this);
        logger_js_1.logger.info('[MetricsAdapter] Initialized with modules');
        return _this;
    }
    /**
     * List all metric fields and their types from metrics indices
     * @returns Array of { name, type }
     */
    MetricsAdapter.prototype.listMetricFields = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.fieldsModule.listMetricFields()];
            });
        });
    };
    /**
     * Aggregate metrics over a time range
     * @param options Aggregation options
     * @returns Aggregated metrics data
     */
    MetricsAdapter.prototype.aggregateOtelMetricsRange = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.aggregationModule.aggregateOtelMetricsRange(options)];
            });
        });
    };
    /**
     * Execute a direct query against metric indices
     * @param query Elasticsearch query object
     * @returns Query results
     */
    MetricsAdapter.prototype.queryMetrics = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.queryMetrics(query)];
            });
        });
    };
    /**
     * Get metrics for a specific service
     * @param service Service name to get metrics for
     * @param startTime Start time in ISO format
     * @param endTime End time in ISO format
     * @param maxResults Maximum number of results to return
     * @returns Array of metrics for the service
     */
    MetricsAdapter.prototype.getMetricsForService = function (service_1, startTime_1, endTime_1) {
        return __awaiter(this, arguments, void 0, function (service, startTime, endTime, maxResults) {
            var serviceQuery, timeRangeFilter, query, result, error_1;
            if (maxResults === void 0) { maxResults = 100; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        logger_js_1.logger.debug("[MetricsAdapter] Getting metrics for service ".concat(service));
                        if (!service) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Service name is required')];
                        }
                        serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(service, 'METRICS', { allowWildcards: true });
                        if ((0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                            return [2 /*return*/, serviceQuery];
                        }
                        timeRangeFilter = (0, queryBuilder_js_1.createRangeQuery)('@timestamp', startTime, endTime);
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({
                                must: [serviceQuery],
                                filter: [timeRangeFilter]
                            }),
                            size: maxResults,
                            sort: [{ '@timestamp': { order: 'desc' } }]
                        };
                        return [4 /*yield*/, this.queryMetrics(query)];
                    case 1:
                        result = _a.sent();
                        if (!result || !result.hits || !result.hits.hits) {
                            return [2 /*return*/, []];
                        }
                        // Extract and return metric entries
                        return [2 /*return*/, result.hits.hits.map(function (hit) {
                                var _a, _b, _c, _d, _e;
                                var source = hit._source;
                                return {
                                    id: hit._id,
                                    timestamp: source['@timestamp'],
                                    service: ((_b = (_a = source.Resource) === null || _a === void 0 ? void 0 : _a.service) === null || _b === void 0 ? void 0 : _b.name) || ((_c = source.service) === null || _c === void 0 ? void 0 : _c.name) || 'unknown',
                                    name: source.name || source.Name || source.metric_name || 'unknown',
                                    value: source.value || source.Value || ((_d = source.gauge) === null || _d === void 0 ? void 0 : _d.value) || ((_e = source.sum) === null || _e === void 0 ? void 0 : _e.value) || 0,
                                    unit: source.unit || source.Unit || '',
                                    attributes: source.Attributes || source.attributes || {}
                                };
                            })];
                    case 2:
                        error_1 = _a.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting metrics for service: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Search metrics with a custom query (required by BaseSearchAdapter)
     * @param query The query to execute
     * @returns Search results
     */
    MetricsAdapter.prototype.searchMetrics = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                logger_js_1.logger.info('[MetricsAdapter] Searching metrics with query', { query: query });
                return [2 /*return*/, this.queryModule.queryMetrics(query)];
            });
        });
    };
    /**
     * Count metrics matching a query
     * @param query Elasticsearch query object
     * @returns Count result
     */
    MetricsAdapter.prototype.countMetrics = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.countMetrics(query)];
            });
        });
    };
    /**
     * Get a sample of metrics for exploration
     * @param size Number of metrics to sample
     * @returns Sample of metrics
     */
    MetricsAdapter.prototype.sampleMetrics = function () {
        return __awaiter(this, arguments, void 0, function (size) {
            if (size === void 0) { size = 10; }
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.sampleMetrics(size)];
            });
        });
    };
    /**
     * Get available metric names
     * @param service Optional service name to filter by
     * @returns Array of metric names with counts
     */
    MetricsAdapter.prototype.getMetricNames = function (service) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.getMetricNames(service)];
            });
        });
    };
    return MetricsAdapter;
}(core_js_1.ElasticsearchCore));
exports.MetricsAdapter = MetricsAdapter;

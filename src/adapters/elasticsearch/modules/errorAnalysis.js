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
exports.ErrorAnalysis = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
var serviceResolver_js_1 = require("../../../utils/serviceResolver.js");
var timeRangeParser_js_1 = require("../../../utils/timeRangeParser.js");
/**
 * Error analysis functionality for the Elasticsearch Adapter
 */
var ErrorAnalysis = /** @class */ (function () {
    function ErrorAnalysis(options) {
        this.coreAdapter = new core_js_1.ElasticsearchCore(options);
    }
    /**
     * Get top errors for a time range
     * @param options Options for the query
     * @returns List of top errors with counts and examples
     */
    ErrorAnalysis.prototype.topErrors = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, endTime, _a, limit, service, _b, includeExamples_1, timeRange, must, serviceQuery, aggs, query, result, errorMessage, errorBuckets, error_1;
            var _c, _d, _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        _f.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[ErrorAnalysis] Getting top errors', options);
                        startTime = options.startTime, endTime = options.endTime, _a = options.limit, limit = _a === void 0 ? 10 : _a, service = options.service, _b = options.includeExamples, includeExamples_1 = _b === void 0 ? false : _b;
                        // Validate parameters
                        if (!startTime || !endTime) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Start time and end time are required')];
                        }
                        timeRange = (0, timeRangeParser_js_1.parseTimeRange)(startTime, endTime);
                        if ((0, errorHandling_js_1.isErrorResponse)(timeRange)) {
                            return [2 /*return*/, timeRange];
                        }
                        must = [
                            (0, queryBuilder_js_1.createRangeQuery)('@timestamp', timeRange.startTime, timeRange.endTime),
                            {
                                exists: {
                                    field: 'exception.message'
                                }
                            }
                        ];
                        // Add service filter if provided
                        if (service) {
                            serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(service, 'LOGS');
                            if (!(0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                                must.push(serviceQuery);
                            }
                        }
                        aggs = {
                            errors: {
                                terms: {
                                    field: 'exception.message.keyword',
                                    size: limit
                                },
                                aggs: {
                                    services: {
                                        terms: {
                                            field: 'Resource.service.name',
                                            size: 1
                                        }
                                    },
                                    examples: {
                                        top_hits: {
                                            size: includeExamples_1 ? 3 : 0,
                                            _source: [
                                                '@timestamp',
                                                'message',
                                                'trace_id',
                                                'Resource.service.name'
                                            ]
                                        }
                                    }
                                }
                            }
                        };
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({ must: must }),
                            size: 0,
                            aggs: aggs
                        };
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-logs-*/_search', query)];
                    case 1:
                        result = _f.sent();
                        if (!result || result.error) {
                            errorMessage = ((_c = result === null || result === void 0 ? void 0 : result.error) === null || _c === void 0 ? void 0 : _c.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting top errors: ".concat(errorMessage))];
                        }
                        errorBuckets = ((_e = (_d = result.aggregations) === null || _d === void 0 ? void 0 : _d.errors) === null || _e === void 0 ? void 0 : _e.buckets) || [];
                        return [2 /*return*/, errorBuckets.map(function (bucket) {
                                var _a, _b, _c, _d;
                                var serviceBucket = (_b = (_a = bucket.services) === null || _a === void 0 ? void 0 : _a.buckets) === null || _b === void 0 ? void 0 : _b[0];
                                var serviceValue = (serviceBucket === null || serviceBucket === void 0 ? void 0 : serviceBucket.key) || 'unknown';
                                var examples = includeExamples_1
                                    ? (((_d = (_c = bucket.examples) === null || _c === void 0 ? void 0 : _c.hits) === null || _d === void 0 ? void 0 : _d.hits) || []).map(function (hit) {
                                        var _a, _b;
                                        var source = hit._source;
                                        return {
                                            timestamp: source['@timestamp'],
                                            message: source.message,
                                            trace_id: source.trace_id,
                                            service: ((_b = (_a = source.Resource) === null || _a === void 0 ? void 0 : _a.service) === null || _b === void 0 ? void 0 : _b.name) || 'unknown'
                                        };
                                    })
                                    : undefined;
                                return {
                                    error: bucket.key,
                                    count: bucket.doc_count,
                                    service: serviceValue,
                                    examples: examples
                                };
                            })];
                    case 2:
                        error_1 = _f.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting top errors: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return ErrorAnalysis;
}());
exports.ErrorAnalysis = ErrorAnalysis;

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
exports.LogsAdapter = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var index_js_1 = require("./modules/index.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
/**
 * Adapter for interacting with logs in Elasticsearch
 * This class delegates functionality to specialized modules
 */
var LogsAdapter = /** @class */ (function (_super) {
    __extends(LogsAdapter, _super);
    function LogsAdapter(options) {
        var _this = _super.call(this, options) || this;
        // Initialize modules
        _this.fieldsModule = new index_js_1.LogFieldsModule(_this);
        _this.searchModule = new index_js_1.LogSearchModule(_this);
        _this.errorsModule = new index_js_1.LogErrorsModule(_this);
        _this.queryModule = new index_js_1.LogQueryModule(_this);
        logger_js_1.logger.info('[LogsAdapter] Initialized with modules');
        return _this;
    }
    /**
     * List all log fields and their types from logs indices
     * @param includeSourceDocument Whether to include fields from the _source document
     * @returns Array of { name, type, count, schema }
     */
    LogsAdapter.prototype.listLogFields = function () {
        return __awaiter(this, arguments, void 0, function (includeSourceDocument) {
            if (includeSourceDocument === void 0) { includeSourceDocument = true; }
            return __generator(this, function (_a) {
                return [2 /*return*/, this.fieldsModule.listLogFields(includeSourceDocument)];
            });
        });
    };
    /**
     * Search for logs with a flexible query structure
     * @param options Search options
     * @returns Array of log objects
     */
    LogsAdapter.prototype.searchOtelLogs = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.searchModule.searchOtelLogs(options)];
            });
        });
    };
    /**
     * Get top errors from logs
     * @param options Options for error analysis
     * @returns Array of top errors with counts and examples
     */
    LogsAdapter.prototype.topErrors = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.errorsModule.topErrors(options)];
            });
        });
    };
    /**
     * Execute a direct query against log indices
     * @param query Elasticsearch query object
     * @returns Query results
     */
    LogsAdapter.prototype.queryLogs = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.queryLogs(query)];
            });
        });
    };
    /**
     * Find logs by trace ID or span IDs
     * @param traceId Trace ID to search for
     * @param spanIds Array of span IDs to search for
     * @param startTime Start time in ISO format
     * @param endTime End time in ISO format
     * @param maxResults Maximum number of results to return
     * @returns Array of log entries related to the trace or spans
     */
    LogsAdapter.prototype.findLogsByTraceOrSpanIds = function (traceId_1, spanIds_1, startTime_1, endTime_1) {
        return __awaiter(this, arguments, void 0, function (traceId, spanIds, startTime, endTime, maxResults) {
            var should, timeRangeFilter, query, result, error_1;
            if (maxResults === void 0) { maxResults = 100; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        logger_js_1.logger.debug("[LogsAdapter] Finding logs for trace ".concat(traceId, " with ").concat(spanIds.length, " spans"));
                        if (!traceId && (!spanIds || spanIds.length === 0)) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Either traceId or spanIds must be provided')];
                        }
                        should = [];
                        // Add trace ID condition
                        if (traceId) {
                            should.push((0, queryBuilder_js_1.createTermsQuery)('TraceId', [traceId]));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('trace_id', [traceId]));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('Attributes.trace_id', [traceId]));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('attributes.trace_id', [traceId]));
                        }
                        // Add span IDs condition
                        if (spanIds && spanIds.length > 0) {
                            should.push((0, queryBuilder_js_1.createTermsQuery)('SpanId', spanIds));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('span_id', spanIds));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('Attributes.span_id', spanIds));
                            should.push((0, queryBuilder_js_1.createTermsQuery)('attributes.span_id', spanIds));
                        }
                        timeRangeFilter = (0, queryBuilder_js_1.createRangeQuery)('@timestamp', startTime, endTime);
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({
                                should: should,
                                filter: [timeRangeFilter],
                                minimumShouldMatch: 1
                            }),
                            size: maxResults,
                            sort: [{ '@timestamp': { order: 'asc' } }]
                        };
                        return [4 /*yield*/, this.queryLogs(query)];
                    case 1:
                        result = _a.sent();
                        if (!result || !result.hits || !result.hits.hits) {
                            return [2 /*return*/, []];
                        }
                        // Extract and return log entries
                        return [2 /*return*/, result.hits.hits.map(function (hit) {
                                var _a, _b, _c, _d, _e, _f, _g;
                                var source = hit._source;
                                return {
                                    id: hit._id,
                                    timestamp: source['@timestamp'],
                                    service: ((_b = (_a = source.Resource) === null || _a === void 0 ? void 0 : _a.service) === null || _b === void 0 ? void 0 : _b.name) || ((_c = source.service) === null || _c === void 0 ? void 0 : _c.name) || 'unknown',
                                    level: source.SeverityText || source.severityText || source.level || 'unknown',
                                    message: source.Body || source.body || source.message || '',
                                    trace_id: source.TraceId || source.trace_id || ((_d = source.Attributes) === null || _d === void 0 ? void 0 : _d.trace_id) || ((_e = source.attributes) === null || _e === void 0 ? void 0 : _e.trace_id),
                                    span_id: source.SpanId || source.span_id || ((_f = source.Attributes) === null || _f === void 0 ? void 0 : _f.span_id) || ((_g = source.attributes) === null || _g === void 0 ? void 0 : _g.span_id),
                                    attributes: source.Attributes || source.attributes || {}
                                };
                            })];
                    case 2:
                        error_1 = _a.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error finding logs by trace/span IDs: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Count logs matching a query
     * @param query Elasticsearch query object
     * @returns Count result
     */
    LogsAdapter.prototype.countLogs = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.countLogs(query)];
            });
        });
    };
    /**
     * Get a sample of logs for exploration
     * @param size Number of logs to sample
     * @returns Sample of logs
     */
    LogsAdapter.prototype.sampleLogs = function () {
        return __awaiter(this, arguments, void 0, function (size) {
            if (size === void 0) { size = 10; }
            return __generator(this, function (_a) {
                return [2 /*return*/, this.queryModule.sampleLogs(size)];
            });
        });
    };
    return LogsAdapter;
}(core_js_1.ElasticsearchCore));
exports.LogsAdapter = LogsAdapter;

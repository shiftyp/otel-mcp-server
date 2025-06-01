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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceAnalysis = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
/**
 * Trace analysis functionality for the Elasticsearch Adapter
 */
var TraceAnalysis = /** @class */ (function () {
    function TraceAnalysis(options) {
        this.coreAdapter = new core_js_1.ElasticsearchCore(options);
    }
    /**
     * Analyze a trace by its trace ID
     * @param traceId Trace ID to analyze
     * @returns Analyzed trace data with spans and critical path
     */
    TraceAnalysis.prototype.analyzeTrace = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, result, errorMessage, hits, spans, spanMap_1, _i, spans_1, span, rootSpan, spanTree, criticalPath, traceMetrics, error_1;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[TraceAnalysis] Analyzing trace', { traceId: traceId });
                        if (!traceId) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Trace ID is required')];
                        }
                        query = {
                            query: (0, queryBuilder_js_1.createTermQuery)('TraceId', traceId),
                            size: 10000,
                            sort: [
                                { '@timestamp': { order: 'asc' } }
                            ]
                        };
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _c.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error analyzing trace: ".concat(errorMessage))];
                        }
                        hits = ((_b = result.hits) === null || _b === void 0 ? void 0 : _b.hits) || [];
                        spans = hits.map(function (hit) { return hit._source; });
                        if (spans.length === 0) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("No spans found for trace ID: ".concat(traceId))];
                        }
                        spanMap_1 = new Map();
                        for (_i = 0, spans_1 = spans; _i < spans_1.length; _i++) {
                            span = spans_1[_i];
                            spanMap_1.set(span.SpanId, span);
                        }
                        rootSpan = spans.find(function (span) {
                            return !span.ParentSpanId || !spanMap_1.has(span.ParentSpanId);
                        });
                        if (!rootSpan) {
                            // If no clear root, use the earliest span
                            rootSpan = spans[0];
                        }
                        spanTree = this.buildSpanTree(spans);
                        criticalPath = this.findCriticalPath(spans, spanMap_1, rootSpan);
                        traceMetrics = this.calculateTraceMetrics(spans, rootSpan);
                        return [2 /*return*/, {
                                traceId: traceId,
                                rootSpan: rootSpan,
                                spans: spans,
                                spanTree: spanTree,
                                criticalPath: criticalPath,
                                metrics: traceMetrics
                            }];
                    case 2:
                        error_1 = _c.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error analyzing trace: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Lookup a span by its span ID
     * @param spanId Span ID to lookup
     * @returns Span data and its trace context
     */
    TraceAnalysis.prototype.spanLookup = function (spanId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, result, errorMessage, hits, span, traceId, traceContext, error_2;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 3, , 4]);
                        logger_js_1.logger.info('[TraceAnalysis] Looking up span', { spanId: spanId });
                        if (!spanId) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Span ID is required')];
                        }
                        query = {
                            query: (0, queryBuilder_js_1.createTermQuery)('SpanId', spanId),
                            size: 1
                        };
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _c.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error looking up span: ".concat(errorMessage))];
                        }
                        hits = ((_b = result.hits) === null || _b === void 0 ? void 0 : _b.hits) || [];
                        if (hits.length === 0) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("No span found with ID: ".concat(spanId))];
                        }
                        span = hits[0]._source;
                        traceId = span.TraceId;
                        return [4 /*yield*/, this.getTraceContext(traceId, spanId)];
                    case 2:
                        traceContext = _c.sent();
                        return [2 /*return*/, {
                                span: span,
                                traceContext: traceContext
                            }];
                    case 3:
                        error_2 = _c.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error looking up span: ".concat(error_2 instanceof Error ? error_2.message : String(error_2)))];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get trace context for a specific span
     * @param traceId Trace ID
     * @param spanId Span ID
     * @returns Trace context with parent and child spans
     */
    TraceAnalysis.prototype.getTraceContext = function (traceId, spanId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, result, errorMessage, hits, spans, spanMap, _i, spans_2, span, targetSpan, parentSpan, childSpans, error_3;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        _c.trys.push([0, 2, , 3]);
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({
                                must: [
                                    (0, queryBuilder_js_1.createTermQuery)('TraceId', traceId)
                                ]
                            }),
                            size: 1000,
                            sort: [
                                { '@timestamp': { order: 'asc' } }
                            ]
                        };
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _c.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting trace context: ".concat(errorMessage))];
                        }
                        hits = ((_b = result.hits) === null || _b === void 0 ? void 0 : _b.hits) || [];
                        spans = hits.map(function (hit) { return hit._source; });
                        spanMap = new Map();
                        for (_i = 0, spans_2 = spans; _i < spans_2.length; _i++) {
                            span = spans_2[_i];
                            spanMap.set(span.SpanId, span);
                        }
                        targetSpan = spanMap.get(spanId);
                        if (!targetSpan) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Span not found in trace: ".concat(spanId))];
                        }
                        parentSpan = targetSpan.ParentSpanId ? spanMap.get(targetSpan.ParentSpanId) : null;
                        childSpans = spans.filter(function (span) { return span.ParentSpanId === spanId; });
                        return [2 /*return*/, {
                                targetSpan: targetSpan,
                                parentSpan: parentSpan,
                                childSpans: childSpans,
                                allSpans: spans
                            }];
                    case 2:
                        error_3 = _c.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting trace context: ".concat(error_3 instanceof Error ? error_3.message : String(error_3)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Build a span tree from a list of spans
     * @param spans List of spans
     * @returns Hierarchical span tree
     */
    TraceAnalysis.prototype.buildSpanTree = function (spans) {
        // Build span map for faster lookups
        var spanMap = new Map();
        for (var _i = 0, spans_3 = spans; _i < spans_3.length; _i++) {
            var span = spans_3[_i];
            spanMap.set(span.SpanId, __assign(__assign({}, span), { children: [] }));
        }
        // Build tree
        var roots = [];
        for (var _a = 0, spans_4 = spans; _a < spans_4.length; _a++) {
            var span = spans_4[_a];
            var spanWithChildren = spanMap.get(span.SpanId);
            if (!span.ParentSpanId || !spanMap.has(span.ParentSpanId)) {
                // This is a root span
                roots.push(spanWithChildren);
            }
            else {
                // Add as child to parent
                var parent_1 = spanMap.get(span.ParentSpanId);
                parent_1.children.push(spanWithChildren);
            }
        }
        return roots;
    };
    /**
     * Find the critical path in a trace
     * @param spans List of spans
     * @param spanMap Map of spans for faster lookups
     * @param rootSpan Root span of the trace
     * @returns Critical path as a list of spans
     */
    TraceAnalysis.prototype.findCriticalPath = function (spans, spanMap, rootSpan) {
        // Helper function to calculate span duration
        var getSpanDuration = function (span) {
            var startTime = new Date(span['@timestamp']).getTime();
            var endTime = new Date(span.EndTimestamp || span['@timestamp']).getTime();
            return endTime - startTime;
        };
        // Helper function to find the longest path from a span
        var findLongestPath = function (spanId, visited) {
            if (visited === void 0) { visited = new Set(); }
            if (visited.has(spanId)) {
                return [];
            }
            visited.add(spanId);
            var span = spanMap.get(spanId);
            if (!span) {
                return [];
            }
            // Find child spans
            var childSpans = spans.filter(function (s) { return s.ParentSpanId === spanId; });
            if (childSpans.length === 0) {
                return [span];
            }
            // Find the child with the longest path
            var longestPath = [];
            var maxDuration = 0;
            for (var _i = 0, childSpans_1 = childSpans; _i < childSpans_1.length; _i++) {
                var childSpan = childSpans_1[_i];
                var childPath = findLongestPath(childSpan.SpanId, new Set(visited));
                var pathDuration = childPath.reduce(function (sum, s) { return sum + getSpanDuration(s); }, 0);
                if (pathDuration > maxDuration) {
                    maxDuration = pathDuration;
                    longestPath = childPath;
                }
            }
            return __spreadArray([span], longestPath, true);
        };
        // Find the longest path from the root span
        return findLongestPath(rootSpan.SpanId);
    };
    /**
     * Calculate metrics for a trace
     * @param spans List of spans
     * @param rootSpan Root span of the trace
     * @returns Trace metrics
     */
    TraceAnalysis.prototype.calculateTraceMetrics = function (spans, rootSpan) {
        var _a, _b;
        // Calculate total duration
        var rootStartTime = new Date(rootSpan['@timestamp']).getTime();
        var rootEndTime = new Date(rootSpan.EndTimestamp || rootSpan['@timestamp']).getTime();
        var totalDuration = rootEndTime - rootStartTime;
        // Count spans by type
        var spanTypes = new Map();
        for (var _i = 0, spans_5 = spans; _i < spans_5.length; _i++) {
            var span = spans_5[_i];
            var type = span.Kind || 'INTERNAL';
            spanTypes.set(type, (spanTypes.get(type) || 0) + 1);
        }
        // Count spans by service
        var services = new Map();
        for (var _c = 0, spans_6 = spans; _c < spans_6.length; _c++) {
            var span = spans_6[_c];
            var service = ((_b = (_a = span.Resource) === null || _a === void 0 ? void 0 : _a.service) === null || _b === void 0 ? void 0 : _b.name) || 'unknown';
            services.set(service, (services.get(service) || 0) + 1);
        }
        // Count errors
        var errorCount = spans.filter(function (span) { var _a; return ((_a = span.Status) === null || _a === void 0 ? void 0 : _a.code) === 2; }).length;
        return {
            totalSpans: spans.length,
            totalDuration: totalDuration,
            totalDurationMs: totalDuration,
            totalDurationFormatted: "".concat((totalDuration / 1000).toFixed(2), "s"),
            errorCount: errorCount,
            errorRate: spans.length > 0 ? errorCount / spans.length : 0,
            spanTypes: Object.fromEntries(spanTypes),
            services: Object.fromEntries(services)
        };
    };
    /**
     * Query traces with a custom query
     * @param query Custom query
     * @returns Query results
     */
    TraceAnalysis.prototype.queryTraces = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var result, errorMessage, error_4;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[TraceAnalysis] Querying traces');
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _b.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error querying traces: ".concat(errorMessage))];
                        }
                        return [2 /*return*/, result];
                    case 2:
                        error_4 = _b.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error querying traces: ".concat(error_4 instanceof Error ? error_4.message : String(error_4)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return TraceAnalysis;
}());
exports.TraceAnalysis = TraceAnalysis;

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
exports.TraceAnalysis = void 0;
var traceCore_js_1 = require("./traceCore.js");
/**
 * Functionality for analyzing traces and spans
 */
var TraceAnalysis = /** @class */ (function (_super) {
    __extends(TraceAnalysis, _super);
    function TraceAnalysis() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /**
     * Analyze a trace by traceId
     */
    TraceAnalysis.prototype.analyzeTrace = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            var rootSpan, spans, serviceName, durationMs, errorCount, operationName, analysis;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getRootSpan(traceId)];
                    case 1:
                        rootSpan = _a.sent();
                        if (!rootSpan) {
                            throw new Error("Trace ".concat(traceId, " not found"));
                        }
                        return [4 /*yield*/, this.getAllSpansForTrace(traceId)];
                    case 2:
                        spans = _a.sent();
                        serviceName = this.extractServiceName(rootSpan);
                        durationMs = rootSpan.duration / 1000000;
                        errorCount = spans.filter(function (span) {
                            var _a, _b, _c, _d;
                            return ((_a = span.status) === null || _a === void 0 ? void 0 : _a.code) === 2 || // OTEL mapping
                                ((_b = span.Status) === null || _b === void 0 ? void 0 : _b.Code) === 2 || // ECS mapping
                                ((_c = span.attributes) === null || _c === void 0 ? void 0 : _c.error) === true ||
                                ((_d = span.Attributes) === null || _d === void 0 ? void 0 : _d.error) === true;
                        }).length;
                        operationName = rootSpan.name || rootSpan.Name || 'unknown';
                        analysis = {
                            trace_id: traceId,
                            root_span: rootSpan,
                            service: serviceName,
                            operation: operationName,
                            timestamp: new Date(rootSpan['@timestamp'] || rootSpan.timestamp || rootSpan.start_time).toISOString(),
                            duration_ms: durationMs,
                            span_count: spans.length,
                            error_count: errorCount,
                            has_errors: errorCount > 0,
                            error_rate: spans.length > 0 ? (errorCount / spans.length) : 0,
                            spans: spans
                        };
                        return [2 /*return*/, analysis];
                }
            });
        });
    };
    /**
     * Get the root span for a trace
     */
    TraceAnalysis.prototype.getRootSpan = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        query = {
                            query: {
                                bool: {
                                    must: [
                                        { term: { trace_id: traceId } }
                                    ],
                                    should: [
                                        { bool: { must_not: { exists: { field: 'parent_span_id' } } } },
                                        { bool: { must_not: { exists: { field: 'ParentSpanId' } } } },
                                        { term: { parent_span_id: traceId } },
                                        { term: { ParentSpanId: traceId } }
                                    ],
                                    minimum_should_match: 1
                                }
                            },
                            size: 1
                        };
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _c.sent();
                        if (((_b = (_a = response.hits) === null || _a === void 0 ? void 0 : _a.hits) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                            return [2 /*return*/, response.hits.hits[0]._source];
                        }
                        return [2 /*return*/, null];
                }
            });
        });
    };
    /**
     * Get all spans for a trace
     */
    TraceAnalysis.prototype.getAllSpansForTrace = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        query = {
                            query: {
                                bool: {
                                    must: [
                                        { term: { trace_id: traceId } }
                                    ]
                                }
                            },
                            size: 1000, // Assuming traces won't have more than 1000 spans
                            sort: [
                                { '@timestamp': { order: 'asc' } }
                            ]
                        };
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _c.sent();
                        if (((_b = (_a = response.hits) === null || _a === void 0 ? void 0 : _a.hits) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                            return [2 /*return*/, response.hits.hits.map(function (hit) { return hit._source; })];
                        }
                        return [2 /*return*/, []];
                }
            });
        });
    };
    /**
     * Lookup a span by spanId
     */
    TraceAnalysis.prototype.spanLookup = function (spanId) {
        return __awaiter(this, void 0, void 0, function () {
            var query, response;
            var _a, _b;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        query = {
                            query: {
                                bool: {
                                    should: [
                                        { term: { span_id: spanId } },
                                        { term: { SpanId: spanId } }
                                    ],
                                    minimum_should_match: 1
                                }
                            },
                            size: 1
                        };
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 1:
                        response = _c.sent();
                        if (((_b = (_a = response.hits) === null || _a === void 0 ? void 0 : _a.hits) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                            return [2 /*return*/, response.hits.hits[0]._source];
                        }
                        return [2 /*return*/, null];
                }
            });
        });
    };
    return TraceAnalysis;
}(traceCore_js_1.TraceCore));
exports.TraceAnalysis = TraceAnalysis;

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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TracesAdapter = void 0;
var core_js_1 = require("../core/core.js");
var traceAnalysis_js_1 = require("./modules/traceAnalysis.js");
var serviceDependencies_js_1 = require("./modules/serviceDependencies.js");
var traceQueries_js_1 = require("./modules/traceQueries.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var timeRangeParser_js_1 = require("../../../utils/timeRangeParser.js");
var serviceResolver_js_1 = require("../../../utils/serviceResolver.js");
/**
 * Main TracesAdapter that combines functionality from specialized trace modules
 */
var TracesAdapter = /** @class */ (function (_super) {
    __extends(TracesAdapter, _super);
    function TracesAdapter(options) {
        var _this = _super.call(this, options) || this;
        _this.traceAnalysis = new traceAnalysis_js_1.TraceAnalysis(options);
        _this.serviceDependencies = new serviceDependencies_js_1.ServiceDependencies(options);
        _this.traceQueries = new traceQueries_js_1.TraceQueries(options);
        return _this;
    }
    /**
     * Make a request to Elasticsearch
     */
    TracesAdapter.prototype.request = function (method, url, body) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.traceAnalysis.request(method, url, body)];
            });
        });
    };
    /**
     * Analyze a trace by traceId
     */
    TracesAdapter.prototype.analyzeTrace = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                try {
                    if (!traceId) {
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Trace ID is required')];
                    }
                    return [2 /*return*/, this.traceAnalysis.analyzeTrace(traceId)];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error analyzing trace: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Lookup a span by spanId
     */
    TracesAdapter.prototype.spanLookup = function (spanId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.traceAnalysis.spanLookup(spanId)];
            });
        });
    };
    /**
     * Build a service dependency graph for a time window
     */
    TracesAdapter.prototype.serviceDependencyGraph = function (startTime_1, endTime_1) {
        return __awaiter(this, arguments, void 0, function (startTime, endTime, sampleRate) {
            var timeRange;
            if (sampleRate === void 0) { sampleRate = 1.0; }
            return __generator(this, function (_a) {
                try {
                    timeRange = (0, timeRangeParser_js_1.parseTimeRange)(startTime, endTime);
                    if ((0, errorHandling_js_1.isErrorResponse)(timeRange)) {
                        return [2 /*return*/, timeRange];
                    }
                    return [2 /*return*/, this.serviceDependencies.serviceDependencyGraph(timeRange.startTime, timeRange.endTime, sampleRate)];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error building service dependency graph: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Build a service dependency tree structure with relationship-specific metrics and nested paths
     */
    TracesAdapter.prototype.buildServiceDependencyTree = function (directRelationships) {
        return this.serviceDependencies.buildServiceDependencyTree(directRelationships);
    };
    /**
     * Execute a query against the traces index
     */
    TracesAdapter.prototype.queryTraces = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.traceQueries.queryTraces(query)];
            });
        });
    };
    /**
     * Get a list of services from trace data
     */
    TracesAdapter.prototype.getServices = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var timeRange, parsedTimeRange;
            return __generator(this, function (_a) {
                try {
                    timeRange = void 0;
                    if (startTime && endTime) {
                        parsedTimeRange = (0, timeRangeParser_js_1.parseTimeRange)(startTime, endTime);
                        if ((0, errorHandling_js_1.isErrorResponse)(parsedTimeRange)) {
                            return [2 /*return*/, parsedTimeRange];
                        }
                        timeRange = parsedTimeRange;
                    }
                    else {
                        timeRange = (0, timeRangeParser_js_1.getDefaultTimeRange)();
                    }
                    return [2 /*return*/, this.traceQueries.getServices(search, timeRange.startTime, timeRange.endTime)];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get operations for a specific service
     */
    TracesAdapter.prototype.getOperations = function (service) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.traceQueries.getOperations(service)];
            });
        });
    };
    /**
     * Get a complete trace by traceId
     * @param traceId Trace ID to retrieve
     * @returns Complete trace with all spans
     */
    TracesAdapter.prototype.getTrace = function (traceId) {
        return __awaiter(this, void 0, void 0, function () {
            var spans, trace, rootSpan, _i, spans_1, span, serviceName, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        if (!traceId) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Trace ID is required')];
                        }
                        return [4 /*yield*/, this.traceAnalysis.getAllSpansForTrace(traceId)];
                    case 1:
                        spans = _a.sent();
                        if (!spans || spans.length === 0) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("No spans found for trace ID: ".concat(traceId))];
                        }
                        trace = {
                            traceId: traceId,
                            spans: spans,
                            services: new Set(),
                            duration: 0,
                            timestamp: null,
                            rootSpan: null
                        };
                        return [4 /*yield*/, this.traceAnalysis.getRootSpan(traceId)];
                    case 2:
                        rootSpan = _a.sent();
                        if (rootSpan) {
                            trace.rootSpan = rootSpan;
                            trace.timestamp = rootSpan.timestamp || rootSpan.Timestamp;
                            trace.duration = rootSpan.duration || rootSpan.Duration || 0;
                        }
                        // Extract unique services
                        for (_i = 0, spans_1 = spans; _i < spans_1.length; _i++) {
                            span = spans_1[_i];
                            serviceName = span.serviceName ||
                                (span.Resource && span.Resource.service && span.Resource.service.name) ||
                                'unknown';
                            trace.services.add(serviceName);
                        }
                        // Convert services Set to Array for JSON serialization
                        return [2 /*return*/, __assign(__assign({}, trace), { services: Array.from(trace.services) })];
                    case 3:
                        error_1 = _a.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error retrieving trace: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get service dependencies for a specific service
     * @param service Service name to get dependencies for
     * @param startTime Start time in ISO format
     * @param endTime End time in ISO format
     * @returns Service dependencies
     */
    TracesAdapter.prototype.getServiceDependencies = function (service, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var timeRange, graph, serviceRelationships, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        if (!service) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Service name is required')];
                        }
                        timeRange = (0, timeRangeParser_js_1.parseTimeRange)(startTime, endTime);
                        if ((0, errorHandling_js_1.isErrorResponse)(timeRange)) {
                            return [2 /*return*/, timeRange];
                        }
                        return [4 /*yield*/, this.serviceDependencyGraph(timeRange.startTime, timeRange.endTime)];
                    case 1:
                        graph = _a.sent();
                        if ((0, errorHandling_js_1.isErrorResponse)(graph)) {
                            return [2 /*return*/, graph];
                        }
                        serviceRelationships = graph.relationships.filter(function (rel) {
                            return serviceResolver_js_1.ServiceResolver.normalizeServiceName(rel.parent) === serviceResolver_js_1.ServiceResolver.normalizeServiceName(service) ||
                                serviceResolver_js_1.ServiceResolver.normalizeServiceName(rel.child) === serviceResolver_js_1.ServiceResolver.normalizeServiceName(service);
                        });
                        return [2 /*return*/, {
                                service: service,
                                dependencies: serviceRelationships,
                                timeRange: timeRange
                            }];
                    case 2:
                        error_2 = _a.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting service dependencies: ".concat(error_2 instanceof Error ? error_2.message : String(error_2)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return TracesAdapter;
}(core_js_1.ElasticsearchCore));
exports.TracesAdapter = TracesAdapter;

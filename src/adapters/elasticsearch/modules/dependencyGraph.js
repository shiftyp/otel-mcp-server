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
exports.DependencyGraph = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
var timeRangeParser_js_1 = require("../../../utils/timeRangeParser.js");
/**
 * Service dependency graph functionality for the Elasticsearch Adapter
 */
var DependencyGraph = /** @class */ (function () {
    function DependencyGraph(options) {
        this.coreAdapter = new core_js_1.ElasticsearchCore(options);
    }
    /**
     * Get service dependency graph data
     * @param startTime Start time for the time range in ISO format
     * @param endTime End time for the time range in ISO format
     * @param sampleRate Sample rate for the query (0.0-1.0)
     * @returns Service dependency relationships and span counts
     */
    DependencyGraph.prototype.serviceDependencyGraph = function (startTime_1, endTime_1) {
        return __awaiter(this, arguments, void 0, function (startTime, endTime, sampleRate) {
            var timeRange, must, samplingScript, query, result, errorMessage, hits, total, processed, spanMap, _i, hits_1, hit, source, service, spanId, hasError, relationshipMap, _a, hits_2, hit, source, childService, childSpanId, parentSpanId, hasError, parentInfo, key, relationship, relationships, error_1;
            var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            if (sampleRate === void 0) { sampleRate = 1.0; }
            return __generator(this, function (_m) {
                switch (_m.label) {
                    case 0:
                        _m.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[DependencyGraph] Getting service dependency graph', { startTime: startTime, endTime: endTime, sampleRate: sampleRate });
                        // Validate parameters
                        if (!startTime || !endTime) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Start time and end time are required')];
                        }
                        if (sampleRate < 0 || sampleRate > 1) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Sample rate must be between 0 and 1')];
                        }
                        timeRange = (0, timeRangeParser_js_1.parseTimeRange)(startTime, endTime);
                        if ((0, errorHandling_js_1.isErrorResponse)(timeRange)) {
                            return [2 /*return*/, timeRange];
                        }
                        must = [
                            (0, queryBuilder_js_1.createRangeQuery)('@timestamp', timeRange.startTime, timeRange.endTime)
                        ];
                        samplingScript = '';
                        if (sampleRate < 1) {
                            samplingScript = "\n          double sampleRate = ".concat(sampleRate, ";\n          return Math.random() < sampleRate;\n        ");
                        }
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({ must: must }),
                            size: 10000,
                            _source: [
                                'Resource.service.name',
                                'ParentSpanId',
                                'SpanId',
                                'Status.code'
                            ]
                        };
                        // Add script filter if sampling is enabled
                        if (samplingScript) {
                            query.query.bool.filter = [
                                {
                                    script: {
                                        script: {
                                            source: samplingScript,
                                            lang: 'painless'
                                        }
                                    }
                                }
                            ];
                        }
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _m.sent();
                        if (!result || result.error) {
                            errorMessage = ((_b = result === null || result === void 0 ? void 0 : result.error) === null || _b === void 0 ? void 0 : _b.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting service dependency graph: ".concat(errorMessage))];
                        }
                        hits = ((_c = result.hits) === null || _c === void 0 ? void 0 : _c.hits) || [];
                        total = ((_e = (_d = result.hits) === null || _d === void 0 ? void 0 : _d.total) === null || _e === void 0 ? void 0 : _e.value) || 0;
                        processed = hits.length;
                        spanMap = new Map();
                        for (_i = 0, hits_1 = hits; _i < hits_1.length; _i++) {
                            hit = hits_1[_i];
                            source = hit._source;
                            service = (_g = (_f = source.Resource) === null || _f === void 0 ? void 0 : _f.service) === null || _g === void 0 ? void 0 : _g.name;
                            spanId = source.SpanId;
                            hasError = ((_h = source.Status) === null || _h === void 0 ? void 0 : _h.code) === 2;
                            if (service && spanId) {
                                spanMap.set(spanId, { service: service, error: hasError });
                            }
                        }
                        relationshipMap = new Map();
                        for (_a = 0, hits_2 = hits; _a < hits_2.length; _a++) {
                            hit = hits_2[_a];
                            source = hit._source;
                            childService = (_k = (_j = source.Resource) === null || _j === void 0 ? void 0 : _j.service) === null || _k === void 0 ? void 0 : _k.name;
                            childSpanId = source.SpanId;
                            parentSpanId = source.ParentSpanId;
                            hasError = ((_l = source.Status) === null || _l === void 0 ? void 0 : _l.code) === 2;
                            if (childService && childSpanId && parentSpanId) {
                                parentInfo = spanMap.get(parentSpanId);
                                if (parentInfo && parentInfo.service !== childService) {
                                    key = "".concat(parentInfo.service, "|").concat(childService);
                                    if (!relationshipMap.has(key)) {
                                        relationshipMap.set(key, { count: 0, errorCount: 0 });
                                    }
                                    relationship = relationshipMap.get(key);
                                    relationship.count++;
                                    if (hasError) {
                                        relationship.errorCount++;
                                    }
                                }
                            }
                        }
                        relationships = Array.from(relationshipMap.entries()).map(function (_a) {
                            var key = _a[0], value = _a[1];
                            var _b = key.split('|'), parent = _b[0], child = _b[1];
                            var errorRate = value.count > 0 ? value.errorCount / value.count : 0;
                            return {
                                parent: parent,
                                child: child,
                                count: value.count,
                                errorCount: value.errorCount,
                                errorRate: errorRate
                            };
                        });
                        // Sort by count
                        relationships.sort(function (a, b) { return b.count - a.count; });
                        return [2 /*return*/, {
                                relationships: relationships,
                                spanCounts: {
                                    processed: processed,
                                    total: total,
                                    percentage: "".concat(((processed / total) * 100).toFixed(2), "%")
                                }
                            }];
                    case 2:
                        error_1 = _m.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting service dependency graph: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Build a service dependency tree structure with relationship-specific metrics and nested paths
     * @param directRelationships The direct relationships between services
     * @returns A hierarchical tree structure representing service dependencies with detailed metrics
     */
    DependencyGraph.prototype.buildServiceDependencyTree = function (directRelationships) {
        return __awaiter(this, void 0, void 0, function () {
            var serviceMap, allServices, _i, directRelationships_1, relationship, _a, allServices_1, service, _b, directRelationships_2, relationship, parent_1, child, count, _c, errorCount, errorRate, errorRatePercentage, parentService, childService, _d, _e, _f, serviceName, service, totalCalls, totalErrors, rootServices;
            return __generator(this, function (_g) {
                try {
                    logger_js_1.logger.info('[DependencyGraph] Building service dependency tree');
                    serviceMap = new Map();
                    allServices = new Set();
                    for (_i = 0, directRelationships_1 = directRelationships; _i < directRelationships_1.length; _i++) {
                        relationship = directRelationships_1[_i];
                        allServices.add(relationship.parent);
                        allServices.add(relationship.child);
                    }
                    for (_a = 0, allServices_1 = allServices; _a < allServices_1.length; _a++) {
                        service = allServices_1[_a];
                        serviceMap.set(service, {
                            children: [],
                            parents: [],
                            metrics: {
                                incomingCalls: 0,
                                outgoingCalls: 0,
                                errors: 0,
                                errorRate: 0,
                                errorRatePercentage: 0
                            }
                        });
                    }
                    // Process relationships
                    for (_b = 0, directRelationships_2 = directRelationships; _b < directRelationships_2.length; _b++) {
                        relationship = directRelationships_2[_b];
                        parent_1 = relationship.parent, child = relationship.child, count = relationship.count, _c = relationship.errorCount, errorCount = _c === void 0 ? 0 : _c;
                        errorRate = count > 0 ? errorCount / count : 0;
                        errorRatePercentage = errorRate * 100;
                        parentService = serviceMap.get(parent_1);
                        parentService.children.push({
                            serviceName: child,
                            metrics: {
                                calls: count,
                                errors: errorCount,
                                errorRate: errorRate,
                                errorRatePercentage: errorRatePercentage
                            },
                            path: {} // Latency metrics would be added here if available
                        });
                        parentService.metrics.outgoingCalls += count;
                        childService = serviceMap.get(child);
                        childService.parents.push({
                            serviceName: parent_1,
                            metrics: {
                                calls: count,
                                errors: errorCount,
                                errorRate: errorRate,
                                errorRatePercentage: errorRatePercentage
                            }
                        });
                        childService.metrics.incomingCalls += count;
                        childService.metrics.errors += errorCount;
                    }
                    // Calculate error rates for each service
                    for (_d = 0, _e = serviceMap.entries(); _d < _e.length; _d++) {
                        _f = _e[_d], serviceName = _f[0], service = _f[1];
                        totalCalls = service.metrics.outgoingCalls;
                        totalErrors = service.children.reduce(function (sum, child) { return sum + child.metrics.errors; }, 0);
                        service.metrics.errors = totalErrors;
                        service.metrics.errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
                        service.metrics.errorRatePercentage = service.metrics.errorRate * 100;
                        // Sort children by calls
                        service.children.sort(function (a, b) { return b.metrics.calls - a.metrics.calls; });
                        // Sort parents by calls
                        service.parents.sort(function (a, b) { return b.metrics.calls - a.metrics.calls; });
                    }
                    rootServices = Array.from(serviceMap.entries())
                        .filter(function (_a) {
                        var _ = _a[0], service = _a[1];
                        return service.parents.length === 0;
                    })
                        .map(function (_a) {
                        var serviceName = _a[0];
                        return serviceName;
                    });
                    return [2 /*return*/, {
                            rootServices: rootServices,
                            serviceTree: serviceMap
                        }];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error building service dependency tree: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    return DependencyGraph;
}());
exports.DependencyGraph = DependencyGraph;

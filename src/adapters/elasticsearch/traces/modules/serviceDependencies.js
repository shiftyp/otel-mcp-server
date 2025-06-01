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
exports.ServiceDependencies = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
var traceCore_js_1 = require("./traceCore.js");
/**
 * Functionality for analyzing service dependencies from trace data
 */
var ServiceDependencies = /** @class */ (function (_super) {
    __extends(ServiceDependencies, _super);
    function ServiceDependencies() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    /**
     * Build a service dependency graph for a time window
     * @param startTime Start time in ISO format
     * @param endTime End time in ISO format
     * @returns Object containing array of direct relationships between parent and child services and span counts
     */
    /**
     * Build a service dependency graph for a time window, with optional statistical sampling.
     * @param startTime Start time in ISO format
     * @param endTime End time in ISO format
     * @param sampleRate Fraction of spans to sample (0 < sampleRate <= 1, default 1.0)
     * @returns Object containing array of direct relationships between parent and child services and span counts
     */
    ServiceDependencies.prototype.serviceDependencyGraph = function (startTime_1, endTime_1) {
        return __awaiter(this, arguments, void 0, function (startTime, endTime, sampleRate) {
            var normalizedStartTime, normalizedEndTime, relationships_1, spanServiceMap, PAGE_SIZE, totalProcessed, lastSortValue, hasMoreData, currentPage, MAX_PAGES, spansWithParents, query, response, hits, _i, hits_1, hit, span, serviceName, _a, spansWithParents_1, span, childService, parentService, recorded, stats, hasError, peerService, caller, callee, stats, hasError, uniqueServices_1, totalSpans, countQuery, countResponse, countError_1, directRelationships_1, error_1;
            var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            if (sampleRate === void 0) { sampleRate = 1.0; }
            return __generator(this, function (_q) {
                switch (_q.label) {
                    case 0:
                        _q.trys.push([0, 8, , 9]);
                        logger_js_1.logger.info('[ES Adapter] Building service dependency graph', { startTime: startTime, endTime: endTime });
                        normalizedStartTime = new Date(startTime).toISOString();
                        normalizedEndTime = new Date(endTime).toISOString();
                        relationships_1 = new Map();
                        spanServiceMap = new Map();
                        PAGE_SIZE = 5000;
                        totalProcessed = 0;
                        lastSortValue = null;
                        hasMoreData = true;
                        currentPage = 0;
                        MAX_PAGES = 1500;
                        spansWithParents = [];
                        _q.label = 1;
                    case 1:
                        if (!(hasMoreData && currentPage < MAX_PAGES)) return [3 /*break*/, 3];
                        currentPage++;
                        query = void 0;
                        query = {
                            size: PAGE_SIZE,
                            query: {
                                bool: {
                                    must: [
                                        {
                                            range: {
                                                '@timestamp': {
                                                    gte: normalizedStartTime,
                                                    lte: normalizedEndTime
                                                }
                                            }
                                        }
                                    ],
                                    should: [
                                        { exists: { field: 'resource.attributes.service.name' } },
                                        { exists: { field: 'service.name' } }
                                    ],
                                    minimum_should_match: 1,
                                    filter: []
                                }
                            },
                            _source: [
                                'span_id',
                                'parent_span_id',
                                'resource.attributes.service.name',
                                'service.name',
                                'status.code',
                                'net.peer.name',
                                'net.peer.service'
                            ],
                            sort: ['@timestamp']
                        };
                        if (lastSortValue) {
                            query.search_after = lastSortValue;
                        }
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), query)];
                    case 2:
                        response = _q.sent();
                        hits = ((_b = response.hits) === null || _b === void 0 ? void 0 : _b.hits) || [];
                        if (hits.length === 0) {
                            hasMoreData = false;
                            return [3 /*break*/, 3];
                        }
                        totalProcessed += hits.length;
                        if (hits.length > 0) {
                            lastSortValue = hits[hits.length - 1].sort;
                        }
                        for (_i = 0, hits_1 = hits; _i < hits_1.length; _i++) {
                            hit = hits_1[_i];
                            span = hit._source;
                            if (!span || !span.span_id)
                                continue;
                            serviceName = ((_d = (_c = span.resource) === null || _c === void 0 ? void 0 : _c.attributes) === null || _d === void 0 ? void 0 : _d['service.name']) || span['service.name'] || 'unknown';
                            spanServiceMap.set(span.span_id, serviceName);
                            if (span.parent_span_id) {
                                spansWithParents.push(span);
                            }
                        }
                        hasMoreData = hits.length === PAGE_SIZE;
                        return [3 /*break*/, 1];
                    case 3:
                        // Second pass: for each span, infer relationships using both parent-child join and net.peer.name/service fallback
                        for (_a = 0, spansWithParents_1 = spansWithParents; _a < spansWithParents_1.length; _a++) {
                            span = spansWithParents_1[_a];
                            childService = spanServiceMap.get(span.span_id) || 'unknown';
                            parentService = spanServiceMap.get(span.parent_span_id) || 'unknown';
                            recorded = false;
                            // 1. Standard parent-child join
                            if (childService !== 'unknown' && parentService !== 'unknown' && childService !== parentService) {
                                if (!relationships_1.has(parentService))
                                    relationships_1.set(parentService, new Map());
                                if (!relationships_1.get(parentService).has(childService))
                                    relationships_1.get(parentService).set(childService, { count: 0, errors: 0 });
                                stats = relationships_1.get(parentService).get(childService);
                                stats.count += 1;
                                hasError = ((_e = span.status) === null || _e === void 0 ? void 0 : _e.code) === 2 || ((_f = span.Status) === null || _f === void 0 ? void 0 : _f.Code) === 2 || ((_g = span.status) === null || _g === void 0 ? void 0 : _g.code) === 'Error';
                                if (hasError) {
                                    stats.errors += 1;
                                }
                                recorded = true;
                            }
                            peerService = span['net.peer.name'] || span['net.peer.service'] || ((_j = (_h = span.resource) === null || _h === void 0 ? void 0 : _h.attributes) === null || _j === void 0 ? void 0 : _j['net.peer.name']) || ((_l = (_k = span.resource) === null || _k === void 0 ? void 0 : _k.attributes) === null || _l === void 0 ? void 0 : _l['net.peer.service']);
                            if (peerService && peerService !== childService) {
                                caller = childService;
                                callee = peerService;
                                if (!relationships_1.has(caller))
                                    relationships_1.set(caller, new Map());
                                if (!relationships_1.get(caller).has(callee))
                                    relationships_1.get(caller).set(callee, { count: 0, errors: 0 });
                                stats = relationships_1.get(caller).get(callee);
                                stats.count += 1;
                                hasError = ((_m = span.status) === null || _m === void 0 ? void 0 : _m.code) === 2 || ((_o = span.Status) === null || _o === void 0 ? void 0 : _o.Code) === 2 || ((_p = span.status) === null || _p === void 0 ? void 0 : _p.code) === 'Error';
                                if (hasError) {
                                    stats.errors += 1;
                                }
                            }
                        }
                        uniqueServices_1 = new Set();
                        relationships_1.forEach(function (childMap, parent) {
                            uniqueServices_1.add(parent);
                            childMap.forEach(function (_, child) { return uniqueServices_1.add(child); });
                        });
                        logger_js_1.logger.info('[ES Adapter] Service dependency graph processing complete', {
                            totalSpansProcessed: totalProcessed,
                            uniqueServicesCount: (function () {
                                var unique = new Set();
                                relationships_1.forEach(function (childMap, parent) {
                                    unique.add(parent);
                                    childMap.forEach(function (_, child) { return unique.add(child); });
                                });
                                return unique.size;
                            })(),
                            totalRelationships: Array.from(relationships_1.values()).reduce(function (sum, childMap) { return sum + childMap.size; }, 0)
                        });
                        // If we didn't process any relationships, log a warning
                        if (totalProcessed === 0) {
                            logger_js_1.logger.warn('[ES Adapter] No relationships found for dependency graph');
                        }
                        totalSpans = 0;
                        _q.label = 4;
                    case 4:
                        _q.trys.push([4, 6, , 7]);
                        countQuery = {
                            query: {
                                bool: {
                                    must: [
                                        {
                                            range: {
                                                '@timestamp': {
                                                    gte: normalizedStartTime,
                                                    lte: normalizedEndTime
                                                }
                                            }
                                        }
                                    ]
                                }
                            },
                            size: 0, // We only want the count, not the actual documents
                            track_total_hits: true
                        };
                        return [4 /*yield*/, this.request('POST', "/".concat(this.traceIndexPattern, "/_search"), countQuery)];
                    case 5:
                        countResponse = _q.sent();
                        totalSpans = countResponse.hits.total.value;
                        logger_js_1.logger.info('[ES Adapter] Retrieved total span count', {
                            totalSpans: totalSpans,
                            spansProcessed: totalProcessed,
                            processingPercentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : 'unknown'
                        });
                        return [3 /*break*/, 7];
                    case 6:
                        countError_1 = _q.sent();
                        logger_js_1.logger.warn('[ES Adapter] Error getting total span count', {
                            error: countError_1 instanceof Error ? countError_1.message : String(countError_1),
                            startTime: startTime,
                            endTime: endTime
                        });
                        return [3 /*break*/, 7];
                    case 7:
                        directRelationships_1 = [];
                        relationships_1.forEach(function (childMap, parent) {
                            childMap.forEach(function (stats, child) {
                                directRelationships_1.push({
                                    parent: parent,
                                    child: child,
                                    count: stats.count,
                                    errorCount: stats.errors,
                                    errorRate: stats.errors > 0 ? stats.errors / stats.count : 0,
                                    isExtended: false // Mark as direct relationship
                                });
                            });
                        });
                        logger_js_1.logger.info('[ES Adapter] Service dependency graph generated', {
                            directRelationships: directRelationships_1.length,
                            services: new Set(directRelationships_1.flatMap(function (r) { return [r.parent, r.child]; })).size,
                            spansProcessed: totalProcessed,
                            totalSpans: totalSpans,
                            processingPercentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : 'unknown'
                        });
                        // Return both the relationships and span count information
                        return [2 /*return*/, {
                                relationships: directRelationships_1,
                                spanCounts: {
                                    processed: totalProcessed,
                                    total: totalSpans,
                                    percentage: totalSpans > 0 ? (totalProcessed / totalSpans * 100).toFixed(2) + '%' : '0.00%'
                                }
                            }];
                    case 8:
                        error_1 = _q.sent();
                        logger_js_1.logger.error('[ES Adapter] Error building service dependency graph', {
                            error: error_1 instanceof Error ? error_1.message : String(error_1),
                            stack: error_1 instanceof Error ? error_1.stack : undefined,
                            startTime: startTime,
                            endTime: endTime
                        });
                        // Return empty results rather than failing
                        return [2 /*return*/, {
                                relationships: [],
                                spanCounts: {
                                    processed: 0,
                                    total: 0,
                                    percentage: '0.00%'
                                }
                            }];
                    case 9: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Helper method to add a service relationship to the map
     */
    ServiceDependencies.prototype.addServiceRelationship = function (relationships, parent, child) {
        // Initialize parent map if needed
        if (!relationships.has(parent)) {
            relationships.set(parent, new Map());
        }
        // Initialize child entry if needed
        var childMap = relationships.get(parent);
        if (!childMap.has(child)) {
            childMap.set(child, { count: 0, errors: 0 });
        }
        var stats = childMap.get(child);
        stats.count++;
    };
    /**
     * Build a service dependency tree structure with relationship-specific metrics and nested paths
     * @param directRelationships The direct relationships between services
     * @returns A hierarchical tree structure representing service dependencies with detailed metrics
     */
    ServiceDependencies.prototype.buildServiceDependencyTree = function (directRelationships) {
        // Create a map to store relationship-specific metrics
        var relationshipMetrics = new Map();
        // Initialize maps with all services
        var allServices = new Set();
        // Process all direct relationships to build relationship metrics
        for (var _i = 0, directRelationships_2 = directRelationships; _i < directRelationships_2.length; _i++) {
            var rel = directRelationships_2[_i];
            allServices.add(rel.parent);
            allServices.add(rel.child);
            // Create a unique key for this relationship
            var relationshipKey = "".concat(rel.parent, ":").concat(rel.child);
            // Store relationship metrics
            relationshipMetrics.set(relationshipKey, {
                calls: rel.count,
                errors: rel.errorCount || 0,
                errorRate: rel.errorRate || 0
            });
        }
        // Build adjacency maps for the tree structure
        var childRelationships = new Map();
        var parentRelationships = new Map();
        // Service-level metrics
        var serviceMetrics = new Map();
        // Initialize service metrics
        for (var _a = 0, allServices_1 = allServices; _a < allServices_1.length; _a++) {
            var service = allServices_1[_a];
            serviceMetrics.set(service, {
                incomingCalls: 0,
                outgoingCalls: 0,
                errors: 0
            });
        }
        // Process relationships to build the tree structure
        for (var _b = 0, directRelationships_3 = directRelationships; _b < directRelationships_3.length; _b++) {
            var rel = directRelationships_3[_b];
            // Add to child relationships map
            if (!childRelationships.has(rel.parent)) {
                childRelationships.set(rel.parent, new Map());
            }
            childRelationships.get(rel.parent).set(rel.child, {
                calls: rel.count,
                errors: rel.errorCount || 0,
                errorRate: rel.errorRate || 0
            });
            // Add to parent relationships map
            if (!parentRelationships.has(rel.child)) {
                parentRelationships.set(rel.child, new Map());
            }
            parentRelationships.get(rel.child).set(rel.parent, {
                calls: rel.count,
                errors: rel.errorCount || 0,
                errorRate: rel.errorRate || 0
            });
            // Update service metrics
            var parentMetrics = serviceMetrics.get(rel.parent);
            parentMetrics.outgoingCalls += rel.count;
            if (rel.errorCount) {
                parentMetrics.errors += rel.errorCount;
            }
            var childMetrics = serviceMetrics.get(rel.child);
            childMetrics.incomingCalls += rel.count;
        }
        // Find root services (services with no parents or only self as parent)
        var rootServices = [];
        for (var _c = 0, allServices_2 = allServices; _c < allServices_2.length; _c++) {
            var service = allServices_2[_c];
            var parents = parentRelationships.get(service);
            if (!parents || parents.size === 0 || (parents.size === 1 && parents.has(service))) {
                rootServices.push(service);
            }
        }
        // Build the final tree structure with detailed metrics
        var serviceTree = new Map();
        // Add all services to the tree with enhanced metrics
        for (var _d = 0, allServices_3 = allServices; _d < allServices_3.length; _d++) {
            var service = allServices_3[_d];
            // Get children with detailed metrics
            var childrenWithMetrics = [];
            var childrenMap = childRelationships.get(service);
            if (childrenMap) {
                for (var _e = 0, _f = childrenMap.entries(); _e < _f.length; _e++) {
                    var _g = _f[_e], childName = _g[0], metrics_1 = _g[1];
                    childrenWithMetrics.push({
                        serviceName: childName,
                        metrics: {
                            calls: metrics_1.calls,
                            errors: metrics_1.errors,
                            errorRate: metrics_1.errorRate,
                            errorRatePercentage: Math.round(metrics_1.errorRate * 10000) / 100
                        },
                        path: {
                        // Latency metrics would be added here if available
                        }
                    });
                }
            }
            // Get parents with detailed metrics
            var parentsWithMetrics = [];
            var parentsMap = parentRelationships.get(service);
            if (parentsMap) {
                for (var _h = 0, _j = parentsMap.entries(); _h < _j.length; _h++) {
                    var _k = _j[_h], parentName = _k[0], metrics_2 = _k[1];
                    parentsWithMetrics.push({
                        serviceName: parentName,
                        metrics: {
                            calls: metrics_2.calls,
                            errors: metrics_2.errors,
                            errorRate: metrics_2.errorRate,
                            errorRatePercentage: Math.round(metrics_2.errorRate * 10000) / 100
                        }
                    });
                }
            }
            // Calculate service-level metrics
            var metrics = serviceMetrics.get(service) || { incomingCalls: 0, outgoingCalls: 0, errors: 0 };
            var totalCalls = metrics.incomingCalls + metrics.outgoingCalls;
            var errorRate = totalCalls > 0 ? metrics.errors / totalCalls : 0;
            // Add service to the tree
            serviceTree.set(service, {
                children: childrenWithMetrics,
                parents: parentsWithMetrics,
                metrics: {
                    incomingCalls: metrics.incomingCalls,
                    outgoingCalls: metrics.outgoingCalls,
                    errors: metrics.errors,
                    errorRate: errorRate,
                    errorRatePercentage: Math.round(errorRate * 10000) / 100
                }
            });
        }
        return {
            rootServices: rootServices,
            serviceTree: serviceTree
        };
    };
    return ServiceDependencies;
}(traceCore_js_1.TraceCore));
exports.ServiceDependencies = ServiceDependencies;

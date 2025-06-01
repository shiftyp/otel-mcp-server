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
exports.ServiceDiscovery = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
var queryBuilder_js_1 = require("../../../utils/queryBuilder.js");
var serviceResolver_js_1 = require("../../../utils/serviceResolver.js");
var timeRangeParser_js_1 = require("../../../utils/timeRangeParser.js");
/**
 * Service discovery functionality for the Elasticsearch Adapter
 */
var ServiceDiscovery = /** @class */ (function () {
    function ServiceDiscovery(options) {
        this.coreAdapter = new core_js_1.ElasticsearchCore(options);
    }
    /**
     * Get a list of all services across all telemetry types (traces, metrics, and logs)
     * @param search Optional search term to filter services by name
     * @param startTime Optional start time for the time range in ISO format
     * @param endTime Optional end time for the time range in ISO format
     * @returns Array of service names and their versions
     */
    ServiceDiscovery.prototype.getServices = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var timeRange, parsedTimeRange, _a, tracesServices, metricsServices, logsServices, serviceMap_1, addServices, result, error_1;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[ServiceDiscovery] Getting services', { search: search, startTime: startTime, endTime: endTime });
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
                        return [4 /*yield*/, Promise.all([
                                this.getServicesFromTraces(search, timeRange.startTime, timeRange.endTime),
                                this.getServicesFromMetrics(search, timeRange.startTime, timeRange.endTime),
                                this.getServicesFromLogs(search, timeRange.startTime, timeRange.endTime)
                            ])];
                    case 1:
                        _a = _b.sent(), tracesServices = _a[0], metricsServices = _a[1], logsServices = _a[2];
                        serviceMap_1 = new Map();
                        addServices = function (services) {
                            if ((0, errorHandling_js_1.isErrorResponse)(services)) {
                                return;
                            }
                            for (var _i = 0, services_1 = services; _i < services_1.length; _i++) {
                                var service = services_1[_i];
                                if (!serviceMap_1.has(service.name)) {
                                    serviceMap_1.set(service.name, new Set());
                                }
                                var versions = serviceMap_1.get(service.name);
                                for (var _a = 0, _b = service.versions; _a < _b.length; _a++) {
                                    var version = _b[_a];
                                    versions.add(version);
                                }
                            }
                        };
                        // Add services from each telemetry type
                        addServices(tracesServices);
                        addServices(metricsServices);
                        addServices(logsServices);
                        result = Array.from(serviceMap_1.entries()).map(function (_a) {
                            var name = _a[0], versions = _a[1];
                            return ({
                                name: name,
                                versions: Array.from(versions)
                            });
                        });
                        // Sort by name
                        result.sort(function (a, b) { return a.name.localeCompare(b.name); });
                        return [2 /*return*/, result];
                    case 2:
                        error_1 = _b.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get services from traces data
     * @param search Optional search term to filter services by name
     * @param startTime Start time for the time range in ISO format
     * @param endTime End time for the time range in ISO format
     * @returns Array of service names and their versions
     */
    ServiceDiscovery.prototype.getServicesFromTraces = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var must, serviceQuery, aggs, query, result, errorMessage, services, error_2;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        logger_js_1.logger.debug('[ServiceDiscovery] Getting services from traces', { search: search, startTime: startTime, endTime: endTime });
                        must = [];
                        // Add time range if provided
                        if (startTime && endTime) {
                            must.push((0, queryBuilder_js_1.createRangeQuery)('@timestamp', startTime, endTime));
                        }
                        // Add search filter if provided
                        if (search && search.trim() !== '') {
                            serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(search, 'TRACES');
                            if (!(0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                                must.push(serviceQuery);
                            }
                        }
                        aggs = {
                            services: {
                                terms: {
                                    field: 'Resource.service.name',
                                    size: 1000
                                },
                                aggs: {
                                    versions: {
                                        terms: {
                                            field: 'Resource.service.version',
                                            size: 100
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
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _d.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from traces: ".concat(errorMessage))];
                        }
                        services = ((_c = (_b = result.aggregations) === null || _b === void 0 ? void 0 : _b.services) === null || _c === void 0 ? void 0 : _c.buckets) || [];
                        return [2 /*return*/, services.map(function (bucket) {
                                var _a;
                                var versions = (((_a = bucket.versions) === null || _a === void 0 ? void 0 : _a.buckets) || []).map(function (versionBucket) { return versionBucket.key; });
                                return {
                                    name: bucket.key,
                                    versions: versions.length > 0 ? versions : ['unknown']
                                };
                            })];
                    case 2:
                        error_2 = _d.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from traces: ".concat(error_2 instanceof Error ? error_2.message : String(error_2)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get services from metrics data
     * @param search Optional search term to filter services by name
     * @param startTime Start time for the time range in ISO format
     * @param endTime End time for the time range in ISO format
     * @returns Array of service names and their versions
     */
    ServiceDiscovery.prototype.getServicesFromMetrics = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var must, serviceQuery, aggs, query, result, errorMessage, services, error_3;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        logger_js_1.logger.debug('[ServiceDiscovery] Getting services from metrics', { search: search, startTime: startTime, endTime: endTime });
                        must = [];
                        // Add time range if provided
                        if (startTime && endTime) {
                            must.push((0, queryBuilder_js_1.createRangeQuery)('@timestamp', startTime, endTime));
                        }
                        // Add search filter if provided
                        if (search && search.trim() !== '') {
                            serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(search, 'METRICS');
                            if (!(0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                                must.push(serviceQuery);
                            }
                        }
                        aggs = {
                            services: {
                                terms: {
                                    field: 'service.name',
                                    size: 1000
                                },
                                aggs: {
                                    versions: {
                                        terms: {
                                            field: 'service.version',
                                            size: 100
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
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-metrics-*/_search', query)];
                    case 1:
                        result = _d.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from metrics: ".concat(errorMessage))];
                        }
                        services = ((_c = (_b = result.aggregations) === null || _b === void 0 ? void 0 : _b.services) === null || _c === void 0 ? void 0 : _c.buckets) || [];
                        return [2 /*return*/, services.map(function (bucket) {
                                var _a;
                                var versions = (((_a = bucket.versions) === null || _a === void 0 ? void 0 : _a.buckets) || []).map(function (versionBucket) { return versionBucket.key; });
                                return {
                                    name: bucket.key,
                                    versions: versions.length > 0 ? versions : ['unknown']
                                };
                            })];
                    case 2:
                        error_3 = _d.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from metrics: ".concat(error_3 instanceof Error ? error_3.message : String(error_3)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get services from logs data
     * @param search Optional search term to filter services by name
     * @param startTime Start time for the time range in ISO format
     * @param endTime End time for the time range in ISO format
     * @returns Array of service names and their versions
     */
    ServiceDiscovery.prototype.getServicesFromLogs = function (search, startTime, endTime) {
        return __awaiter(this, void 0, void 0, function () {
            var must, serviceQuery, aggs, query, result, errorMessage, services, error_4;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        logger_js_1.logger.debug('[ServiceDiscovery] Getting services from logs', { search: search, startTime: startTime, endTime: endTime });
                        must = [];
                        // Add time range if provided
                        if (startTime && endTime) {
                            must.push((0, queryBuilder_js_1.createRangeQuery)('@timestamp', startTime, endTime));
                        }
                        // Add search filter if provided
                        if (search && search.trim() !== '') {
                            serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(search, 'LOGS');
                            if (!(0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                                must.push(serviceQuery);
                            }
                        }
                        aggs = {
                            services: {
                                terms: {
                                    field: 'Resource.service.name',
                                    size: 1000
                                },
                                aggs: {
                                    versions: {
                                        terms: {
                                            field: 'Resource.service.version',
                                            size: 100
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
                        result = _d.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from logs: ".concat(errorMessage))];
                        }
                        services = ((_c = (_b = result.aggregations) === null || _b === void 0 ? void 0 : _b.services) === null || _c === void 0 ? void 0 : _c.buckets) || [];
                        return [2 /*return*/, services.map(function (bucket) {
                                var _a;
                                var versions = (((_a = bucket.versions) === null || _a === void 0 ? void 0 : _a.buckets) || []).map(function (versionBucket) { return versionBucket.key; });
                                return {
                                    name: bucket.key,
                                    versions: versions.length > 0 ? versions : ['unknown']
                                };
                            })];
                    case 2:
                        error_4 = _d.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting services from logs: ".concat(error_4 instanceof Error ? error_4.message : String(error_4)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get operations for a specific service
     * @param service Service name
     * @returns Array of operation names
     */
    ServiceDiscovery.prototype.getOperations = function (service) {
        return __awaiter(this, void 0, void 0, function () {
            var must, serviceQuery, aggs, query, result, errorMessage, operations, error_5;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _d.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[ServiceDiscovery] Getting operations for service', { service: service });
                        if (!service) {
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)('Service name is required')];
                        }
                        must = [];
                        serviceQuery = serviceResolver_js_1.ServiceResolver.createServiceQuery(service, 'TRACES', { exactMatch: true });
                        if ((0, errorHandling_js_1.isErrorResponse)(serviceQuery)) {
                            return [2 /*return*/, serviceQuery];
                        }
                        must.push(serviceQuery);
                        aggs = {
                            operations: {
                                terms: {
                                    field: 'Name',
                                    size: 1000
                                }
                            }
                        };
                        query = {
                            query: (0, queryBuilder_js_1.createBoolQuery)({ must: must }),
                            size: 0,
                            aggs: aggs
                        };
                        return [4 /*yield*/, this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query)];
                    case 1:
                        result = _d.sent();
                        if (!result || result.error) {
                            errorMessage = ((_a = result === null || result === void 0 ? void 0 : result.error) === null || _a === void 0 ? void 0 : _a.reason) || 'Unknown error';
                            return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting operations: ".concat(errorMessage))];
                        }
                        operations = ((_c = (_b = result.aggregations) === null || _b === void 0 ? void 0 : _b.operations) === null || _c === void 0 ? void 0 : _c.buckets) || [];
                        return [2 /*return*/, operations.map(function (bucket) { return bucket.key; })];
                    case 2:
                        error_5 = _d.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting operations: ".concat(error_5 instanceof Error ? error_5.message : String(error_5)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return ServiceDiscovery;
}());
exports.ServiceDiscovery = ServiceDiscovery;

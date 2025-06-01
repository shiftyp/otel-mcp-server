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
exports.LogSearchModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
/**
 * Module for log searching functionality
 */
var LogSearchModule = /** @class */ (function () {
    function LogSearchModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * Search for logs with a flexible query structure
     * @param options Search options
     * @returns Array of log objects
     */
    LogSearchModule.prototype.searchOtelLogs = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var query, service, level, startTime, endTime, _a, limit, _b, offset, _c, sortDirection, traceId, spanId, esQuery, timeFilter, textFields, wildcardQueries, matchQuery, searchRequest, response, logs, error_1;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] searchOtelLogs called', { options: options });
                        query = options.query, service = options.service, level = options.level, startTime = options.startTime, endTime = options.endTime, _a = options.limit, limit = _a === void 0 ? 100 : _a, _b = options.offset, offset = _b === void 0 ? 0 : _b, _c = options.sortDirection, sortDirection = _c === void 0 ? 'desc' : _c, traceId = options.traceId, spanId = options.spanId;
                        esQuery = {
                            bool: {
                                must: []
                            }
                        };
                        // Add time range filter if provided
                        if (startTime || endTime) {
                            timeFilter = {
                                range: {
                                    '@timestamp': {}
                                }
                            };
                            if (startTime) {
                                timeFilter.range['@timestamp'].gte = startTime;
                            }
                            if (endTime) {
                                timeFilter.range['@timestamp'].lte = endTime;
                            }
                            esQuery.bool.must.push(timeFilter);
                        }
                        // Add service filter if provided
                        if (service) {
                            // Handle both resource.service.name and service.name
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
                        // Add log level filter if provided
                        if (level) {
                            // Handle different level field formats
                            esQuery.bool.must.push({
                                bool: {
                                    should: [
                                        { term: { 'level': level } },
                                        { term: { 'severity_text': level } },
                                        { term: { 'Severity': level } }
                                    ],
                                    minimum_should_match: 1
                                }
                            });
                        }
                        // Add trace ID filter if provided
                        if (traceId) {
                            esQuery.bool.must.push({
                                term: { 'trace_id': traceId }
                            });
                        }
                        // Add span ID filter if provided
                        if (spanId) {
                            esQuery.bool.must.push({
                                term: { 'span_id': spanId }
                            });
                        }
                        // Add text search if provided
                        if (query) {
                            textFields = ['body', 'Body', 'message', 'Message', 'log.message'];
                            wildcardQueries = textFields.map(function (field) {
                                var _a;
                                return ({
                                    wildcard: (_a = {},
                                        _a[field] = {
                                            value: "*".concat(query, "*"),
                                            case_insensitive: true
                                        },
                                        _a)
                                });
                            });
                            matchQuery = {
                                multi_match: {
                                    query: query,
                                    fields: ['*'],
                                    type: 'best_fields',
                                    fuzziness: 'AUTO'
                                }
                            };
                            esQuery.bool.must.push({
                                bool: {
                                    should: __spreadArray(__spreadArray([], wildcardQueries, true), [matchQuery], false),
                                    minimum_should_match: 1
                                }
                            });
                        }
                        searchRequest = {
                            index: '.ds-logs-*,logs*,*logs*,otel-logs*',
                            body: {
                                from: offset,
                                size: limit,
                                sort: [
                                    { '@timestamp': { order: sortDirection } }
                                ],
                                query: esQuery,
                                // Add runtime fields for consistent access to log data
                                runtime_mappings: {
                                    log_message: {
                                        type: 'keyword',
                                        script: {
                                            source: "\n                // Try to extract message from various fields\n                if (doc.containsKey('body') && doc['body'].size() > 0) {\n                  emit(doc['body'].value);\n                } else if (doc.containsKey('Body') && doc['Body'].size() > 0) {\n                  emit(doc['Body'].value);\n                } else if (doc.containsKey('message') && doc['message'].size() > 0) {\n                  emit(doc['message'].value);\n                } else if (doc.containsKey('Message') && doc['Message'].size() > 0) {\n                  emit(doc['Message'].value);\n                } else if (doc.containsKey('log.message') && doc['log.message'].size() > 0) {\n                  emit(doc['log.message'].value);\n                } else {\n                  emit(\"No message content available\");\n                }\n              "
                                        }
                                    },
                                    service_name: {
                                        type: 'keyword',
                                        script: {
                                            source: "\n                // Try to extract service name from various fields\n                if (doc.containsKey('resource.service.name') && doc['resource.service.name'].size() > 0) {\n                  emit(doc['resource.service.name'].value);\n                } else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n                  emit(doc['service.name'].value);\n                } else if (doc.containsKey('Resource.attributes.service.name') && doc['Resource.attributes.service.name'].size() > 0) {\n                  emit(doc['Resource.attributes.service.name'].value);\n                } else if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {\n                  emit(doc['resource.attributes.service.name'].value);\n                } else {\n                  emit(\"unknown-service\");\n                }\n              "
                                        }
                                    },
                                    log_level: {
                                        type: 'keyword',
                                        script: {
                                            source: "\n                // Try to extract log level from various fields\n                if (doc.containsKey('level') && doc['level'].size() > 0) {\n                  emit(doc['level'].value);\n                } else if (doc.containsKey('severity_text') && doc['severity_text'].size() > 0) {\n                  emit(doc['severity_text'].value);\n                } else if (doc.containsKey('Severity') && doc['Severity'].size() > 0) {\n                  emit(doc['Severity'].value);\n                } else {\n                  emit(\"INFO\");\n                }\n              "
                                        }
                                    }
                                }
                            }
                        };
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 3, , 4]);
                        // Execute the search
                        logger_js_1.logger.debug('[ES Adapter] Executing log search', { request: JSON.stringify(searchRequest) });
                        return [4 /*yield*/, this.esCore.callEsRequest('POST', "".concat(searchRequest.index, "/_search"), searchRequest.body)];
                    case 2:
                        response = _d.sent();
                        // Process the results
                        if (!response.hits || !response.hits.hits || response.hits.hits.length === 0) {
                            logger_js_1.logger.info('[ES Adapter] No logs found matching criteria');
                            return [2 /*return*/, []];
                        }
                        logs = response.hits.hits.map(function (hit) {
                            var source = hit._source;
                            // Extract key fields with fallbacks
                            var timestamp = source['@timestamp'] || source.timestamp || '';
                            var message = source.body || source.Body || source.message || source.Message || source['log.message'] || 'No message content';
                            var level = source.level || source.severity_text || source.Severity || 'INFO';
                            var serviceName = source['resource.service.name'] ||
                                source['service.name'] ||
                                source['Resource.attributes.service.name'] ||
                                source['resource.attributes.service.name'] ||
                                'unknown-service';
                            // Extract trace context if available
                            var traceId = source.trace_id || source['trace.id'] || '';
                            var spanId = source.span_id || source['span.id'] || '';
                            // Return the structured log object
                            return __assign(__assign({}, source), { // Include all original fields
                                timestamp: timestamp, service: serviceName, level: level, message: message, trace_id: traceId, span_id: spanId, _id: hit._id, _index: hit._index });
                        });
                        logger_js_1.logger.info('[ES Adapter] Returning logs', { count: logs.length });
                        return [2 /*return*/, logs];
                    case 3:
                        error_1 = _d.sent();
                        logger_js_1.logger.error('[ES Adapter] Error searching logs', { error: error_1 });
                        return [2 /*return*/, []];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return LogSearchModule;
}());
exports.LogSearchModule = LogSearchModule;

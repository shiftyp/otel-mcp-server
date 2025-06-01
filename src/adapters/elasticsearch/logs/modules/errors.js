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
exports.LogErrorsModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
var logScripts_js_1 = require("../../scripts/logs/logScripts.js");
/**
 * Module for log error analysis functionality
 */
var LogErrorsModule = /** @class */ (function () {
    function LogErrorsModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * Get top errors from logs
     * @param options Options for error analysis
     * @returns Array of top errors with counts and examples
     */
    LogErrorsModule.prototype.topErrors = function (options) {
        return __awaiter(this, void 0, void 0, function () {
            var startTime, endTime, service, _a, limit, _b, includeExamples, esQuery, timeFilter, searchRequest, response, errors, error_1;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] topErrors called', { options: options });
                        startTime = options.startTime, endTime = options.endTime, service = options.service, _a = options.limit, limit = _a === void 0 ? 10 : _a, _b = options.includeExamples, includeExamples = _b === void 0 ? true : _b;
                        esQuery = {
                            bool: {
                                must: [
                                    // Look for logs with error level
                                    {
                                        bool: {
                                            should: [
                                                { term: { 'level': 'ERROR' } },
                                                { term: { 'level': 'Error' } },
                                                { term: { 'level': 'error' } },
                                                { term: { 'severity_text': 'ERROR' } },
                                                { term: { 'severity_text': 'Error' } },
                                                { term: { 'severity_text': 'error' } },
                                                { term: { 'Severity': 'ERROR' } },
                                                { term: { 'Severity': 'Error' } },
                                                { term: { 'Severity': 'error' } }
                                            ],
                                            minimum_should_match: 1
                                        }
                                    }
                                ]
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
                        searchRequest = {
                            index: '.ds-logs-*,logs*,*logs*,otel-logs*',
                            body: {
                                size: 0, // We don't need the actual documents, just the aggregations
                                query: esQuery,
                                runtime_mappings: {
                                    error_message: {
                                        type: 'keyword',
                                        script: {
                                            source: logScripts_js_1.extractFirstLineErrorMessage
                                        }
                                    },
                                    service_name: {
                                        type: 'keyword',
                                        script: {
                                            source: "\n                // Try to extract service name from various fields\n                if (doc.containsKey('resource.service.name') && doc['resource.service.name'].size() > 0) {\n                  emit(doc['resource.service.name'].value);\n                } else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n                  emit(doc['service.name'].value);\n                } else if (doc.containsKey('Resource.attributes.service.name') && doc['Resource.attributes.service.name'].size() > 0) {\n                  emit(doc['Resource.attributes.service.name'].value);\n                } else if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {\n                  emit(doc['resource.attributes.service.name'].value);\n                } else {\n                  emit(\"unknown-service\");\n                }\n              "
                                        }
                                    }
                                },
                                aggs: {
                                    // Group by error message
                                    error_messages: {
                                        terms: {
                                            field: 'error_message',
                                            size: limit,
                                            order: { '_count': 'desc' }
                                        },
                                        aggs: {
                                            // Group by service within each error message
                                            services: {
                                                terms: {
                                                    field: 'service_name',
                                                    size: 10
                                                },
                                                aggs: {
                                                    // Get the most recent examples for each error
                                                    recent_examples: {
                                                        top_hits: {
                                                            size: includeExamples ? 3 : 0,
                                                            sort: [{ '@timestamp': { order: 'desc' } }],
                                                            _source: ['@timestamp', 'body', 'Body', 'message', 'Message', 'log.message', 'trace_id', 'service_name']
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        };
                        _c.label = 1;
                    case 1:
                        _c.trys.push([1, 3, , 4]);
                        // Execute the search
                        logger_js_1.logger.debug('[ES Adapter] Executing error analysis', { request: JSON.stringify(searchRequest) });
                        return [4 /*yield*/, this.esCore.callEsRequest('POST', "".concat(searchRequest.index, "/_search"), searchRequest.body)];
                    case 2:
                        response = _c.sent();
                        // Process the results
                        if (!response.aggregations || !response.aggregations.error_messages || !response.aggregations.error_messages.buckets) {
                            logger_js_1.logger.info('[ES Adapter] No errors found');
                            return [2 /*return*/, []];
                        }
                        errors = response.aggregations.error_messages.buckets.map(function (errorBucket) {
                            // Skip empty error messages
                            if (!errorBucket.key || errorBucket.key === 'Unknown error') {
                                return null;
                            }
                            // Process service information
                            var serviceInfo = errorBucket.services.buckets[0] || { key: 'unknown-service', doc_count: 0 };
                            // Create the error object
                            var errorObj = {
                                error: errorBucket.key,
                                count: errorBucket.doc_count,
                                service: serviceInfo.key
                            };
                            // Add examples if requested
                            if (includeExamples && serviceInfo.recent_examples && serviceInfo.recent_examples.hits.hits.length > 0) {
                                errorObj.examples = serviceInfo.recent_examples.hits.hits.map(function (hit) {
                                    var source = hit._source;
                                    return {
                                        timestamp: source['@timestamp'] || '',
                                        message: source.body || source.Body || source.message || source.Message || source['log.message'] || 'No message content',
                                        trace_id: source.trace_id || '',
                                        service: serviceInfo.key
                                    };
                                });
                            }
                            return errorObj;
                        }).filter(Boolean);
                        logger_js_1.logger.info('[ES Adapter] Returning top errors', { count: errors.length });
                        return [2 /*return*/, errors];
                    case 3:
                        error_1 = _c.sent();
                        logger_js_1.logger.error('[ES Adapter] Error analyzing logs for errors', { error: error_1 });
                        return [2 /*return*/, []];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    return LogErrorsModule;
}());
exports.LogErrorsModule = LogErrorsModule;

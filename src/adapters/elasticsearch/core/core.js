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
exports.ElasticsearchCore = void 0;
var axios_1 = require("axios");
var events_1 = require("events");
var uuid_1 = require("uuid");
var searchAdapter_js_1 = require("../../base/searchAdapter.js");
var logger_js_1 = require("../../../utils/logger.js");
var ElasticsearchCore = /** @class */ (function (_super) {
    __extends(ElasticsearchCore, _super);
    function ElasticsearchCore(options) {
        var _this = _super.call(this) || this;
        _this.options = options;
        var axiosConfig = {
            baseURL: options.baseURL,
            timeout: options.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        // Set up authentication
        if (options.apiKey) {
            axiosConfig.headers = __assign(__assign({}, axiosConfig.headers), { 'Authorization': "ApiKey ".concat(options.apiKey) });
        }
        else if (options.username && options.password) {
            axiosConfig.auth = {
                username: options.username,
                password: options.password,
            };
        }
        _this.client = axios_1.default.create(axiosConfig);
        // Add request interceptor for retry logic
        _this.client.interceptors.response.use(undefined, function (error) { return __awaiter(_this, void 0, void 0, function () {
            var config, maxRetries, retryDelay_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        config = error.config;
                        if (!config) {
                            return [2 /*return*/, Promise.reject(error)];
                        }
                        // Set default retry count
                        config.__retryCount = config.__retryCount || 0;
                        maxRetries = this.options.maxRetries || 3;
                        if (!(config.__retryCount < maxRetries)) return [3 /*break*/, 2];
                        config.__retryCount += 1;
                        retryDelay_1 = this.options.retryDelay || 1000;
                        logger_js_1.logger.warn("Retrying Elasticsearch request (".concat(config.__retryCount, "/").concat(maxRetries, ")"), {
                            url: config.url,
                            method: config.method,
                            retryDelay: retryDelay_1,
                        });
                        // Delay the retry
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, retryDelay_1); })];
                    case 1:
                        // Delay the retry
                        _a.sent();
                        return [2 /*return*/, this.client(config)];
                    case 2: return [2 /*return*/, Promise.reject(error)];
                }
            });
        }); });
        return _this;
    }
    /**
     * Expose a public wrapper for the protected request method for use by external tools.
     */
    ElasticsearchCore.prototype.callEsRequest = function (method, url, data, config) {
        return this.request(method, url, data, config);
    };
    /**
     * Make a request to Elasticsearch
     * Enhanced with better error handling and request validation
     */
    ElasticsearchCore.prototype.request = function (method, url, data, config) {
        return __awaiter(this, void 0, void 0, function () {
            var requestId, sanitizedUrl, response, error_1, axiosError, responseData, esError, rootCause, enhancedError;
            var _a, _b, _c, _d, _e, _f, _g, _h;
            return __generator(this, function (_j) {
                switch (_j.label) {
                    case 0:
                        _j.trys.push([0, 2, , 3]);
                        requestId = (0, uuid_1.v4)();
                        sanitizedUrl = url.startsWith('/') ? url : "/".concat(url);
                        // Validate the request data for search operations
                        if (method.toUpperCase() === 'POST' && sanitizedUrl.includes('_search') && data) {
                            // Log a warning for very large result sizes but don't limit them
                            // Note: Elasticsearch's default max result window is 10,000 documents
                            if (data.size && typeof data.size === 'number' && data.size > 10000) {
                                logger_js_1.logger.warn("[ES:".concat(requestId, "] Large result size requested (").concat(data.size, "). Note that Elasticsearch's default max_result_window is 10000."), { method: method, url: url });
                            }
                            // Ensure track_total_hits is enabled for accurate result counts
                            if (data.track_total_hits === undefined) {
                                data.track_total_hits = true;
                            }
                        }
                        logger_js_1.logger.debug("[ES:".concat(requestId, "] Request"), { method: method, sanitizedUrl: sanitizedUrl, data: data });
                        return [4 /*yield*/, this.client.request(__assign({ method: method, url: sanitizedUrl, data: data }, config))];
                    case 1:
                        response = _j.sent();
                        logger_js_1.logger.debug("[ES:".concat(requestId, "] Response"), {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers,
                            hits: (_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.hits) === null || _b === void 0 ? void 0 : _b.total) === null || _c === void 0 ? void 0 : _c.value,
                        });
                        return [2 /*return*/, response.data];
                    case 2:
                        error_1 = _j.sent();
                        if (axios_1.default.isAxiosError(error_1)) {
                            axiosError = error_1;
                            responseData = (_d = axiosError.response) === null || _d === void 0 ? void 0 : _d.data;
                            esError = responseData === null || responseData === void 0 ? void 0 : responseData.error;
                            rootCause = (_e = esError === null || esError === void 0 ? void 0 : esError.root_cause) === null || _e === void 0 ? void 0 : _e[0];
                            logger_js_1.logger.error('Elasticsearch request failed', {
                                method: method,
                                url: url,
                                status: (_f = axiosError.response) === null || _f === void 0 ? void 0 : _f.status,
                                statusText: (_g = axiosError.response) === null || _g === void 0 ? void 0 : _g.statusText,
                                message: axiosError.message,
                                type: esError === null || esError === void 0 ? void 0 : esError.type,
                                reason: (esError === null || esError === void 0 ? void 0 : esError.reason) || (rootCause === null || rootCause === void 0 ? void 0 : rootCause.reason),
                                index: rootCause === null || rootCause === void 0 ? void 0 : rootCause.index,
                            });
                            // Enhance error with Elasticsearch specific details
                            if (esError) {
                                enhancedError = new Error("Elasticsearch error: ".concat(esError.type || 'unknown', " - ").concat(esError.reason || (rootCause === null || rootCause === void 0 ? void 0 : rootCause.reason) || axiosError.message));
                                enhancedError.esError = esError;
                                enhancedError.status = (_h = axiosError.response) === null || _h === void 0 ? void 0 : _h.status;
                                throw enhancedError;
                            }
                        }
                        else {
                            logger_js_1.logger.error('Elasticsearch request failed with non-Axios error', {
                                method: method,
                                url: url,
                                error: error_1 instanceof Error ? error_1.message : String(error_1),
                            });
                        }
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get a list of indices from Elasticsearch
     */
    ElasticsearchCore.prototype.getIndices = function () {
        return __awaiter(this, void 0, void 0, function () {
            var response, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.callEsRequest('GET', '/_cat/indices?format=json')];
                    case 1:
                        response = _a.sent();
                        return [2 /*return*/, response.map(function (index) { return index.index; })];
                    case 2:
                        error_2 = _a.sent();
                        logger_js_1.logger.error('Failed to get Elasticsearch indices', { error: error_2 });
                        return [2 /*return*/, []];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if Elasticsearch is available
     */
    ElasticsearchCore.prototype.checkConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            var error_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.callEsRequest('GET', '/')];
                    case 1:
                        _a.sent();
                        return [2 /*return*/, true];
                    case 2:
                        error_3 = _a.sent();
                        logger_js_1.logger.error('Failed to connect to Elasticsearch', { error: error_3 });
                        return [2 /*return*/, false];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get information about Elasticsearch
     */
    ElasticsearchCore.prototype.getInfo = function () {
        return __awaiter(this, void 0, void 0, function () {
            var error_4;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.callEsRequest('GET', '/')];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        error_4 = _a.sent();
                        logger_js_1.logger.error('Failed to get Elasticsearch info', { error: error_4 });
                        return [2 /*return*/, { version: { number: 'unknown' } }];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Get the type of search engine
     */
    ElasticsearchCore.prototype.getType = function () {
        return searchAdapter_js_1.SearchEngineType.ELASTICSEARCH;
    };
    /**
     * Get the version of Elasticsearch
     */
    ElasticsearchCore.prototype.getVersion = function () {
        return __awaiter(this, void 0, void 0, function () {
            var info, error_5;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.getInfo()];
                    case 1:
                        info = _a.sent();
                        return [2 /*return*/, info.version.number];
                    case 2:
                        error_5 = _a.sent();
                        logger_js_1.logger.error('Failed to get Elasticsearch version', { error: error_5 });
                        return [2 /*return*/, 'unknown'];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if a specific feature is supported by Elasticsearch
     * @param feature The feature to check
     */
    ElasticsearchCore.prototype.supportsFeature = function (feature) {
        // Default feature support for Elasticsearch
        switch (feature) {
            case searchAdapter_js_1.SearchEngineFeature.RUNTIME_FIELDS:
            case searchAdapter_js_1.SearchEngineFeature.PAINLESS_SCRIPTING:
            case searchAdapter_js_1.SearchEngineFeature.FIELD_COLLAPSING:
            case searchAdapter_js_1.SearchEngineFeature.ASYNC_SEARCH:
            case searchAdapter_js_1.SearchEngineFeature.SEARCH_AFTER:
            case searchAdapter_js_1.SearchEngineFeature.POINT_IN_TIME:
            case searchAdapter_js_1.SearchEngineFeature.COMPOSITE_AGGREGATIONS:
            case searchAdapter_js_1.SearchEngineFeature.PIPELINE_AGGREGATIONS:
                return true;
            case searchAdapter_js_1.SearchEngineFeature.ML_ANOMALY_DETECTION:
                return true; // Elasticsearch has its own ML capabilities
            default:
                return false;
        }
    };
    return ElasticsearchCore;
}(events_1.EventEmitter));
exports.ElasticsearchCore = ElasticsearchCore;

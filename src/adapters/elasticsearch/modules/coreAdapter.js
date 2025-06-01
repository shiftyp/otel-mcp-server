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
exports.CoreAdapter = void 0;
var core_js_1 = require("../core/core.js");
var logger_js_1 = require("../../../utils/logger.js");
var errorHandling_js_1 = require("../../../utils/errorHandling.js");
/**
 * Core functionality for the Elasticsearch Adapter
 */
var CoreAdapter = /** @class */ (function () {
    function CoreAdapter(options) {
        this.coreAdapter = new core_js_1.ElasticsearchCore(options);
    }
    /**
     * Make a request to Elasticsearch
     */
    CoreAdapter.prototype.callRequest = function (method, url, data, config) {
        return this.coreAdapter.callEsRequest(method, url, data, config);
    };
    /**
     * Get a list of indices in Elasticsearch
     */
    CoreAdapter.prototype.getIndices = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                try {
                    logger_js_1.logger.info('[CoreAdapter] Getting indices');
                    return [2 /*return*/, this.coreAdapter.getIndices()];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting indices: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Check if the Elasticsearch connection is working
     */
    CoreAdapter.prototype.checkConnection = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                try {
                    logger_js_1.logger.info('[CoreAdapter] Checking connection');
                    return [2 /*return*/, this.coreAdapter.checkConnection()];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error checking connection: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get information about the Elasticsearch cluster
     */
    CoreAdapter.prototype.getInfo = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                try {
                    logger_js_1.logger.info('[CoreAdapter] Getting info');
                    return [2 /*return*/, this.coreAdapter.getInfo()];
                }
                catch (error) {
                    return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting info: ".concat(error instanceof Error ? error.message : String(error)))];
                }
                return [2 /*return*/];
            });
        });
    };
    /**
     * Get the Elasticsearch version
     */
    CoreAdapter.prototype.getVersion = function () {
        return __awaiter(this, void 0, void 0, function () {
            var info, version, error_1;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[CoreAdapter] Getting version');
                        return [4 /*yield*/, this.getInfo()];
                    case 1:
                        info = _b.sent();
                        if ((0, errorHandling_js_1.isErrorResponse)(info)) {
                            return [2 /*return*/, info];
                        }
                        version = ((_a = info === null || info === void 0 ? void 0 : info.version) === null || _a === void 0 ? void 0 : _a.number) || 'unknown';
                        return [2 /*return*/, version];
                    case 2:
                        error_1 = _b.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error getting version: ".concat(error_1 instanceof Error ? error_1.message : String(error_1)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * Check if a feature is supported
     */
    CoreAdapter.prototype.supportsFeature = function (feature) {
        // List of supported features
        var supportedFeatures = [
            'search',
            'aggregations',
            'scripting',
            'runtime_fields'
        ];
        return supportedFeatures.includes(feature);
    };
    /**
     * Legacy method for backward compatibility
     */
    CoreAdapter.prototype.callEsRequest = function (method, url, data, config) {
        return this.callRequest(method, url, data, config);
    };
    /**
     * Discover resources in Elasticsearch
     */
    CoreAdapter.prototype.discoverResources = function () {
        return __awaiter(this, void 0, void 0, function () {
            var indices, telemetryIndices, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        logger_js_1.logger.info('[CoreAdapter] Discovering resources');
                        return [4 /*yield*/, this.getIndices()];
                    case 1:
                        indices = _a.sent();
                        if ((0, errorHandling_js_1.isErrorResponse)(indices)) {
                            return [2 /*return*/, indices];
                        }
                        telemetryIndices = indices.filter(function (index) {
                            return index.includes('logs') ||
                                index.includes('metrics') ||
                                index.includes('traces');
                        });
                        // Return resources
                        return [2 /*return*/, telemetryIndices.map(function (index) { return ({
                                name: index,
                                type: 'index',
                                engine: 'elasticsearch'
                            }); })];
                    case 2:
                        error_2 = _a.sent();
                        return [2 /*return*/, (0, errorHandling_js_1.createErrorResponse)("Error discovering resources: ".concat(error_2 instanceof Error ? error_2.message : String(error_2)))];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return CoreAdapter;
}());
exports.CoreAdapter = CoreAdapter;

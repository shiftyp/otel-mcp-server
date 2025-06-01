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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogFieldsModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
/**
 * Module for log field discovery and management
 */
var LogFieldsModule = /** @class */ (function () {
    function LogFieldsModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * List all log fields and their types from logs indices
     * @param includeSourceDocument Whether to include fields from the _source document
     * @returns Array of { name, type, count, schema }
     */
    LogFieldsModule.prototype.listLogFields = function () {
        return __awaiter(this, arguments, void 0, function (includeSourceDocument) {
            var resp, fields, fieldCounts, fieldTypes, fieldSchemas, _i, _a, indexName, indexMapping, _b, _c, fieldName;
            if (includeSourceDocument === void 0) { includeSourceDocument = true; }
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] listLogFields called', { includeSourceDocument: includeSourceDocument });
                        // Use a comprehensive pattern to match all possible logs indices
                        logger_js_1.logger.info('[ES Adapter] About to request logs mapping');
                        return [4 /*yield*/, this.esCore.callEsRequest('GET', '/.ds-logs-*,logs*,*logs*,otel-logs*/_mapping').catch(function (err) {
                                logger_js_1.logger.warn('[ES Adapter] Error getting logs mapping', { error: err.message, stack: err.stack });
                                return {};
                            })];
                    case 1:
                        resp = _d.sent();
                        logger_js_1.logger.info('[ES Adapter] Got logs mapping response', {
                            responseKeys: Object.keys(resp),
                            responseSize: JSON.stringify(resp).length
                        });
                        // If no indices were found, return an empty array
                        if (Object.keys(resp).length === 0) {
                            logger_js_1.logger.info('[ES Adapter] No logs indices found, returning empty array');
                            return [2 /*return*/, []];
                        }
                        fields = [];
                        fieldCounts = {};
                        fieldTypes = {};
                        fieldSchemas = {};
                        // Iterate through each index
                        for (_i = 0, _a = Object.keys(resp); _i < _a.length; _i++) {
                            indexName = _a[_i];
                            indexMapping = resp[indexName].mappings;
                            // Process properties if they exist
                            if (indexMapping.properties) {
                                this.processProperties(indexMapping.properties, '', fieldCounts, fieldTypes, fieldSchemas);
                            }
                            // Process runtime fields if they exist
                            if (indexMapping.runtime) {
                                this.processRuntimeFields(indexMapping.runtime, fieldCounts, fieldTypes, fieldSchemas);
                            }
                            // Process _source fields if requested
                            if (includeSourceDocument && indexMapping._source) {
                                this.processSourceFields(indexMapping._source, fieldCounts, fieldTypes, fieldSchemas);
                            }
                        }
                        // Convert the collected data into the result format
                        for (_b = 0, _c = Object.keys(fieldCounts); _b < _c.length; _b++) {
                            fieldName = _c[_b];
                            fields.push({
                                name: fieldName,
                                type: fieldTypes[fieldName] || 'unknown',
                                count: fieldCounts[fieldName] || 0,
                                schema: fieldSchemas[fieldName] || {}
                            });
                        }
                        // Sort fields by name for consistency
                        fields.sort(function (a, b) { return a.name.localeCompare(b.name); });
                        logger_js_1.logger.info('[ES Adapter] Returning log fields', { count: fields.length });
                        return [2 /*return*/, fields];
                }
            });
        });
    };
    /**
     * Process properties from Elasticsearch mapping
     * @param properties Properties object from mapping
     * @param prefix Current field name prefix
     * @param fieldCounts Object to track field counts
     * @param fieldTypes Object to track field types
     * @param fieldSchemas Object to track field schemas
     */
    LogFieldsModule.prototype.processProperties = function (properties, prefix, fieldCounts, fieldTypes, fieldSchemas) {
        for (var _i = 0, _a = Object.keys(properties); _i < _a.length; _i++) {
            var propName = _a[_i];
            var property = properties[propName];
            var fieldName = prefix ? "".concat(prefix, ".").concat(propName) : propName;
            // Track this field
            fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
            // Determine the field type
            if (property.type) {
                fieldTypes[fieldName] = property.type;
                fieldSchemas[fieldName] = __assign({}, property);
            }
            // Recursively process nested properties
            if (property.properties) {
                this.processProperties(property.properties, fieldName, fieldCounts, fieldTypes, fieldSchemas);
            }
            // Handle special case for fields with multiple types
            if (property.fields) {
                this.processProperties(property.fields, fieldName, fieldCounts, fieldTypes, fieldSchemas);
            }
        }
    };
    /**
     * Process runtime fields from Elasticsearch mapping
     * @param runtimeFields Runtime fields object from mapping
     * @param fieldCounts Object to track field counts
     * @param fieldTypes Object to track field types
     * @param fieldSchemas Object to track field schemas
     */
    LogFieldsModule.prototype.processRuntimeFields = function (runtimeFields, fieldCounts, fieldTypes, fieldSchemas) {
        for (var _i = 0, _a = Object.keys(runtimeFields); _i < _a.length; _i++) {
            var fieldName = _a[_i];
            var runtimeField = runtimeFields[fieldName];
            // Track this field
            fieldCounts[fieldName] = (fieldCounts[fieldName] || 0) + 1;
            // Determine the field type
            if (runtimeField.type) {
                fieldTypes[fieldName] = "runtime_".concat(runtimeField.type);
                fieldSchemas[fieldName] = __assign(__assign({}, runtimeField), { runtime: true });
            }
        }
    };
    /**
     * Process _source fields from Elasticsearch mapping
     * @param sourceFields Source fields object from mapping
     * @param fieldCounts Object to track field counts
     * @param fieldTypes Object to track field types
     * @param fieldSchemas Object to track field schemas
     */
    LogFieldsModule.prototype.processSourceFields = function (sourceFields, fieldCounts, fieldTypes, fieldSchemas) {
        // Add _source field
        fieldCounts['_source'] = (fieldCounts['_source'] || 0) + 1;
        fieldTypes['_source'] = 'object';
        fieldSchemas['_source'] = { type: 'object' };
        // Add other metadata fields if they exist
        var metaFields = ['_id', '_index', '_score', '_type'];
        for (var _i = 0, metaFields_1 = metaFields; _i < metaFields_1.length; _i++) {
            var metaField = metaFields_1[_i];
            fieldCounts[metaField] = (fieldCounts[metaField] || 0) + 1;
            fieldTypes[metaField] = 'keyword';
            fieldSchemas[metaField] = { type: 'keyword', meta: true };
        }
    };
    return LogFieldsModule;
}());
exports.LogFieldsModule = LogFieldsModule;

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
exports.MetricFieldsModule = void 0;
var logger_js_1 = require("../../../../utils/logger.js");
/**
 * Module for metric field discovery and management
 */
var MetricFieldsModule = /** @class */ (function () {
    function MetricFieldsModule(esCore) {
        this.esCore = esCore;
    }
    /**
     * List all metric fields and their types from metrics indices, filtering out metadata fields.
     * @returns Array of { name, type }
     */
    MetricFieldsModule.prototype.listMetricFields = function () {
        return __awaiter(this, void 0, void 0, function () {
            var resp, ignoreFields, fields, fieldTypes, _i, _a, indexName, indexMapping, _b, _c, fieldName;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        logger_js_1.logger.info('[ES Adapter] listMetricFields called');
                        // Use a comprehensive pattern to match all possible metrics indices
                        logger_js_1.logger.info('[ES Adapter] About to request metrics mapping');
                        return [4 /*yield*/, this.esCore.callEsRequest('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping').catch(function (err) {
                                logger_js_1.logger.warn('[ES Adapter] Error getting metrics mapping', { error: err.message, stack: err.stack });
                                return {};
                            })];
                    case 1:
                        resp = _d.sent();
                        logger_js_1.logger.info('[ES Adapter] Got metrics mapping response', {
                            responseKeys: Object.keys(resp),
                            responseSize: JSON.stringify(resp).length
                        });
                        // If no indices were found, return an empty array
                        if (Object.keys(resp).length === 0) {
                            logger_js_1.logger.info('[ES Adapter] No metrics indices found, returning empty array');
                            return [2 /*return*/, []];
                        }
                        ignoreFields = new Set([
                            '_id', '_index', '_score', '_source', '_type', '_version'
                        ]);
                        fields = [];
                        fieldTypes = {};
                        // Iterate through each index
                        for (_i = 0, _a = Object.keys(resp); _i < _a.length; _i++) {
                            indexName = _a[_i];
                            indexMapping = resp[indexName].mappings;
                            // Process properties if they exist
                            if (indexMapping.properties) {
                                this.processProperties(indexMapping.properties, '', fieldTypes, ignoreFields);
                            }
                            // Process runtime fields if they exist
                            if (indexMapping.runtime) {
                                this.processRuntimeFields(indexMapping.runtime, fieldTypes);
                            }
                        }
                        // Convert the collected data into the result format
                        for (_b = 0, _c = Object.keys(fieldTypes); _b < _c.length; _b++) {
                            fieldName = _c[_b];
                            fields.push({
                                name: fieldName,
                                type: fieldTypes[fieldName]
                            });
                        }
                        // Sort fields by name for consistency
                        fields.sort(function (a, b) { return a.name.localeCompare(b.name); });
                        logger_js_1.logger.info('[ES Adapter] Returning metric fields', { count: fields.length });
                        return [2 /*return*/, fields];
                }
            });
        });
    };
    /**
     * Process properties from Elasticsearch mapping
     * @param properties Properties object from mapping
     * @param prefix Current field name prefix
     * @param fieldTypes Object to track field types
     * @param ignoreFields Set of fields to ignore
     */
    MetricFieldsModule.prototype.processProperties = function (properties, prefix, fieldTypes, ignoreFields) {
        for (var _i = 0, _a = Object.keys(properties); _i < _a.length; _i++) {
            var propName = _a[_i];
            var property = properties[propName];
            var fieldName = prefix ? "".concat(prefix, ".").concat(propName) : propName;
            // Skip ignored fields
            if (ignoreFields.has(fieldName)) {
                continue;
            }
            // Determine the field type
            if (property.type) {
                fieldTypes[fieldName] = property.type;
            }
            // Recursively process nested properties
            if (property.properties) {
                this.processProperties(property.properties, fieldName, fieldTypes, ignoreFields);
            }
            // Handle special case for fields with multiple types
            if (property.fields) {
                this.processProperties(property.fields, fieldName, fieldTypes, ignoreFields);
            }
        }
    };
    /**
     * Process runtime fields from Elasticsearch mapping
     * @param runtimeFields Runtime fields object from mapping
     * @param fieldTypes Object to track field types
     */
    MetricFieldsModule.prototype.processRuntimeFields = function (runtimeFields, fieldTypes) {
        for (var _i = 0, _a = Object.keys(runtimeFields); _i < _a.length; _i++) {
            var fieldName = _a[_i];
            var runtimeField = runtimeFields[fieldName];
            // Determine the field type
            if (runtimeField.type) {
                fieldTypes[fieldName] = "runtime_".concat(runtimeField.type);
            }
        }
    };
    return MetricFieldsModule;
}());
exports.MetricFieldsModule = MetricFieldsModule;

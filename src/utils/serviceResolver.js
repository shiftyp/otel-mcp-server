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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceResolver = exports.SERVICE_FIELD_PATHS = void 0;
var queryBuilder_js_1 = require("./queryBuilder.js");
var errorHandling_js_1 = require("./errorHandling.js");
/**
 * Service field paths for different telemetry types
 */
exports.SERVICE_FIELD_PATHS = {
    TRACES: 'Resource.service.name',
    LOGS: 'Resource.service.name',
    METRICS: 'service.name',
    // Add any other service field paths as needed
};
/**
 * Default options for service resolution
 */
var DEFAULT_OPTIONS = {
    exactMatch: false,
    allowWildcards: true,
    caseSensitive: false,
    fieldPath: undefined
};
/**
 * Utility class for consistent service name handling across the codebase
 */
var ServiceResolver = /** @class */ (function () {
    function ServiceResolver() {
    }
    /**
     * Creates a query for filtering by service name
     * @param serviceName Service name or pattern
     * @param telemetryType Type of telemetry (traces, logs, metrics)
     * @param options Service resolver options
     * @returns Query for filtering by service
     */
    ServiceResolver.createServiceQuery = function (serviceName, telemetryType, options) {
        if (options === void 0) { options = {}; }
        try {
            var mergedOptions = __assign(__assign({}, DEFAULT_OPTIONS), options);
            var fieldPath = mergedOptions.fieldPath || exports.SERVICE_FIELD_PATHS[telemetryType];
            if (!fieldPath) {
                return (0, errorHandling_js_1.createErrorResponse)("Unknown telemetry type: ".concat(telemetryType));
            }
            // Handle empty service name
            if (!serviceName || serviceName.trim() === '') {
                return (0, errorHandling_js_1.createErrorResponse)('Service name cannot be empty');
            }
            // Apply case sensitivity
            var normalizedServiceName = serviceName;
            if (!mergedOptions.caseSensitive) {
                normalizedServiceName = serviceName.toLowerCase();
            }
            // Handle exact matches
            if (mergedOptions.exactMatch) {
                return (0, queryBuilder_js_1.createTermQuery)(fieldPath, normalizedServiceName);
            }
            // Handle wildcards
            if (mergedOptions.allowWildcards) {
                // If service name already contains wildcards, use as is
                if (normalizedServiceName.includes('*')) {
                    return (0, queryBuilder_js_1.createWildcardQuery)(fieldPath, normalizedServiceName);
                }
                // Otherwise, add wildcards for partial matching
                return (0, queryBuilder_js_1.createWildcardQuery)(fieldPath, "*".concat(normalizedServiceName, "*"));
            }
            // Default to query_string for flexibility
            return (0, queryBuilder_js_1.createQueryStringQuery)("".concat(fieldPath, ":*").concat(normalizedServiceName, "*"));
        }
        catch (error) {
            return (0, errorHandling_js_1.createErrorResponse)("Error creating service query: ".concat(error instanceof Error ? error.message : String(error)));
        }
    };
    /**
     * Normalizes a service name for consistent comparison
     * @param serviceName Service name to normalize
     * @param options Normalization options
     * @returns Normalized service name
     */
    ServiceResolver.normalizeServiceName = function (serviceName, options) {
        if (options === void 0) { options = {}; }
        if (!serviceName) {
            return '';
        }
        var normalized = serviceName.trim();
        if (!options.caseSensitive) {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    };
    /**
     * Checks if a service name matches a pattern
     * @param serviceName Service name to check
     * @param pattern Pattern to match against
     * @param options Matching options
     * @returns True if the service name matches the pattern
     */
    ServiceResolver.matchesPattern = function (serviceName, pattern, options) {
        if (options === void 0) { options = {}; }
        var normalizedService = this.normalizeServiceName(serviceName, options);
        var normalizedPattern = this.normalizeServiceName(pattern, options);
        // Handle exact match
        if (normalizedService === normalizedPattern) {
            return true;
        }
        // Handle wildcard patterns
        if (normalizedPattern.includes('*')) {
            var regexPattern = normalizedPattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*');
            var regex = new RegExp("^".concat(regexPattern, "$"), options.caseSensitive ? '' : 'i');
            return regex.test(normalizedService);
        }
        // Handle partial match
        return normalizedService.includes(normalizedPattern);
    };
    /**
     * Filters an array of services by a pattern
     * @param services Array of service names
     * @param pattern Pattern to filter by
     * @param options Filtering options
     * @returns Filtered array of services
     */
    ServiceResolver.filterServices = function (services, pattern, options) {
        var _this = this;
        if (options === void 0) { options = {}; }
        if (!pattern || pattern.trim() === '') {
            return services;
        }
        return services.filter(function (service) {
            return _this.matchesPattern(service, pattern, options);
        });
    };
    return ServiceResolver;
}());
exports.ServiceResolver = ServiceResolver;

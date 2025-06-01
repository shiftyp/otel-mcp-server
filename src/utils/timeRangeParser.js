"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRelativeTime = parseRelativeTime;
exports.normalizeTimestamp = normalizeTimestamp;
exports.parseTimeRange = parseTimeRange;
exports.getDefaultTimeRange = getDefaultTimeRange;
exports.formatTimestamp = formatTimestamp;
var errorHandling_js_1 = require("./errorHandling.js");
/**
 * Maps time units to milliseconds
 */
var TIME_UNIT_TO_MS = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'w': 7 * 24 * 60 * 60 * 1000,
    'M': 30 * 24 * 60 * 60 * 1000, // Approximate
    'y': 365 * 24 * 60 * 60 * 1000 // Approximate
};
/**
 * Parses a relative time expression (e.g., "now-1h")
 * @param expression Relative time expression
 * @returns ISO timestamp string
 */
function parseRelativeTime(expression) {
    // Handle 'now' case
    if (expression === 'now') {
        return new Date().toISOString();
    }
    // Parse relative time expressions like "now-1h"
    var relativeTimeRegex = /^now(-|\+)(\d+)([smhdwMy])$/;
    var match = expression.match(relativeTimeRegex);
    if (!match) {
        throw new Error("Invalid relative time expression: ".concat(expression));
    }
    var operation = match[1], valueStr = match[2], unit = match[3];
    var value = parseInt(valueStr, 10);
    var timeUnit = unit;
    if (!(timeUnit in TIME_UNIT_TO_MS)) {
        throw new Error("Invalid time unit: ".concat(timeUnit));
    }
    var now = new Date();
    var milliseconds = value * TIME_UNIT_TO_MS[timeUnit];
    if (operation === '-') {
        now.setTime(now.getTime() - milliseconds);
    }
    else {
        now.setTime(now.getTime() + milliseconds);
    }
    return now.toISOString();
}
/**
 * Validates and normalizes a timestamp string
 * @param timestamp ISO timestamp or relative time expression
 * @returns Normalized ISO timestamp
 */
function normalizeTimestamp(timestamp) {
    // Check if it's a relative time expression
    if (timestamp.startsWith('now')) {
        return parseRelativeTime(timestamp);
    }
    // Validate ISO format
    try {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) {
            throw new Error("Invalid timestamp: ".concat(timestamp));
        }
        return date.toISOString();
    }
    catch (error) {
        throw new Error("Invalid timestamp format: ".concat(timestamp));
    }
}
/**
 * Parses and validates a time range
 * @param startTime Start time (ISO timestamp or relative expression)
 * @param endTime End time (ISO timestamp or relative expression)
 * @returns Normalized time range or error response
 */
function parseTimeRange(startTime, endTime) {
    try {
        var normalizedStartTime = normalizeTimestamp(startTime);
        var normalizedEndTime = normalizeTimestamp(endTime);
        // Validate that start time is before end time
        if (new Date(normalizedStartTime) >= new Date(normalizedEndTime)) {
            return (0, errorHandling_js_1.createErrorResponse)('Start time must be before end time');
        }
        return {
            startTime: normalizedStartTime,
            endTime: normalizedEndTime
        };
    }
    catch (error) {
        return (0, errorHandling_js_1.createErrorResponse)("Time range parsing error: ".concat(error instanceof Error ? error.message : String(error)));
    }
}
/**
 * Gets a default time range (e.g., last hour)
 * @returns Default time range
 */
function getDefaultTimeRange() {
    return {
        startTime: parseRelativeTime('now-1h'),
        endTime: parseRelativeTime('now')
    };
}
/**
 * Formats a timestamp for display
 * @param timestamp ISO timestamp
 * @param format Format type
 * @returns Formatted timestamp string
 */
function formatTimestamp(timestamp, format) {
    if (format === void 0) { format = 'medium'; }
    var date = new Date(timestamp);
    switch (format) {
        case 'short':
            return date.toLocaleString(undefined, {
                hour: 'numeric',
                minute: 'numeric'
            });
        case 'long':
            return date.toLocaleString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric'
            });
        case 'medium':
        default:
            return date.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric'
            });
    }
}

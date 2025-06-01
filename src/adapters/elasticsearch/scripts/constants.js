"use strict";
/**
 * Constants for Elasticsearch Painless scripts
 *
 * This module exports Painless scripts as TypeScript constants, which:
 * 1. Improves performance by avoiding runtime file I/O
 * 2. Enables better IDE support, type safety, and compile-time validation
 * 3. Simplifies bundling and deployment
 * 4. Organizes scripts by domain (traces, logs, metrics)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRICS_SCRIPTS = exports.TRACES_SCRIPTS = exports.LOGS_SCRIPTS = void 0;
var scriptRegistry_js_1 = require("../../../utils/scriptRegistry.js");
// Register all scripts with the script registry
function registerScripts() {
    // Register logs scripts
    for (var _i = 0, _a = Object.entries(exports.LOGS_SCRIPTS); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], script = _b[1];
        var metadata = {
            name: key,
            description: "Logs script: ".concat(key),
            version: '1.0',
            domain: 'logs'
        };
        (0, scriptRegistry_js_1.getScriptRegistry)().registerScript("logs.".concat(key), script, metadata);
    }
    // Register traces scripts
    for (var _c = 0, _d = Object.entries(exports.TRACES_SCRIPTS); _c < _d.length; _c++) {
        var _e = _d[_c], key = _e[0], script = _e[1];
        var metadata = {
            name: key,
            description: "Traces script: ".concat(key),
            version: '1.0',
            domain: 'traces'
        };
        (0, scriptRegistry_js_1.getScriptRegistry)().registerScript("traces.".concat(key), script, metadata);
    }
    // Register metrics scripts
    for (var _f = 0, _g = Object.entries(exports.METRICS_SCRIPTS); _f < _g.length; _f++) {
        var _h = _g[_f], key = _h[0], script = _h[1];
        var metadata = {
            name: key,
            description: "Metrics script: ".concat(key),
            version: '1.0',
            domain: 'metrics'
        };
        (0, scriptRegistry_js_1.getScriptRegistry)().registerScript("metrics.".concat(key), script, metadata);
    }
}
/**
 * Logs-related Painless scripts
 */
exports.LOGS_SCRIPTS = {
    /**
     * Extracts error messages from log entries
     */
    ERROR_MESSAGE_EXTRACTOR: "\n    String message = \"\";\n    \n    // Try to extract from common error message fields\n    if (doc.containsKey('Body') && doc['Body'].size() > 0) {\n      message = doc['Body'].value;\n    } else if (doc.containsKey('body') && doc['body'].size() > 0) {\n      message = doc['body'].value;\n    } else if (doc.containsKey('message') && doc['message'].size() > 0) {\n      message = doc['message'].value;\n    } else if (doc.containsKey('Message') && doc['Message'].size() > 0) {\n      message = doc['Message'].value;\n    }\n    \n    // Extract just the first line for conciseness\n    if (message.length() > 0) {\n      int newlineIndex = message.indexOf(\"\\n\");\n      if (newlineIndex > 0) {\n        message = message.substring(0, newlineIndex);\n      }\n      \n      // Truncate very long messages\n      if (message.length() > 200) {\n        message = message.substring(0, 197) + \"...\";\n      }\n      \n      return message;\n    }\n    \n    // If no message found, check for status code\n    if (doc.containsKey('http.status_code') && doc['http.status_code'].size() > 0) {\n      int statusCode = doc['http.status_code'].value;\n      if (statusCode >= 400) {\n        return \"HTTP Error \" + statusCode;\n      }\n    }\n    \n    return \"Unknown error\";\n  ",
    /**
     * Extracts service name from log entries
     */
    SERVICE_NAME_EXTRACTOR: "\n    // Try to get service name from Resource attributes\n    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {\n      return doc['Resource.service.name'].value;\n    }\n    \n    // Fallback to service.name\n    if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n      return doc['service.name'].value;\n    }\n    \n    // Try nested attributes\n    if (doc.containsKey('Attributes.service.name') && doc['Attributes.service.name'].size() > 0) {\n      return doc['Attributes.service.name'].value;\n    }\n    \n    // Try attributes with lowercase\n    if (doc.containsKey('attributes.service.name') && doc['attributes.service.name'].size() > 0) {\n      return doc['attributes.service.name'].value;\n    }\n    \n    return \"unknown-service\";\n  ",
    /**
     * Extracts log level from log entries
     */
    LOG_LEVEL_NORMALIZER: "\n    String level = \"\";\n    \n    // Try to get level from SeverityText\n    if (doc.containsKey('SeverityText') && doc['SeverityText'].size() > 0) {\n      level = doc['SeverityText'].value.toLowerCase();\n    } \n    // Try lowercase version\n    else if (doc.containsKey('severityText') && doc['severityText'].size() > 0) {\n      level = doc['severityText'].value.toLowerCase();\n    }\n    // Check for level field\n    else if (doc.containsKey('level') && doc['level'].size() > 0) {\n      level = doc['level'].value.toLowerCase();\n    }\n    // Check for Level field\n    else if (doc.containsKey('Level') && doc['Level'].size() > 0) {\n      level = doc['Level'].value.toLowerCase();\n    }\n    \n    // Normalize common level variations\n    if (level.contains(\"error\") || level.contains(\"err\") || level.contains(\"fatal\") || level.equals(\"e\")) {\n      return \"error\";\n    } else if (level.contains(\"warn\") || level.equals(\"w\")) {\n      return \"warn\";\n    } else if (level.contains(\"info\") || level.equals(\"i\") || level.equals(\"information\")) {\n      return \"info\";\n    } else if (level.contains(\"debug\") || level.equals(\"d\")) {\n      return \"debug\";\n    } else if (level.contains(\"trace\") || level.equals(\"t\")) {\n      return \"trace\";\n    }\n    \n    // If we couldn't determine the level, check for error indicators\n    if (doc.containsKey('Body') && doc['Body'].size() > 0 && \n        (doc['Body'].value.toLowerCase().contains(\"error\") || \n         doc['Body'].value.toLowerCase().contains(\"exception\"))) {\n      return \"error\";\n    }\n    \n    return level.length() > 0 ? level : \"unknown\";\n  "
};
/**
 * Traces-related Painless scripts
 */
exports.TRACES_SCRIPTS = {
    /**
     * Extracts error messages from trace spans
     */
    SPAN_ERROR_MESSAGE_EXTRACTOR: "\n    // Check for exception events\n    if (doc.containsKey('Events') && doc['Events'].size() > 0) {\n      for (def event : doc['Events']) {\n        if (event.containsKey('Name') && event['Name'].value == 'exception') {\n          if (event.containsKey('Attributes.exception.message') && \n              event['Attributes.exception.message'].size() > 0) {\n            return event['Attributes.exception.message'].value;\n          } else if (event.containsKey('Attributes.exception.type') && \n                    event['Attributes.exception.type'].size() > 0) {\n            return event['Attributes.exception.type'].value;\n          }\n        }\n      }\n    }\n    \n    // Check for lowercase version of events\n    if (doc.containsKey('events') && doc['events'].size() > 0) {\n      for (def event : doc['events']) {\n        if (event.containsKey('name') && event['name'].value == 'exception') {\n          if (event.containsKey('attributes.exception.message') && \n              event['attributes.exception.message'].size() > 0) {\n            return event['attributes.exception.message'].value;\n          } else if (event.containsKey('attributes.exception.type') && \n                    event['attributes.exception.type'].size() > 0) {\n            return event['attributes.exception.type'].value;\n          }\n        }\n      }\n    }\n    \n    // Check for HTTP status code\n    if (doc.containsKey('Attributes.http.status_code') && \n        doc['Attributes.http.status_code'].size() > 0) {\n      int statusCode = doc['Attributes.http.status_code'].value;\n      if (statusCode >= 400) {\n        String spanName = \"\";\n        if (doc.containsKey('Name') && doc['Name'].size() > 0) {\n          spanName = doc['Name'].value;\n        }\n        return \"HTTP \" + statusCode + (spanName.length() > 0 ? \" in \" + spanName : \"\");\n      }\n    }\n    \n    // Check lowercase version\n    if (doc.containsKey('attributes.http.status_code') && \n        doc['attributes.http.status_code'].size() > 0) {\n      int statusCode = doc['attributes.http.status_code'].value;\n      if (statusCode >= 400) {\n        String spanName = \"\";\n        if (doc.containsKey('name') && doc['name'].size() > 0) {\n          spanName = doc['name'].value;\n        }\n        return \"HTTP \" + statusCode + (spanName.length() > 0 ? \" in \" + spanName : \"\");\n      }\n    }\n    \n    // Check for error status\n    if (doc.containsKey('Status.code') && doc['Status.code'].value == 2) {\n      String spanName = \"\";\n      if (doc.containsKey('Name') && doc['Name'].size() > 0) {\n        spanName = doc['Name'].value;\n      }\n      return \"Error in \" + (spanName.length() > 0 ? spanName : \"span\");\n    }\n    \n    // Check lowercase version\n    if (doc.containsKey('status.code') && doc['status.code'].value == 2) {\n      String spanName = \"\";\n      if (doc.containsKey('name') && doc['name'].size() > 0) {\n        spanName = doc['name'].value;\n      }\n      return \"Error in \" + (spanName.length() > 0 ? spanName : \"span\");\n    }\n    \n    return \"Unknown error\";\n  ",
    /**
     * Calculates service dependencies from trace spans
     */
    SERVICE_DEPENDENCY_CALCULATOR: "\n    String clientService = \"\";\n    String serverService = \"\";\n    \n    // Get client service\n    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {\n      clientService = doc['Resource.service.name'].value;\n    }\n    \n    // Get server service from peer.service attribute\n    if (doc.containsKey('Attributes.peer.service') && doc['Attributes.peer.service'].size() > 0) {\n      serverService = doc['Attributes.peer.service'].value;\n    } else if (doc.containsKey('attributes.peer.service') && doc['attributes.peer.service'].size() > 0) {\n      serverService = doc['attributes.peer.service'].value;\n    }\n    \n    // If we have both services and they're different, return them as a dependency\n    if (clientService.length() > 0 && serverService.length() > 0 && !clientService.equals(serverService)) {\n      return clientService + \" -> \" + serverService;\n    }\n    \n    return \"\";\n  "
};
/**
 * Metrics-related Painless scripts
 */
exports.METRICS_SCRIPTS = {
    /**
     * Extracts service name from metric data
     */
    METRIC_SERVICE_EXTRACTOR: "\n    // Try to get service name from Resource attributes\n    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {\n      return doc['Resource.service.name'].value;\n    }\n    \n    // Fallback to service.name\n    if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n      return doc['service.name'].value;\n    }\n    \n    // Try labels\n    if (doc.containsKey('labels.service.name') && doc['labels.service.name'].size() > 0) {\n      return doc['labels.service.name'].value;\n    }\n    \n    return \"unknown-service\";\n  ",
    /**
     * Calculates rate of change for counter metrics
     */
    RATE_CALCULATOR: "\n    if (!doc.containsKey('_value') || !doc.containsKey('_previous_value') || \n        !doc.containsKey('_timestamp') || !doc.containsKey('_previous_timestamp')) {\n      return 0.0;\n    }\n    \n    double currentValue = doc['_value'].value;\n    double previousValue = doc['_previous_value'].value;\n    long currentTimestamp = doc['_timestamp'].value;\n    long previousTimestamp = doc['_previous_timestamp'].value;\n    \n    // Calculate time difference in seconds\n    double timeDiffSeconds = (currentTimestamp - previousTimestamp) / 1000.0;\n    \n    // Handle counter resets\n    if (currentValue < previousValue) {\n      return currentValue / timeDiffSeconds;\n    }\n    \n    // Calculate rate\n    if (timeDiffSeconds > 0) {\n      return (currentValue - previousValue) / timeDiffSeconds;\n    }\n    \n    return 0.0;\n  "
};
// Initialize script registry
registerScripts();

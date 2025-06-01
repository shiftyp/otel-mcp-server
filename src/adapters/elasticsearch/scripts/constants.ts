/**
 * Constants for Elasticsearch Painless scripts
 * 
 * This module exports Painless scripts as TypeScript constants, which:
 * 1. Improves performance by avoiding runtime file I/O
 * 2. Enables better IDE support, type safety, and compile-time validation
 * 3. Simplifies bundling and deployment
 * 4. Organizes scripts by domain (traces, logs, metrics)
 */

import { getScriptRegistry, ScriptMetadata } from '../../../utils/scriptRegistry.js';

// Register all scripts with the script registry
function registerScripts(): void {
  // Register logs scripts
  for (const [key, script] of Object.entries(LOGS_SCRIPTS)) {
    const metadata: ScriptMetadata = {
      name: key,
      description: `Logs script: ${key}`,
      version: '1.0',
      domain: 'logs'
    };
    getScriptRegistry().registerScript(`logs.${key}`, script, metadata);
  }
  
  // Register traces scripts
  for (const [key, script] of Object.entries(TRACES_SCRIPTS)) {
    const metadata: ScriptMetadata = {
      name: key,
      description: `Traces script: ${key}`,
      version: '1.0',
      domain: 'traces'
    };
    getScriptRegistry().registerScript(`traces.${key}`, script, metadata);
  }
  
  // Register metrics scripts
  for (const [key, script] of Object.entries(METRICS_SCRIPTS)) {
    const metadata: ScriptMetadata = {
      name: key,
      description: `Metrics script: ${key}`,
      version: '1.0',
      domain: 'metrics'
    };
    getScriptRegistry().registerScript(`metrics.${key}`, script, metadata);
  }
}

/**
 * Logs-related Painless scripts
 */
export const LOGS_SCRIPTS = {
  /**
   * Extracts error messages from log entries
   */
  ERROR_MESSAGE_EXTRACTOR: `
    String message = "";
    
    // Try to extract from common error message fields
    if (doc.containsKey('Body') && doc['Body'].size() > 0) {
      message = doc['Body'].value;
    } else if (doc.containsKey('body') && doc['body'].size() > 0) {
      message = doc['body'].value;
    } else if (doc.containsKey('message') && doc['message'].size() > 0) {
      message = doc['message'].value;
    } else if (doc.containsKey('Message') && doc['Message'].size() > 0) {
      message = doc['Message'].value;
    }
    
    // Extract just the first line for conciseness
    if (message.length() > 0) {
      int newlineIndex = message.indexOf("\\n");
      if (newlineIndex > 0) {
        message = message.substring(0, newlineIndex);
      }
      
      // Truncate very long messages
      if (message.length() > 200) {
        message = message.substring(0, 197) + "...";
      }
      
      return message;
    }
    
    // If no message found, check for status code
    if (doc.containsKey('http.status_code') && doc['http.status_code'].size() > 0) {
      int statusCode = doc['http.status_code'].value;
      if (statusCode >= 400) {
        return "HTTP Error " + statusCode;
      }
    }
    
    return "Unknown error";
  `,
  
  /**
   * Extracts service name from log entries
   */
  SERVICE_NAME_EXTRACTOR: `
    // Try to get service name from Resource attributes
    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {
      return doc['Resource.service.name'].value;
    }
    
    // Fallback to service.name
    if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
      return doc['service.name'].value;
    }
    
    // Try nested attributes
    if (doc.containsKey('Attributes.service.name') && doc['Attributes.service.name'].size() > 0) {
      return doc['Attributes.service.name'].value;
    }
    
    // Try attributes with lowercase
    if (doc.containsKey('attributes.service.name') && doc['attributes.service.name'].size() > 0) {
      return doc['attributes.service.name'].value;
    }
    
    return "unknown-service";
  `,
  
  /**
   * Extracts log level from log entries
   */
  LOG_LEVEL_NORMALIZER: `
    String level = "";
    
    // Try to get level from SeverityText
    if (doc.containsKey('SeverityText') && doc['SeverityText'].size() > 0) {
      level = doc['SeverityText'].value.toLowerCase();
    } 
    // Try lowercase version
    else if (doc.containsKey('severityText') && doc['severityText'].size() > 0) {
      level = doc['severityText'].value.toLowerCase();
    }
    // Check for level field
    else if (doc.containsKey('level') && doc['level'].size() > 0) {
      level = doc['level'].value.toLowerCase();
    }
    // Check for Level field
    else if (doc.containsKey('Level') && doc['Level'].size() > 0) {
      level = doc['Level'].value.toLowerCase();
    }
    
    // Normalize common level variations
    if (level.contains("error") || level.contains("err") || level.contains("fatal") || level.equals("e")) {
      return "error";
    } else if (level.contains("warn") || level.equals("w")) {
      return "warn";
    } else if (level.contains("info") || level.equals("i") || level.equals("information")) {
      return "info";
    } else if (level.contains("debug") || level.equals("d")) {
      return "debug";
    } else if (level.contains("trace") || level.equals("t")) {
      return "trace";
    }
    
    // If we couldn't determine the level, check for error indicators
    if (doc.containsKey('Body') && doc['Body'].size() > 0 && 
        (doc['Body'].value.toLowerCase().contains("error") || 
         doc['Body'].value.toLowerCase().contains("exception"))) {
      return "error";
    }
    
    return level.length() > 0 ? level : "unknown";
  `
};

/**
 * Traces-related Painless scripts
 */
export const TRACES_SCRIPTS = {
  /**
   * Extracts error messages from trace spans
   */
  SPAN_ERROR_MESSAGE_EXTRACTOR: `
    // Check for exception events
    if (doc.containsKey('Events') && doc['Events'].size() > 0) {
      for (def event : doc['Events']) {
        if (event.containsKey('Name') && event['Name'].value == 'exception') {
          if (event.containsKey('Attributes.exception.message') && 
              event['Attributes.exception.message'].size() > 0) {
            return event['Attributes.exception.message'].value;
          } else if (event.containsKey('Attributes.exception.type') && 
                    event['Attributes.exception.type'].size() > 0) {
            return event['Attributes.exception.type'].value;
          }
        }
      }
    }
    
    // Check for lowercase version of events
    if (doc.containsKey('events') && doc['events'].size() > 0) {
      for (def event : doc['events']) {
        if (event.containsKey('name') && event['name'].value == 'exception') {
          if (event.containsKey('attributes.exception.message') && 
              event['attributes.exception.message'].size() > 0) {
            return event['attributes.exception.message'].value;
          } else if (event.containsKey('attributes.exception.type') && 
                    event['attributes.exception.type'].size() > 0) {
            return event['attributes.exception.type'].value;
          }
        }
      }
    }
    
    // Check for HTTP status code
    if (doc.containsKey('Attributes.http.status_code') && 
        doc['Attributes.http.status_code'].size() > 0) {
      int statusCode = doc['Attributes.http.status_code'].value;
      if (statusCode >= 400) {
        String spanName = "";
        if (doc.containsKey('Name') && doc['Name'].size() > 0) {
          spanName = doc['Name'].value;
        }
        return "HTTP " + statusCode + (spanName.length() > 0 ? " in " + spanName : "");
      }
    }
    
    // Check lowercase version
    if (doc.containsKey('attributes.http.status_code') && 
        doc['attributes.http.status_code'].size() > 0) {
      int statusCode = doc['attributes.http.status_code'].value;
      if (statusCode >= 400) {
        String spanName = "";
        if (doc.containsKey('name') && doc['name'].size() > 0) {
          spanName = doc['name'].value;
        }
        return "HTTP " + statusCode + (spanName.length() > 0 ? " in " + spanName : "");
      }
    }
    
    // Check for error status
    if (doc.containsKey('Status.code') && doc['Status.code'].value == 2) {
      String spanName = "";
      if (doc.containsKey('Name') && doc['Name'].size() > 0) {
        spanName = doc['Name'].value;
      }
      return "Error in " + (spanName.length() > 0 ? spanName : "span");
    }
    
    // Check lowercase version
    if (doc.containsKey('status.code') && doc['status.code'].value == 2) {
      String spanName = "";
      if (doc.containsKey('name') && doc['name'].size() > 0) {
        spanName = doc['name'].value;
      }
      return "Error in " + (spanName.length() > 0 ? spanName : "span");
    }
    
    return "Unknown error";
  `,
  
  /**
   * Calculates service dependencies from trace spans
   */
  SERVICE_DEPENDENCY_CALCULATOR: `
    String clientService = "";
    String serverService = "";
    
    // Get client service
    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {
      clientService = doc['Resource.service.name'].value;
    }
    
    // Get server service from peer.service attribute
    if (doc.containsKey('Attributes.peer.service') && doc['Attributes.peer.service'].size() > 0) {
      serverService = doc['Attributes.peer.service'].value;
    } else if (doc.containsKey('attributes.peer.service') && doc['attributes.peer.service'].size() > 0) {
      serverService = doc['attributes.peer.service'].value;
    }
    
    // If we have both services and they're different, return them as a dependency
    if (clientService.length() > 0 && serverService.length() > 0 && !clientService.equals(serverService)) {
      return clientService + " -> " + serverService;
    }
    
    return "";
  `
};

/**
 * Metrics-related Painless scripts
 */
export const METRICS_SCRIPTS = {
  /**
   * Extracts service name from metric data
   */
  METRIC_SERVICE_EXTRACTOR: `
    // Try to get service name from Resource attributes
    if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {
      return doc['Resource.service.name'].value;
    }
    
    // Fallback to service.name
    if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
      return doc['service.name'].value;
    }
    
    // Try labels
    if (doc.containsKey('labels.service.name') && doc['labels.service.name'].size() > 0) {
      return doc['labels.service.name'].value;
    }
    
    return "unknown-service";
  `,
  
  /**
   * Calculates rate of change for counter metrics
   */
  RATE_CALCULATOR: `
    if (!doc.containsKey('_value') || !doc.containsKey('_previous_value') || 
        !doc.containsKey('_timestamp') || !doc.containsKey('_previous_timestamp')) {
      return 0.0;
    }
    
    double currentValue = doc['_value'].value;
    double previousValue = doc['_previous_value'].value;
    long currentTimestamp = doc['_timestamp'].value;
    long previousTimestamp = doc['_previous_timestamp'].value;
    
    // Calculate time difference in seconds
    double timeDiffSeconds = (currentTimestamp - previousTimestamp) / 1000.0;
    
    // Handle counter resets
    if (currentValue < previousValue) {
      return currentValue / timeDiffSeconds;
    }
    
    // Calculate rate
    if (timeDiffSeconds > 0) {
      return (currentValue - previousValue) / timeDiffSeconds;
    }
    
    return 0.0;
  `
};

// Initialize script registry
registerScripts();

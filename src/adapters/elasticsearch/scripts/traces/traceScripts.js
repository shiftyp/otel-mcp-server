"use strict";
/**
 * Painless scripts for trace-related Elasticsearch queries
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceVersion = exports.getServiceName = exports.getChildServiceName = exports.getParentServiceName = void 0;
/**
 * Script to extract parent service name from trace data
 */
exports.getParentServiceName = "\n// Try to get parent service name by looking up parent span\ndef parentSpanId = doc['parent_span_id'].value;\nif (parentSpanId == null) return 'unknown';\n\n// First try resource.attributes.service.name\nif (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {\n  return doc['resource.attributes.service.name'].value;\n}\n\n// Then try Resource.service.name\nif (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {\n  return doc['Resource.service.name'].value;\n}\n\n// Finally try service.name\nif (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n  return doc['service.name'].value;\n}\n\nreturn 'unknown';\n";
/**
 * Script to extract child service name from trace data
 */
exports.getChildServiceName = "\ndef parentSpanId = doc['parent_span_id'].value;\ndef childService = doc['resource.attributes.service.name'].size() > 0 \n  ? doc['resource.attributes.service.name'].value \n  : (doc['Resource.service.name'].size() > 0 \n    ? doc['Resource.service.name'].value \n    : (doc['service.name'].size() > 0 \n      ? doc['service.name'].value \n      : 'unknown'));\nreturn childService;\n";
/**
 * Script to extract service name from trace data
 */
exports.getServiceName = "\n// Try different fields for service name\nif (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {\n  return doc['resource.attributes.service.name'].value;\n} else if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {\n  return doc['Resource.service.name'].value;\n} else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {\n  return doc['service.name'].value;\n} else {\n  return 'unknown';\n}\n";
/**
 * Script to extract service version from trace data
 */
exports.getServiceVersion = "\n// Try different fields for service version\nif (doc.containsKey('resource.attributes.service.version') && doc['resource.attributes.service.version'].size() > 0) {\n  return doc['resource.attributes.service.version'].value;\n} else if (doc.containsKey('Resource.service.version') && doc['Resource.service.version'].size() > 0) {\n  return doc['Resource.service.version'].value;\n} else if (doc.containsKey('service.version') && doc['service.version'].size() > 0) {\n  return doc['service.version'].value;\n} else {\n  return 'unknown';\n}\n";

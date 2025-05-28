/**
 * Painless scripts for trace-related Elasticsearch queries
 */

/**
 * Script to extract parent service name from trace data
 */
export const getParentServiceName = `
// Try to get parent service name by looking up parent span
def parentSpanId = doc['parent_span_id'].value;
if (parentSpanId == null) return 'unknown';

// First try resource.attributes.service.name
if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {
  return doc['resource.attributes.service.name'].value;
}

// Then try Resource.service.name
if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {
  return doc['Resource.service.name'].value;
}

// Finally try service.name
if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
  return doc['service.name'].value;
}

return 'unknown';
`;

/**
 * Script to extract child service name from trace data
 */
export const getChildServiceName = `
def parentSpanId = doc['parent_span_id'].value;
def childService = doc['resource.attributes.service.name'].size() > 0 
  ? doc['resource.attributes.service.name'].value 
  : (doc['Resource.service.name'].size() > 0 
    ? doc['Resource.service.name'].value 
    : (doc['service.name'].size() > 0 
      ? doc['service.name'].value 
      : 'unknown'));
return childService;
`;

/**
 * Script to extract service name from trace data
 */
export const getServiceName = `
// Try different fields for service name
if (doc.containsKey('resource.attributes.service.name') && doc['resource.attributes.service.name'].size() > 0) {
  return doc['resource.attributes.service.name'].value;
} else if (doc.containsKey('Resource.service.name') && doc['Resource.service.name'].size() > 0) {
  return doc['Resource.service.name'].value;
} else if (doc.containsKey('service.name') && doc['service.name'].size() > 0) {
  return doc['service.name'].value;
} else {
  return 'unknown';
}
`;

/**
 * Script to extract service version from trace data
 */
export const getServiceVersion = `
// Try different fields for service version
if (doc.containsKey('resource.attributes.service.version') && doc['resource.attributes.service.version'].size() > 0) {
  return doc['resource.attributes.service.version'].value;
} else if (doc.containsKey('Resource.service.version') && doc['Resource.service.version'].size() > 0) {
  return doc['Resource.service.version'].value;
} else if (doc.containsKey('service.version') && doc['service.version'].size() > 0) {
  return doc['service.version'].value;
} else {
  return 'unknown';
}
`;

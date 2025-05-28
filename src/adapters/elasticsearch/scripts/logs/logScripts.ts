/**
 * Painless scripts for log-related Elasticsearch queries
 */

/**
 * Script to extract error message from log data
 * Handles multiple field formats and extracts the most relevant error message
 */
export const extractErrorMessage = `
// Access the full source document
def source = doc['_source'];

// Try to extract error message from various fields in priority order

// OTEL mapping mode fields
// 1. Check attributes.exception fields
if (source.containsKey('attributes') && source.attributes instanceof Map) {
  def attrs = source.attributes;
  
  // Check for exception in attributes
  if (attrs.containsKey('exception') && attrs.exception instanceof Map && attrs.exception.containsKey('message')) {
    emit(attrs.exception.message.toString());
    return;
  }
  
  // Check for error in attributes
  if (attrs.containsKey('error') && attrs.error instanceof Map && attrs.error.containsKey('message')) {
    emit(attrs.error.message.toString());
    return;
  }
  
  // Check for message in attributes
  if (attrs.containsKey('message')) {
    emit(attrs.message.toString());
    return;
  }
}

// 2. Check body field (OTEL format)
if (source.containsKey('body')) {
  def body = source.body;
  if (body instanceof String || body instanceof GString) {
    // Extract first line or up to 100 chars
    def bodyStr = body.toString();
    def firstLine = bodyStr.indexOf('\\n') > 0 ? 
      bodyStr.substring(0, bodyStr.indexOf('\\n')) : 
      (bodyStr.length() > 100 ? bodyStr.substring(0, 100) + '...' : bodyStr);
    emit(firstLine);
    return;
  }
}

// ECS mapping mode fields
// 3. Exception fields
if (source.containsKey('exception')) {
  def exception = source.exception;
  if (exception instanceof Map && exception.containsKey('message')) {
    emit(exception.message.toString());
    return;
  }
}

// 4. Error fields
if (source.containsKey('error')) {
  def error = source.error;
  if (error instanceof Map && error.containsKey('message')) {
    emit(error.message.toString());
    return;
  } else if (error instanceof String || error instanceof GString) {
    emit(error.toString());
    return;
  }
}

// 5. Message fields
if (source.containsKey('message')) {
  emit(source.message.toString());
  return;
}

// 6. Body fields (often used in k8s events)
if (source.containsKey('Body')) {
  def body = source.Body;
  if (body instanceof String || body instanceof GString) {
    // Extract first line or up to 100 chars
    def bodyStr = body.toString();
    def firstLine = bodyStr.indexOf('\\n') > 0 ? 
      bodyStr.substring(0, bodyStr.indexOf('\\n')) : 
      (bodyStr.length() > 100 ? bodyStr.substring(0, 100) + '...' : bodyStr);
    emit(firstLine);
    return;
  } else if (body instanceof Map) {
    // Try to extract message from k8s event
    if (body.containsKey('message')) {
      emit(body.message.toString());
      return;
    }
  }
}

// If we get here, we couldn't find a suitable error message
emit("Unknown error");
`;

/**
 * Script to extract service name from log data
 */
export const extractServiceName = `
def source = doc['_source'];

// Try to extract service name from various fields
if (source.containsKey('Resource') && source.Resource instanceof Map && 
    source.Resource.containsKey('service') && source.Resource.service instanceof Map && 
    source.Resource.service.containsKey('name')) {
  emit(source.Resource.service.name.toString());
  return;
}

if (source.containsKey('resource') && source.resource instanceof Map && 
    source.resource.containsKey('service') && source.resource.service instanceof Map && 
    source.resource.service.containsKey('name')) {
  emit(source.resource.service.name.toString());
  return;
}

if (source.containsKey('service') && source.service instanceof Map && 
    source.service.containsKey('name')) {
  emit(source.service.name.toString());
  return;
}

emit("unknown");
`;

/**
 * Script to extract the first line of an error message from log data
 */
export const extractFirstLineErrorMessage = `
// Try to extract the first line of any error message from various fields
String errorMsg = "";

// Check body.text (OTEL format)
if (doc.containsKey("body.text") && doc["body.text"].size() > 0) {
  errorMsg = doc["body.text"].value;
}
// Check Body.text (ECS format)
else if (doc.containsKey("Body.text") && doc["Body.text"].size() > 0) {
  errorMsg = doc["Body.text"].value;
}
// Check message field
else if (doc.containsKey("message") && doc["message"].size() > 0) {
  errorMsg = doc["message"].value;
}
// Check attributes.message field
else if (doc.containsKey("attributes.message") && doc["attributes.message"].size() > 0) {
  errorMsg = doc["attributes.message"].value;
}
// Check exception message
else if (doc.containsKey("attributes.exception.message") && doc["attributes.exception.message"].size() > 0) {
  errorMsg = doc["attributes.exception.message"].value;
}

// Extract first line or truncate if too long
if (errorMsg.length() > 0) {
  int newlineIndex = errorMsg.indexOf("\\n");
  if (newlineIndex > 0) {
    errorMsg = errorMsg.substring(0, newlineIndex);
  }
  
  // Truncate if too long
  if (errorMsg.length() > 200) {
    errorMsg = errorMsg.substring(0, 200) + "...";
  }
  
  emit(errorMsg);
} else {
  emit("Unknown error");
}
`;

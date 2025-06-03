// Utility types for metric schemas
export type MetricFieldSchema = Record<string, string>;

export type GroupedMetricSchemas = Record<string, MetricFieldSchema>; // { [metricName]: { field: type } }

// List of fields to ignore in metric schemas (deduplicated, concise)
export const ignoreFields = new Set([
  '@timestamp', 'service', 'host', 'k8s', 'receiver', 'scraper', 'server', 'url', 'net', '_id', '_index',
  'event', 'agent', 'ecs', 'cloud', 'container', 'orchestrator', 'labels', 'tags', 'log', 'trace', 'span',
  'transaction', 'parent', 'destination', 'source', 'client', 'process', 'observer', 'metricset', 'input',
  'fields', 'beat', 'message', 'type', 'name', 'namespace', 'version', 'runtime', 'node', 'instance',
  'deployment', 'pod', 'os', 'platform', 'ip', 'start_time', 'uid', 'address', 'port', 'scheme', 'reason',
  'key', 'provider_name', 'evaluation', 'flagd', 'feature_flag', 'scraped_metric_points', 'errored_metric_points'
]);

/**
 * Extracts metric field paths from Elasticsearch index mappings.
 * @param props - Elasticsearch index mappings properties
 * @param prefix - Prefix for field paths
 * @returns Array of metric field paths
 */
export function extractMetricFieldPaths(props: Record<string, any>, prefix: string = ''): string[] {
  const fieldPaths: string[] = [];

  for (const field in props) {
    if (ignoreFields.has(field)) continue;
    const fieldType = props[field]?.type || (props[field]?.properties ? 'object' : 'unknown');
    
    // Always include the full path for this field
    const fullPath = `${prefix}${field}`;
    
    // For non-object fields, add the field path
    if (fieldType !== 'object') {
      fieldPaths.push(fullPath);
    }
    
    // For object fields, recursively process nested fields
    if (fieldType === 'object' && props[field].properties) {
      // Add the parent object path as well
      fieldPaths.push(fullPath);
      // Add all nested fields
      fieldPaths.push(...extractMetricFieldPaths(props[field].properties, `${fullPath}.`));
    }
  }

  return fieldPaths;
}
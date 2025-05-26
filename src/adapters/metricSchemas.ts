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
    if (fieldType === 'object') {
      fieldPaths.push(...extractMetricFieldPaths(props[field].properties, `${prefix}${field}.`));
    } else {
      fieldPaths.push(`${prefix}${field}`);
    }
  }

  return fieldPaths;
}

/**
 * Extracts all metric field paths from Elasticsearch index mappings.
 * @param esRequest - A function to make Elasticsearch requests (method, url)
 * @returns Array of metric field paths
 */
export async function getAllMetricFieldPaths(esRequest: (method: string, url: string) => Promise<any>): Promise<string[]> {
  const resp = await esRequest('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping');
  const fieldPaths: string[] = [];

  for (const index of Object.values(resp)) {
    const mappings = (index as any).mappings?.properties || {};
    fieldPaths.push(...extractMetricFieldPaths(mappings));
  }

  return fieldPaths;
}

/**
 * Extracts metric schemas from Elasticsearch index mappings.
 * @param esRequest - A function to make Elasticsearch requests (method, url)
 * @returns Map of metric names to their field schemas
 */
export async function getMetricSchemasWithFields(esRequest: (method: string, url: string) => Promise<any>): Promise<Array<{ metric: string, fields: string[] }>> {
  const resp = await esRequest('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping');
  const results: Array<{ metric: string, fields: string[] }> = [];

  function getParentAndField(props: Record<string, any>, prefix = ''): Array<{ metric: string, siblings: string[] }> {
    let output: Array<{ metric: string, siblings: string[] }> = [];
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === 'object' && v.properties) {
        const children = getParentAndField(v.properties, prefix ? `${prefix}.${k}` : k);
        output = output.concat(children);
      } else if (!ignoreFields.has(k)) {
        // At this level, collect all sibling fields except the current one
        const siblings: string[] = Object.keys(props).filter((f: string) => f !== k && !ignoreFields.has(f));
        output.push({ metric: prefix ? `${prefix}.${k}` : k, siblings });
      }
    }
    return output;
  }

  for (const index of Object.values(resp)) {
    const mappings = (index as any).mappings?.properties || {};
    for (const { metric, siblings } of getParentAndField(mappings)) {
      results.push({ metric, fields: siblings });
    }
  }
  return results;
}




/**
 * Groups schemas by overall metric name: { [metricName]: { field: type, ... } }
 * @param esRequest - A function to make Elasticsearch requests (method, url)
 * @returns Map of metric names to their field schemas
 */
export async function groupMetricSchemasByMetricName(esRequest: (method: string, url: string) => Promise<any>): Promise<GroupedMetricSchemas> {
  const resp = await esRequest('GET', '/.ds-metrics-*,metrics*,*metrics*,*metric*,otel-metric*,prometheus*,system*,metricbeat*/_mapping');
  const grouped: GroupedMetricSchemas = {};

  for (const index of Object.values(resp)) {
    const mappings = (index as any).mappings?.properties || {};
    if (!mappings['metric']) continue;
    const metricProps = mappings['metric'].properties || {};
    const metricNameField = metricProps['name'];
    if (!metricNameField) continue;

    // Try to get all possible metric names from 'fields' or 'fields.mapping', but fallback to just 'metric.name'
    // In practice, we can't get all values from mapping, so we just use the field name
    // This will group all fields under the generic metric name (for more granularity, would need to scan docs)
    const metricName = 'metric.name';
    if (!grouped[metricName]) grouped[metricName] = {};

    // Add all non-ignored fields to this metric's schema
    for (const field in mappings) {
      if (ignoreFields.has(field)) continue;
      const fieldType = mappings[field]?.type || (mappings[field]?.properties ? 'object' : 'unknown');
      grouped[metricName][field] = fieldType;
    }
    // Add metric.name itself
    grouped[metricName]['name'] = metricNameField.type || 'keyword';
    if (metricProps['value']) {
      grouped[metricName]['value'] = metricProps['value'].type || 'float';
    }
  }
  return grouped;
}

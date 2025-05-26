import { ElasticsearchCore, ElasticsearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/traces.js';
import { MetricsAdapter } from './metrics/metrics.js';
import { LogsAdapter } from './logs/logs.js';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

/**
 * Main ElasticsearchAdapter that combines functionality from specialized adapters
 */
export class ElasticsearchAdapter extends EventEmitter {
  private tracesAdapter: TracesAdapter;
  private metricsAdapter: MetricsAdapter;
  private logsAdapter: LogsAdapter;
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    super();
    this.tracesAdapter = new TracesAdapter(options);
    this.metricsAdapter = new MetricsAdapter(options);
    this.logsAdapter = new LogsAdapter(options);
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  // Core methods
  public callEsRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.coreAdapter.callEsRequest(method, url, data, config);
  }
  
  public async getIndices(): Promise<string[]> {
    return this.coreAdapter.getIndices();
  }
  
  // Traces methods
  public async analyzeTrace(traceId: string): Promise<any> {
    return this.tracesAdapter.analyzeTrace(traceId);
  }
  
  public async spanLookup(spanId: string): Promise<any | null> {
    return this.tracesAdapter.spanLookup(spanId);
  }
  
  public async serviceDependencyGraph(startTime: string, endTime: string): Promise<{ parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]> {
    return this.tracesAdapter.serviceDependencyGraph(startTime, endTime);
  }
  
  public async queryTraces(query: any): Promise<any> {
    return this.tracesAdapter.queryTraces(query);
  }
  
  /**
   * Get a list of all services across all telemetry types (traces, metrics, and logs)
   * @param search Optional search term to filter services by name
   * @returns Array of service names and their versions
   */
  public async getServices(search?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Get services from traces
      const traceServices = await this.tracesAdapter.getServices(search);
      
      // Get services from metrics
      const metricServices = await this.getServicesFromMetrics(search);
      
      // Get services from logs
      const logServices = await this.getServicesFromLogs(search);
      
      // Combine all services into a single map to deduplicate
      const servicesMap = new Map<string, Set<string>>();
      
      // Add trace services
      traceServices.forEach((service: {name: string, versions: string[]}) => {
        if (!servicesMap.has(service.name)) {
          servicesMap.set(service.name, new Set<string>());
        }
        const versionSet = servicesMap.get(service.name)!;
        service.versions.forEach((version: string) => versionSet.add(version));
      });
      
      // Add metric services
      metricServices.forEach((service: {name: string, versions: string[]}) => {
        if (!servicesMap.has(service.name)) {
          servicesMap.set(service.name, new Set<string>());
        }
        const versionSet = servicesMap.get(service.name)!;
        service.versions.forEach((version: string) => versionSet.add(version));
      });
      
      // Add log services
      logServices.forEach((service: {name: string, versions: string[]}) => {
        if (!servicesMap.has(service.name)) {
          servicesMap.set(service.name, new Set<string>());
        }
        const versionSet = servicesMap.get(service.name)!;
        service.versions.forEach((version: string) => versionSet.add(version));
      });
      
      // Convert map back to array format
      const combinedServices = Array.from(servicesMap.entries()).map(([name, versions]) => ({
        name,
        versions: Array.from(versions)
      }));
      
      // Sort services by name
      return combinedServices.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      logger.error('[ES Adapter] Error getting services across telemetry types', { error });
      return [];
    }
  }
  
  public async getOperations(service: string): Promise<string[]> {
    return this.tracesAdapter.getOperations(service);
  }
  
  /**
   * Get services from metrics data
   * @param search Optional search term to filter services by name
   * @returns Array of service names and their versions
   */
  private async getServicesFromMetrics(search?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Create a query to find all unique service names in metrics
      const query = {
        size: 0,
        query: {
          bool: {
            must: [
              { exists: { field: 'service.name' } }
            ]
          }
        },
        aggs: {
          services: {
            terms: {
              field: 'service.name',
              size: 1000
            },
            aggs: {
              versions: {
                terms: {
                  field: 'service.version',
                  size: 100,
                  missing: 'unknown'
                }
              }
            }
          }
        }
      };
      
      // Add search filter if provided
      if (search) {
        query.query.bool.must.push({
          bool: {
            should: [
              { term: { 'service.name': search } },
              { term: { 'kubernetes.deployment.name': search } }
            ],
            minimum_should_match: 1
          }
        } as any);
      }
      
      // Execute the query against metrics indices
      const response = await this.callEsRequest('POST', '/metrics*/_search', query);
      
      // Process the results
      const services: Array<{name: string, versions: string[]}> = [];
      
      if (response.aggregations?.services?.buckets) {
        for (const bucket of response.aggregations.services.buckets) {
          const serviceName = bucket.key;
          const versions: string[] = [];
          
          // Extract versions if available
          if (bucket.versions?.buckets?.length > 0) {
            for (const versionBucket of bucket.versions.buckets) {
              versions.push(versionBucket.key);
            }
          } else {
            versions.push('unknown');
          }
          
          services.push({
            name: serviceName,
            versions
          });
        }
      }
      
      logger.info('[ES Adapter] Found services in metrics', { count: services.length });
      return services;
    } catch (error) {
      logger.error('[ES Adapter] Error getting services from metrics', { error });
      return [];
    }
  }
  
  /**
   * Get services from logs data
   * @param search Optional search term to filter services by name
   * @returns Array of service names and their versions
   */
  private async getServicesFromLogs(search?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Create a query to find all unique service names in logs
      // OTEL logs can have service name in different fields
      const query = {
        size: 0,
        query: {
          bool: {
            should: [
              { exists: { field: 'service.name' } },
              { exists: { field: 'resource.service.name' } },
              { exists: { field: 'Resource.service.name' } }
            ],
            minimum_should_match: 1
          }
        },
        aggs: {
          service_names: {
            terms: {
              field: 'service.name',
              size: 1000,
              missing: '_missing_'
            },
            aggs: {
              versions: {
                terms: {
                  field: 'service.version',
                  size: 100,
                  missing: 'unknown'
                }
              }
            }
          },
          resource_service_names: {
            terms: {
              field: 'resource.service.name',
              size: 1000,
              missing: '_missing_'
            },
            aggs: {
              versions: {
                terms: {
                  field: 'resource.service.version',
                  size: 100,
                  missing: 'unknown'
                }
              }
            }
          },
          resource_upper_service_names: {
            terms: {
              field: 'Resource.service.name',
              size: 1000,
              missing: '_missing_'
            },
            aggs: {
              versions: {
                terms: {
                  field: 'Resource.service.version',
                  size: 100,
                  missing: 'unknown'
                }
              }
            }
          }
        }
      };
      
      // Add search filter if provided
      if (search) {
        (query.query.bool as any).must = [{
          bool: {
            should: [
              { term: { 'service.name': search } } as any,
              { term: { 'resource.service.name': search } } as any,
              { term: { 'Resource.service.name': search } } as any,
              { term: { 'kubernetes.deployment.name': search } } as any,
              { term: { 'k8s.deployment.name': search } } as any
            ],
            minimum_should_match: 1
          }
        }];
      }
      
      // Execute the query against logs indices
      const response = await this.callEsRequest('POST', '/logs*/_search', query);
      
      // Process the results
      const servicesMap = new Map<string, Set<string>>();
      
      // Process service.name aggregation
      if (response.aggregations?.service_names?.buckets) {
        for (const bucket of response.aggregations.service_names.buckets) {
          if (bucket.key === '_missing_') continue;
          
          const serviceName = bucket.key;
          if (!servicesMap.has(serviceName)) {
            servicesMap.set(serviceName, new Set<string>());
          }
          
          // Extract versions if available
          if (bucket.versions?.buckets?.length > 0) {
            for (const versionBucket of bucket.versions.buckets) {
              if (versionBucket.key !== '_missing_') {
                servicesMap.get(serviceName)!.add(versionBucket.key);
              }
            }
          } else {
            servicesMap.get(serviceName)!.add('unknown');
          }
        }
      }
      
      // Process resource.service.name aggregation
      if (response.aggregations?.resource_service_names?.buckets) {
        for (const bucket of response.aggregations.resource_service_names.buckets) {
          if (bucket.key === '_missing_') continue;
          
          const serviceName = bucket.key;
          if (!servicesMap.has(serviceName)) {
            servicesMap.set(serviceName, new Set<string>());
          }
          
          // Extract versions if available
          if (bucket.versions?.buckets?.length > 0) {
            for (const versionBucket of bucket.versions.buckets) {
              if (versionBucket.key !== '_missing_') {
                servicesMap.get(serviceName)!.add(versionBucket.key);
              }
            }
          } else {
            servicesMap.get(serviceName)!.add('unknown');
          }
        }
      }
      
      // Process Resource.service.name aggregation
      if (response.aggregations?.resource_upper_service_names?.buckets) {
        for (const bucket of response.aggregations.resource_upper_service_names.buckets) {
          if (bucket.key === '_missing_') continue;
          
          const serviceName = bucket.key;
          if (!servicesMap.has(serviceName)) {
            servicesMap.set(serviceName, new Set<string>());
          }
          
          // Extract versions if available
          if (bucket.versions?.buckets?.length > 0) {
            for (const versionBucket of bucket.versions.buckets) {
              if (versionBucket.key !== '_missing_') {
                servicesMap.get(serviceName)!.add(versionBucket.key);
              }
            }
          } else {
            servicesMap.get(serviceName)!.add('unknown');
          }
        }
      }
      
      // Convert map to array format
      const services = Array.from(servicesMap.entries()).map(([name, versions]) => ({
        name,
        versions: Array.from(versions)
      }));
      
      logger.info('[ES Adapter] Found services in logs', { count: services.length });
      return services;
    } catch (error) {
      logger.error('[ES Adapter] Error getting services from logs', { error });
      return [];
    }
  }
  
  // Metrics methods
  public async listMetricFields(): Promise<Array<{ name: string, type: string }>> {
    return this.metricsAdapter.listMetricFields();
  }
  
  public async aggregateOtelMetricsRange(startTime: string, endTime: string, metricName?: string, service?: string): Promise<string[]> {
    return this.metricsAdapter.aggregateOtelMetricsRange(startTime, endTime, metricName, service);
  }
  
  public async queryMetrics(query: any): Promise<any> {
    return this.metricsAdapter.queryMetrics(query);
  }
  
  // Logs methods
  public async listLogFields(includeSourceDocument: boolean = true): Promise<Array<{ name: string, type: string, count: number, schema: any }>> {
    return this.logsAdapter.listLogFields(includeSourceDocument);
  }

  public async searchOtelLogs(pattern: string, serviceOrServices?: string | string[], logLevel?: string, startTime?: string, endTime?: string): Promise<{
    timestamp: string;
    service: string;
    level: string;
    message: string;
    trace_id?: string;
    span_id?: string;
    attributes?: Record<string, any>;
  }[]> {
    return this.logsAdapter.searchOtelLogs(pattern, serviceOrServices, logLevel, startTime, endTime);
  }
  
  public async topErrors(startTime: string, endTime: string, N?: number, serviceOrServices?: string | string[], searchPattern?: string, query?: string): Promise<{ error: string, count: number, level?: string, service?: string, timestamp?: string, trace_id?: string, span_id?: string }[]> {
    return this.logsAdapter.topErrors(startTime, endTime, N, serviceOrServices, searchPattern, query);
  }
  
  public async queryLogs(query: any): Promise<any> {
    return this.logsAdapter.queryLogs(query);
  }
  
  /**
   * Helper to discover resources (stubbed for now, since MCP types are removed)
   */
  public async discoverResources(): Promise<any[]> {
    const resources: any[] = [];
    const now = new Date().toISOString();
    
    try {
      // Get list of services with versions
      const services = await this.getServices();
      
      // For each service, create a resource
      for (const service of services) {
        resources.push({
          uri: `service:${service.name}`,
          name: service.name,
          description: `Service: ${service.name} (Versions: ${service.versions.join(', ') || 'unknown'})`,
          type: 'service',
          created: now,
          updated: now,
          metadata: {
            versions: service.versions
          }
        });
        
        // Get operations for this service
        try {
          const operations = await this.getOperations(service.name);
          
          // For each operation, create a resource
          for (const operation of operations) {
            resources.push({
              uri: `operation:${service.name}:${operation}`,
              name: operation,
              description: `Operation: ${operation} (Service: ${service.name})`,
              type: 'operation',
              created: now,
              updated: now,
              parentUri: `service:${service.name}`,
            });
          }
        } catch (error) {
          logger.error(`Failed to get operations for service ${service}`, { error });
        }
      }
    } catch (error) {
      logger.error('Failed to discover resources', { error });
    }
    
    return resources;
  }
}

// Re-export types and classes
export { ElasticsearchAdapterOptions } from './core/core.js';
export { ElasticsearchCore } from './core/core.js';
export { TracesAdapter } from './traces/traces.js';
export { MetricsAdapter } from './metrics/metrics.js';
export { LogsAdapter } from './logs/logs.js';

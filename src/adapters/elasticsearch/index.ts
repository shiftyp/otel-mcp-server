import { ElasticsearchCore, ElasticsearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/index.js';
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
  
  public async serviceDependencyGraph(startTime: string, endTime: string, sampleRate: number = 1.0): Promise<{ 
    relationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[],
    spanCounts: { processed: number, total: number, percentage: string }
  }> {
    return this.tracesAdapter.serviceDependencyGraph(startTime, endTime, sampleRate);
  }
  
  /**
   * Build a service dependency tree structure with relationship-specific metrics and nested paths
   * @param directRelationships The direct relationships between services
   * @returns A hierarchical tree structure representing service dependencies with detailed metrics
   */
  public async buildServiceDependencyTree(
    directRelationships: { parent: string, child: string, count: number, errorCount?: number, errorRate?: number }[]
  ): Promise<{ 
    rootServices: string[];
    serviceTree: Map<string, {
      children: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
        path: {
          minLatency?: number;
          maxLatency?: number;
          avgLatency?: number;
          p95Latency?: number;
          p99Latency?: number;
        };
      }[];
      parents: {
        serviceName: string;
        metrics: {
          calls: number;
          errors: number;
          errorRate: number;
          errorRatePercentage: number;
        };
      }[];
      metrics: {
        incomingCalls: number;
        outgoingCalls: number;
        errors: number;
        errorRate: number;
        errorRatePercentage: number;
      };
    }>;
  }> {
    return this.tracesAdapter.buildServiceDependencyTree(directRelationships);
  }
  
  public async getServicePathsWithErrorRates(
    startTime: string, 
    endTime: string, 
    options: {
      service?: string,
      minCallCount?: number,
      maxPaths?: number,
      sortBy?: 'calls' | 'errors' | 'errorRate',
      maxDepth?: number
    } = {}
  ): Promise<{
    // Service architecture map for LLM understanding
    serviceMap: Array<{
      service: string,
      outboundCalls: Array<{
        target: string,
        calls: number,
        errors: number,
        errorRate: number,
        errorRatePercentage: number
      }>
    }>,
    // Detailed paths through the system
    paths: Array<{
      path: string,
      services: string[],
      length: number,
      metrics: {
        calls: number,
        errors: number,
        errorRate: number,
        errorRatePercentage: number,
        callsPerMinute: number,
        stages: Array<{
          source: string,
          target: string,
          calls: number,
          errors: number,
          errorRate: number,
          errorRatePercentage: number
        }>
      }
    }>,
    summary: {
      totalPaths: number,
      displayedPaths: number,
      timePeriod: {
        start: string,
        end: string,
        durationMinutes: number
      }
    },
    metadata: {
      message: string,
      filteredBy: string,
      sortedBy: string
    }
  }> {
    logger.info('[ES Adapter] Getting service paths with error rates', { startTime, endTime, options });
    
    // Get the direct relationships between services
    const dependencyData = await this.tracesAdapter.serviceDependencyGraph(startTime, endTime);
    const { relationships: edges, spanCounts } = dependencyData;
    
    // Calculate time range in milliseconds for rate calculations
    const timeRangeMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    const minutesInRange = timeRangeMs / (1000 * 60);
    
    // Build a graph representation for path finding
    const graph = new Map<string, Set<string>>();
    const relationshipMap = new Map<string, { count: number, errors: number }>();
    
    // Initialize the graph with direct relationships
    for (const rel of edges) {
      if (!graph.has(rel.parent)) {
        graph.set(rel.parent, new Set<string>());
      }
      graph.get(rel.parent)!.add(rel.child);
      
      // Store relationship metrics
      const key = `${rel.parent}|${rel.child}`;
      relationshipMap.set(key, { 
        count: rel.count, 
        errors: rel.errorCount || 0 
      });
    }
    
    // Find all paths using DFS with early pruning
    const allPaths: Array<{
      path: string[],
      calls: number,
      errors: number,
      errorRate: number,
      errorRatePercentage: number,
      stageMetrics: Array<{
        source: string,
        target: string,
        calls: number,
        errors: number,
        errorRate: number
      }>
    }> = [];
    
    // Set default values
    const minCallCount = options.minCallCount ?? 1;
    const maxPaths = options.maxPaths ?? 50;
    const sortBy = options.sortBy ?? 'calls';
    
    // Helper function to find all paths from source to all possible destinations
    const findAllPaths = (source: string, currentPath: string[] = [], visited = new Set<string>()): boolean => {
      // Add current node to path and mark as visited
      currentPath.push(source);
      visited.add(source);
      
      // Get the maximum path depth (default to 10 if not specified)
      const maxPathDepth = options.maxDepth || 10;
      
      // If this is a leaf node or we've reached the maximum path depth, record the path
      const neighbors = graph.get(source) || new Set<string>();
      if (neighbors.size === 0 || currentPath.length > maxPathDepth) {
        if (currentPath.length > 1) {
          // Calculate metrics for this path
          let totalCalls = Infinity;
          let totalErrors = 0;
          
          // Collect detailed metrics for each stage in the path
          const stageMetrics: Array<{
            source: string,
            target: string,
            calls: number,
            errors: number,
            errorRate: number
          }> = [];
          
          for (let i = 0; i < currentPath.length - 1; i++) {
            const source = currentPath[i];
            const target = currentPath[i + 1];
            const key = `${source}|${target}`;
            const metrics = relationshipMap.get(key);
            
            if (metrics) {
              // Bottleneck approach - minimum calls along the path
              totalCalls = Math.min(totalCalls, metrics.count);
              totalErrors += metrics.errors;
              
              // Add detailed metrics for this stage
              const stageErrorRate = metrics.errors / metrics.count;
              stageMetrics.push({
                source,
                target,
                calls: metrics.count,
                errors: metrics.errors,
                errorRate: stageErrorRate
              });
            }
          }
          
          // Only include paths with enough calls
          if (totalCalls >= minCallCount && totalCalls !== Infinity) {
            const errorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;
            
            // Filter by service if specified
            const includeThisPath = !options.service || currentPath.includes(options.service);
            
            if (includeThisPath) {
              allPaths.push({
                path: [...currentPath],
                calls: totalCalls,
                errors: totalErrors,
                errorRate,
                errorRatePercentage: Math.round(errorRate * 10000) / 100,
                stageMetrics: stageMetrics
              });
              
              // Early termination if we've found enough paths
              // This prevents excessive memory usage
              if (allPaths.length >= maxPaths * 3) {
                return true; // Signal to stop searching
              }
            }
          }
        }
        return false;
      } else {
        // Continue DFS with early pruning
        for (const neighbor of neighbors) {
          // Avoid cycles
          if (!visited.has(neighbor)) {
            // Create a new visited set to avoid modifying the original
            const newVisited = new Set(visited);
            
            // If findAllPaths returns true, we've found enough paths
            if (findAllPaths(neighbor, [...currentPath], newVisited)) {
              return true;
            }
          }
        }
      }
      return false;
    };
    
    // Find root services (those with no incoming edges)
    const allServices = new Set<string>();
    const servicesWithIncomingEdges = new Set<string>();
    
    for (const [parent, children] of graph.entries()) {
      allServices.add(parent);
      for (const child of children) {
        allServices.add(child);
        servicesWithIncomingEdges.add(child);
      }
    }
    
    const rootServices = Array.from(allServices).filter(service => !servicesWithIncomingEdges.has(service));
    
    logger.info('[ES Adapter] Finding paths from root services', { 
      rootServices, 
      totalServices: allServices.size 
    });
    
    // Start DFS from all root services
    for (const rootService of rootServices) {
      // If we've found enough paths, stop searching
      if (allPaths.length >= maxPaths * 3) {
        break;
      }
      
      findAllPaths(rootService);
    }
    
    // If we didn't find any paths from root services and a specific service was requested,
    // try starting from that service
    if (allPaths.length === 0 && options.service && allServices.has(options.service)) {
      logger.info('[ES Adapter] No paths found from root services, trying from specified service', { 
        service: options.service 
      });
      
      findAllPaths(options.service);
    }
    
    // Sort paths based on the specified metric
    allPaths.sort((a, b) => {
      if (sortBy === 'calls') return b.calls - a.calls;
      if (sortBy === 'errors') return b.errors - a.errors;
      return b.errorRate - a.errorRate;
    });
    
    // Limit the number of paths
    const limitedPaths = allPaths.slice(0, maxPaths);
    
    // Create a service map for LLM understanding
    // First, collect all unique services
    const uniqueServices = new Set<string>();
    limitedPaths.forEach(pathData => {
      pathData.path.forEach(service => uniqueServices.add(service));
    });
    
    // Create a map of service relationships
    const serviceRelationships = new Map<string, Array<{
      target: string,
      calls: number,
      errors: number,
      errorRate: number
    }>>();
    
    // Initialize the map for all services
    uniqueServices.forEach(service => {
      serviceRelationships.set(service, []);
    });
    
    // Populate the relationships
    limitedPaths.forEach(pathData => {
      pathData.stageMetrics.forEach(stage => {
        const source = stage.source;
        const relationships = serviceRelationships.get(source) || [];
        
        // Check if this relationship already exists
        const existingRelationship = relationships.find(rel => rel.target === stage.target);
        if (existingRelationship) {
          // Update with higher call count if found
          if (stage.calls > existingRelationship.calls) {
            existingRelationship.calls = stage.calls;
            existingRelationship.errors = stage.errors;
            existingRelationship.errorRate = stage.errorRate;
          }
        } else {
          // Add new relationship
          relationships.push({
            target: stage.target,
            calls: stage.calls,
            errors: stage.errors,
            errorRate: stage.errorRate
          });
        }
      });
    });
    
    // Convert the map to an array for output
    const serviceMap = Array.from(serviceRelationships.entries()).map(([service, relationships]) => ({
      service,
      outboundCalls: relationships.map(rel => ({
        target: rel.target,
        calls: rel.calls,
        errors: rel.errors,
        errorRate: rel.errorRate,
        errorRatePercentage: Math.round(rel.errorRate * 10000) / 100
      }))
    }));
    
    // Also keep the original paths for reference
    const formattedPaths = limitedPaths.map(pathData => ({
      path: pathData.path.join(' → '),
      services: pathData.path,
      length: pathData.path.length,
      metrics: {
        calls: pathData.calls,  // Bottleneck (minimum) calls along the path
        errors: pathData.errors,
        errorRate: pathData.errorRate,
        errorRatePercentage: pathData.errorRatePercentage,
        callsPerMinute: Math.round((pathData.calls / minutesInRange) * 100) / 100,
        stages: pathData.stageMetrics.map(stage => ({
          source: stage.source,
          target: stage.target,
          calls: stage.calls,
          errors: stage.errors,
          errorRate: stage.errorRate,
          errorRatePercentage: Math.round(stage.errorRate * 10000) / 100
        }))
      }
    }));
    
    logger.info('[ES Adapter] Service paths with error rates generated', { 
      totalPaths: allPaths.length,
      displayedPaths: formattedPaths.length
    });
    
    // Return the formatted paths and service map
    return {
      serviceMap, // Include the service architecture map for LLM understanding
      paths: formattedPaths,
      summary: {
        totalPaths: allPaths.length,
        displayedPaths: formattedPaths.length,
        timePeriod: {
          start: startTime,
          end: endTime,
          durationMinutes: minutesInRange
        }
      },
      metadata: {
        message: 'Service architecture map and paths generated successfully',
        filteredBy: options.service ? `service: ${options.service}` : 'none',
        sortedBy: sortBy
      }
    };
  }
  
  public async queryTraces(query: any): Promise<any> {
    return this.tracesAdapter.queryTraces(query);
  }
  
  /**
   * Get a list of all services across all telemetry types (traces, metrics, and logs)
   * @param search Optional search term to filter services by name
   * @returns Array of service names and their versions
   */
  public async getServices(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Get services from traces
      const traceServices = await this.tracesAdapter.getServices(search, startTime, endTime);
      
      // Get services from metrics
      const metricServices = await this.getServicesFromMetrics(search, startTime, endTime);
      
      // Get services from logs
      const logServices = await this.getServicesFromLogs(search, startTime, endTime);
      
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
   * @param search Optional search term to filter services by name (supports wildcards)
   * @param startTime Optional start time for the time range in ISO format
   * @param endTime Optional end time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  private async getServicesFromMetrics(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}>> {
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
      
      // Add time range filter if provided
      if (startTime || endTime) {
        const rangeFilter: any = { range: { '@timestamp': {} } };
        
        if (startTime) {
          rangeFilter.range['@timestamp'].gte = startTime;
        }
        
        if (endTime) {
          rangeFilter.range['@timestamp'].lte = endTime;
        }
        
        query.query.bool.must.push(rangeFilter);
      }
      
      // Add search filter if provided
      if (search) {
        // Check if the search term contains wildcard characters
        const hasWildcards = search.includes('*') || search.includes('?');
        
        if (hasWildcards) {
          // Use wildcard query for pattern matching
          query.query.bool.must.push({
            bool: {
              should: [
                { wildcard: { 'service.name': search } },
                { wildcard: { 'kubernetes.deployment.name': search } }
              ],
              minimum_should_match: 1
            }
          } as any);
        } else {
          // Use match query for exact matching or prefix query for partial matching
          query.query.bool.must.push({
            bool: {
              should: [
                { match: { 'service.name': search } },
                { match: { 'kubernetes.deployment.name': search } }
              ],
              minimum_should_match: 1
            }
          } as any);
        }
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
   * @param search Optional search term to filter services by name (supports wildcards)
   * @param startTime Optional start time for the time range in ISO format
   * @param endTime Optional end time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  private async getServicesFromLogs(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}>> {
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
      
      // Add time range filter if provided
      if (startTime || endTime) {
        if (!(query.query.bool as any).must) {
          (query.query.bool as any).must = [];
        }
        
        const rangeFilter: any = { range: { '@timestamp': {} } };
        
        if (startTime) {
          rangeFilter.range['@timestamp'].gte = startTime;
        }
        
        if (endTime) {
          rangeFilter.range['@timestamp'].lte = endTime;
        }
        
        (query.query.bool as any).must.push(rangeFilter);
      }
      
      // Add search filter if provided
      if (search) {
        // Check if the search term contains wildcard characters
        const hasWildcards = search.includes('*') || search.includes('?');
        
        if (!(query.query.bool as any).must) {
          (query.query.bool as any).must = [];
        }
        
        if (hasWildcards) {
          // Use wildcard query for pattern matching
          (query.query.bool as any).must.push({
            bool: {
              should: [
                { wildcard: { 'service.name': search } } as any,
                { wildcard: { 'resource.service.name': search } } as any,
                { wildcard: { 'Resource.service.name': search } } as any,
                { wildcard: { 'kubernetes.deployment.name': search } } as any,
                { wildcard: { 'k8s.deployment.name': search } } as any
              ],
              minimum_should_match: 1
            }
          });
        } else {
          // Use match query for exact matching or prefix query for partial matching
          (query.query.bool as any).must.push({
            bool: {
              should: [
                { match: { 'service.name': search } } as any,
                { match: { 'resource.service.name': search } } as any,
                { match: { 'Resource.service.name': search } } as any,
                { match: { 'kubernetes.deployment.name': search } } as any,
                { match: { 'k8s.deployment.name': search } } as any
              ],
              minimum_should_match: 1
            }
          });
        }
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
  
  public async aggregateOtelMetricsRange(
    options: {
      metricName: string;
      service?: string;
      startTime: string;
      endTime: string;
      interval?: string;
      percentiles?: number[];
      dimensions?: string[];
      filters?: Record<string, any>;
    }
  ): Promise<{
    metricName: string;
    service?: string;
    timeRange: { start: string; end: string };
    interval: string;
    buckets: Array<{
      timestamp: string;
      value: number;
      count: number;
      min?: number;
      max?: number;
      avg?: number;
      sum?: number;
      percentiles?: Record<string, number>;
      dimensions?: Record<string, any>;
    }>;
  }> {
    return this.metricsAdapter.aggregateOtelMetricsRange(options);
  }
  
  public async queryMetrics(query: any): Promise<any> {
    return this.metricsAdapter.queryMetrics(query);
  }
  
  // Logs methods
  public async listLogFields(includeSourceDocument: boolean = true): Promise<Array<{ name: string, type: string, count: number, schema: any }>> {
    return this.logsAdapter.listLogFields(includeSourceDocument);
  }

  public async searchOtelLogs(
    options: {
      query?: string;
      service?: string;
      level?: string;
      startTime?: string;
      endTime?: string;
      limit?: number;
      offset?: number;
      sortDirection?: 'asc' | 'desc';
      traceId?: string;
      spanId?: string;
    }
  ): Promise<any[]> {
    return this.logsAdapter.searchOtelLogs(options);
  }
  
  public async topErrors(
    options: {
      startTime: string;
      endTime: string;
      limit?: number;
      service?: string;
      includeExamples?: boolean;
    }
  ): Promise<Array<{
    error: string;
    count: number;
    service: string;
    examples?: Array<{
      timestamp: string;
      message: string;
      trace_id?: string;
      service: string;
    }>;
  }>> {
    return this.logsAdapter.topErrors(options);
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
export { TracesAdapter } from './traces/index.js';
export { MetricsAdapter } from './metrics/metrics.js';
export { LogsAdapter } from './logs/logs.js';

import { ElasticsearchCore, ElasticsearchAdapterOptions } from '../core/core.js';
import { logger } from '../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../utils/errorHandling.js';
import { createBoolQuery, createQueryStringQuery, createRangeQuery } from '../../../utils/queryBuilder.js';
import { ServiceResolver } from '../../../utils/serviceResolver.js';
import { parseTimeRange, getDefaultTimeRange } from '../../../utils/timeRangeParser.js';

/**
 * Service discovery functionality for the Elasticsearch Adapter
 */
export class ServiceDiscovery {
  private coreAdapter: ElasticsearchCore;
  
  constructor(options: ElasticsearchAdapterOptions) {
    this.coreAdapter = new ElasticsearchCore(options);
  }
  
  /**
   * Get a list of all services across all telemetry types (traces, metrics, and logs)
   * @param search Optional search term to filter services by name
   * @param startTime Optional start time for the time range in ISO format
   * @param endTime Optional end time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  public async getServices(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    try {
      logger.info('[ServiceDiscovery] Getting services', { search, startTime, endTime });
      
      // Parse time range
      let timeRange;
      if (startTime && endTime) {
        const parsedTimeRange = parseTimeRange(startTime, endTime);
        if (isErrorResponse(parsedTimeRange)) {
          return parsedTimeRange;
        }
        timeRange = parsedTimeRange;
      } else {
        timeRange = getDefaultTimeRange();
      }
      
      // Get services from each telemetry type
      const [tracesServices, metricsServices, logsServices] = await Promise.all([
        this.getServicesFromTraces(search, timeRange.startTime, timeRange.endTime),
        this.getServicesFromMetrics(search, timeRange.startTime, timeRange.endTime),
        this.getServicesFromLogs(search, timeRange.startTime, timeRange.endTime)
      ]);
      
      // Merge services
      const serviceMap = new Map<string, Set<string>>();
      
      // Helper to add services to the map
      const addServices = (services: Array<{name: string, versions: string[]}> | ErrorResponse) => {
        if (isErrorResponse(services)) {
          return;
        }
        
        for (const service of services) {
          if (!serviceMap.has(service.name)) {
            serviceMap.set(service.name, new Set<string>());
          }
          
          const versions = serviceMap.get(service.name)!;
          for (const version of service.versions) {
            versions.add(version);
          }
        }
      };
      
      // Add services from each telemetry type
      addServices(tracesServices);
      addServices(metricsServices);
      addServices(logsServices);
      
      // Convert map to array
      const result = Array.from(serviceMap.entries()).map(([name, versions]) => ({
        name,
        versions: Array.from(versions)
      }));
      
      // Sort by name
      result.sort((a, b) => a.name.localeCompare(b.name));
      
      return result;
    } catch (error) {
      return createErrorResponse(`Error getting services: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get services from traces data
   * @param search Optional search term to filter services by name
   * @param startTime Start time for the time range in ISO format
   * @param endTime End time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  private async getServicesFromTraces(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    try {
      logger.debug('[ServiceDiscovery] Getting services from traces', { search, startTime, endTime });
      
      // Build query
      const must = [];
      
      // Add time range if provided
      if (startTime && endTime) {
        must.push(createRangeQuery('@timestamp', startTime, endTime));
      }
      
      // Add search filter if provided
      if (search && search.trim() !== '') {
        const serviceQuery = ServiceResolver.createServiceQuery(search, 'TRACES');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Build aggregation
      const aggs = {
        services: {
          terms: {
            field: 'Resource.service.name',
            size: 1000
          },
          aggs: {
            versions: {
              terms: {
                field: 'Resource.service.version',
                size: 100
              }
            }
          }
        }
      };
      
      // Build query
      const query = {
        query: createBoolQuery({ must }),
        size: 0,
        aggs
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting services from traces: ${errorMessage}`);
      }
      
      // Extract services
      const services = result.aggregations?.services?.buckets || [];
      
      return services.map((bucket: any) => {
        const versions = (bucket.versions?.buckets || []).map((versionBucket: any) => versionBucket.key);
        return {
          name: bucket.key,
          versions: versions.length > 0 ? versions : ['unknown']
        };
      });
    } catch (error) {
      return createErrorResponse(`Error getting services from traces: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get services from metrics data
   * @param search Optional search term to filter services by name
   * @param startTime Start time for the time range in ISO format
   * @param endTime End time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  public async getServicesFromMetrics(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    try {
      logger.debug('[ServiceDiscovery] Getting services from metrics', { search, startTime, endTime });
      
      // Build query
      const must = [];
      
      // Add time range if provided
      if (startTime && endTime) {
        must.push(createRangeQuery('@timestamp', startTime, endTime));
      }
      
      // Add search filter if provided
      if (search && search.trim() !== '') {
        const serviceQuery = ServiceResolver.createServiceQuery(search, 'METRICS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Build aggregation
      const aggs = {
        services: {
          terms: {
            field: 'service.name',
            size: 1000
          },
          aggs: {
            versions: {
              terms: {
                field: 'service.version',
                size: 100
              }
            }
          }
        }
      };
      
      // Build query
      const query = {
        query: createBoolQuery({ must }),
        size: 0,
        aggs
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-metrics-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting services from metrics: ${errorMessage}`);
      }
      
      // Extract services
      const services = result.aggregations?.services?.buckets || [];
      
      return services.map((bucket: any) => {
        const versions = (bucket.versions?.buckets || []).map((versionBucket: any) => versionBucket.key);
        return {
          name: bucket.key,
          versions: versions.length > 0 ? versions : ['unknown']
        };
      });
    } catch (error) {
      return createErrorResponse(`Error getting services from metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get services from logs data
   * @param search Optional search term to filter services by name
   * @param startTime Start time for the time range in ISO format
   * @param endTime End time for the time range in ISO format
   * @returns Array of service names and their versions
   */
  public async getServicesFromLogs(
    search?: string, 
    startTime?: string, 
    endTime?: string
  ): Promise<Array<{name: string, versions: string[]}> | ErrorResponse> {
    try {
      logger.debug('[ServiceDiscovery] Getting services from logs', { search, startTime, endTime });
      
      // Build query
      const must = [];
      
      // Add time range if provided
      if (startTime && endTime) {
        must.push(createRangeQuery('@timestamp', startTime, endTime));
      }
      
      // Add search filter if provided
      if (search && search.trim() !== '') {
        const serviceQuery = ServiceResolver.createServiceQuery(search, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Build aggregation
      const aggs = {
        services: {
          terms: {
            field: 'Resource.service.name',
            size: 1000
          },
          aggs: {
            versions: {
              terms: {
                field: 'Resource.service.version',
                size: 100
              }
            }
          }
        }
      };
      
      // Build query
      const query = {
        query: createBoolQuery({ must }),
        size: 0,
        aggs
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-logs-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting services from logs: ${errorMessage}`);
      }
      
      // Extract services
      const services = result.aggregations?.services?.buckets || [];
      
      return services.map((bucket: any) => {
        const versions = (bucket.versions?.buckets || []).map((versionBucket: any) => versionBucket.key);
        return {
          name: bucket.key,
          versions: versions.length > 0 ? versions : ['unknown']
        };
      });
    } catch (error) {
      return createErrorResponse(`Error getting services from logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Get operations for a specific service
   * @param service Service name
   * @returns Array of operation names
   */
  public async getOperations(service: string): Promise<string[] | ErrorResponse> {
    try {
      logger.info('[ServiceDiscovery] Getting operations for service', { service });
      
      if (!service) {
        return createErrorResponse('Service name is required');
      }
      
      // Build query
      const must = [];
      
      // Add service filter
      const serviceQuery = ServiceResolver.createServiceQuery(service, 'TRACES', { exactMatch: true });
      if (isErrorResponse(serviceQuery)) {
        return serviceQuery;
      }
      must.push(serviceQuery);
      
      // Build aggregation
      const aggs = {
        operations: {
          terms: {
            field: 'Name',
            size: 1000
          }
        }
      };
      
      // Build query
      const query = {
        query: createBoolQuery({ must }),
        size: 0,
        aggs
      };
      
      // Execute query
      const result = await this.coreAdapter.callEsRequest('POST', '/.ds-traces-*/_search', query);
      
      if (!result || result.error) {
        const errorMessage = result?.error?.reason || 'Unknown error';
        return createErrorResponse(`Error getting operations: ${errorMessage}`);
      }
      
      // Extract operations
      const operations = result.aggregations?.operations?.buckets || [];
      
      return operations.map((bucket: any) => bucket.key);
    } catch (error) {
      return createErrorResponse(`Error getting operations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

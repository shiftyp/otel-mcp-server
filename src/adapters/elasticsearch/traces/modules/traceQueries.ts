import { logger } from '../../../../utils/logger.js';
import { TraceCore } from './traceCore.js';
import { getServiceName, getServiceVersion } from '../../scripts/traces/traceScripts.js';

/**
 * Functionality for querying trace data
 */
export class TraceQueries extends TraceCore {
  /**
   * Execute a query against the traces index
   */
  public async queryTraces(query: any): Promise<any> {
    try {
      // Ensure we have a query object
      if (!query) {
        query = { query: { match_all: {} } };
      }
      
      // If a search string is provided, convert it to a query_string query
      if (query.search && typeof query.search === 'string') {
        const searchQuery = {
          query_string: {
            query: query.search,
            default_operator: 'AND',
            fields: [
              'trace_id^5',
              'span_id^5',
              'name^4',
              'resource.attributes.service.name^4',
              'Resource.service.name^4',
              'service.name^4',
              'attributes.*^3',
              'Attributes.*^3',
              'status.code^2',
              'Status.Code^2',
              '*'
            ]
          }
        };
        
        // Replace the query with the query_string
        query.query = searchQuery;
        delete query.search;
      }
      
      // Set reasonable defaults
      if (!query.size) {
        query.size = 20;
      }
      
      // Execute the query
      logger.debug('[ES Adapter] Executing trace query', { query });
      const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
      
      return response;
    } catch (error) {
      logger.error('[ES Adapter] Error executing trace query', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        query
      });
      
      throw error;
    }
  }

  /**
   * Get a list of services from trace data
   */
  public async getServices(search?: string, startTime?: string, endTime?: string): Promise<Array<{name: string, versions: string[]}>> {
    try {
      // Build a query to get service names
      const query: any = {
        size: 0,
        aggs: {
          services: {
            terms: {
              script: {
                source: getServiceName
              },
              size: 100
            },
            aggs: {
              versions: {
                terms: {
                  script: {
                    source: getServiceVersion
                  },
                  size: 20
                }
              }
            }
          }
        }
      };
      
      // Add time range if provided
      if (startTime || endTime) {
        query.query = {
          bool: {
            filter: []
          }
        };
        
        if (startTime) {
          query.query.bool.filter.push({
            range: {
              '@timestamp': {
                gte: new Date(startTime).toISOString()
              }
            }
          });
        }
        
        if (endTime) {
          query.query.bool.filter.push({
            range: {
              '@timestamp': {
                lte: new Date(endTime).toISOString()
              }
            }
          });
        }
      }
      
      // Add search filter if provided
      if (search) {
        if (!query.query) {
          query.query = { bool: { filter: [] } };
        }
        
        query.query.bool.filter.push({
          bool: {
            should: [
              { wildcard: { 'resource.attributes.service.name': `*${search}*` } },
              { wildcard: { 'Resource.service.name': `*${search}*` } },
              { wildcard: { 'service.name': `*${search}*` } }
            ],
            minimum_should_match: 1
          }
        });
      }
      
      // Execute the query
      logger.debug('[ES Adapter] Getting services from traces', { query });
      const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
      
      // Process the results
      const services: Array<{name: string, versions: string[]}> = [];
      
      if (response.aggregations?.services?.buckets) {
        for (const bucket of response.aggregations.services.buckets) {
          const serviceName = bucket.key;
          const versions: string[] = [];
          
          // Add versions
          if (bucket.versions?.buckets) {
            for (const versionBucket of bucket.versions.buckets) {
              if (versionBucket.key !== 'unknown') {
                versions.push(versionBucket.key);
              }
            }
          }
          
          services.push({
            name: serviceName,
            versions
          });
        }
      }
      
      return services;
    } catch (error) {
      logger.error('[ES Adapter] Error getting services from traces', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return [];
    }
  }

  /**
   * Get operations for a specific service
   */
  public async getOperations(service: string): Promise<string[]> {
    try {
      // Build a query to get operations for the service
      const query = {
        size: 0,
        query: {
          bool: {
            should: [
              { term: { 'resource.attributes.service.name': service } },
              { term: { 'Resource.service.name': service } },
              { term: { 'service.name': service } }
            ],
            minimum_should_match: 1
          }
        },
        aggs: {
          operations: {
            terms: {
              field: 'name',
              size: 100
            }
          }
        }
      };
      
      // Execute the query
      logger.debug('[ES Adapter] Getting operations for service', { service, query });
      const response = await this.request('POST', `/${this.traceIndexPattern}/_search`, query);
      
      // Process the results
      const operations: string[] = [];
      
      if (response.aggregations?.operations?.buckets) {
        for (const bucket of response.aggregations.operations.buckets) {
          operations.push(bucket.key);
        }
      }
      
      return operations;
    } catch (error) {
      logger.error('[ES Adapter] Error getting operations for service', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        service
      });
      
      return [];
    }
  }
}

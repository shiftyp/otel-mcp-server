import { BaseSearchAdapter, AdapterCapabilities, QueryResult, FieldInfo, AnomalyConfig, AnomalyResult, ForecastConfig, ForecastResult, PatternConfig, PatternResult } from '../base/searchAdapter.js';
import { ServiceInfo } from '../../types.js';
import { OpenSearchCore, OpenSearchAdapterOptions } from './core/core.js';
import { TracesAdapter } from './traces/index.js';
import { MetricsAdapter } from './metrics/index.js';
import { LogsAdapter } from './logs/index.js';
import { logger } from '../../utils/logger.js';
import { ConfigLoader } from '../../config/index.js';

/**
 * OpenSearchAdapter that extends BaseSearchAdapter with ML capabilities
 * Provides full implementation of base methods plus OpenSearch-specific features
 */
export class OpenSearchAdapter extends BaseSearchAdapter {
  private readonly core: OpenSearchCore;
  public readonly tracesAdapter: TracesAdapter;
  public readonly metricsAdapter: MetricsAdapter;
  public readonly logsAdapter: LogsAdapter;

  constructor(options: OpenSearchAdapterOptions) {
    super(options);

    this.core = new OpenSearchCore(options);
    this.tracesAdapter = new TracesAdapter(options);
    this.metricsAdapter = new MetricsAdapter(options);
    this.logsAdapter = new LogsAdapter(options);
  }

  //===========================================================================
  // Implement BaseSearchAdapter abstract methods
  //===========================================================================

  /**
   * Get adapter capabilities - OpenSearch has ML features
   */
  public getCapabilities(): AdapterCapabilities {
    return {
      ml: {
        anomalyDetection: true,
        forecasting: true,
        patternAnalysis: true,
        clustering: true
      },
      search: {
        vectorSearch: true,
        fuzzySearch: true,
        semanticSearch: true
      },
      aggregations: {
        pipeline: true,
        matrix: true,
        percentiles: true
      }
    };
  }

  /**
   * Execute a query against an index
   */
  public async query<T = any>(
    index: string,
    query: any,
    options?: {
      size?: number;
      from?: number;
      sort?: any[];
      aggregations?: any;
    }
  ): Promise<QueryResult<T>> {
    try {
      const searchBody: any = {
        query,
        size: options?.size || 10,
        from: options?.from || 0
      };

      if (options?.sort) {
        searchBody.sort = options.sort;
      }

      if (options?.aggregations) {
        searchBody.aggs = options.aggregations;
      }

      const response = await this.core.callRequest('POST', `/${index}/_search`, searchBody);

      const hits = response.hits;
      return {
        timed_out: response.timed_out || false,
        _shards: response._shards || {
          total: 1,
          successful: 1,
          skipped: 0,
          failed: 0
        },
        hits: {
          total: {
            value: typeof hits.total === 'object' ? hits.total.value : hits.total || 0,
            relation: typeof hits.total === 'object' ? hits.total.relation : 'eq'
          },
          max_score: hits.max_score || null,
          hits: hits.hits || []
        },
        aggregations: response.aggregations
      };
    } catch (error) {
      logger.error('[OpenSearch Adapter] Query error', { error, index, query });
      throw error;
    }
  }

  /**
   * Get field information for an index
   */
  public async getFields(indexPattern: string, search?: string): Promise<FieldInfo[]> {
    const response = await this.core.callRequest('GET', `/${indexPattern}/_mapping`);
    const fields: FieldInfo[] = [];

    for (const index in response) {
      const mappings = response[index].mappings;
      if (mappings && mappings.properties) {
        this.extractFieldInfo(mappings.properties, '', fields, search);
      }
    }

    return fields;
  }

  /**
   * Get available services from traces
   */
  public async getServices(): Promise<ServiceInfo[]> {
    // Try both logs and traces indices to find services
    const logsIndex = this.core.getLogsIndex();
    const tracesIndex = this.core.getTracesIndex();

    // First try logs index which we know has data
    const logsResponse = await this.query(logsIndex, {
      match_all: {}
    }, {
      size: 0,
      aggregations: {
        services: {
          terms: {
            field: 'service.name.keyword',
            size: 1000
          },
          aggs: {
            versions: {
              terms: {
                field: 'service.version.keyword',
                size: 10
              }
            },
            namespaces: {
              terms: {
                field: 'service.namespace.keyword',
                size: 10
              }
            }
          }
        }
      }
    });

    // Then try traces index with the original field path
    const tracesResponse = await this.query(tracesIndex, {
      match_all: {}
    }, {
      size: 0,
      aggregations: {
        services: {
          terms: {
            field: 'resource.attributes.service.name.keyword',
            size: 1000
          },
          aggs: {
            versions: {
              terms: {
                field: 'resource.attributes.service.version.keyword',
                size: 10
              }
            }
          }
        }
      }
    }).catch(() => {
      // If traces index query fails, just return an empty response
      return { aggregations: { services: { buckets: [] } } };
    });

    // Combine results from both indices
    const logsServices = logsResponse.aggregations?.services?.buckets || [];
    const tracesServices = tracesResponse.aggregations?.services?.buckets || [];
    // Create a map to deduplicate services by name
    const serviceMap = new Map<string, ServiceInfo>();

    // Process logs services
    logsServices.forEach((bucket: any) => {
      serviceMap.set(bucket.key, {
        name: bucket.key,
        instances: bucket.doc_count,
        version: bucket.versions?.buckets?.[0]?.key || 'unknown',
        lastSeen: new Date().toISOString(),
        metadata: {
          namespace: bucket.namespaces?.buckets?.[0]?.key
        }
      });
    });

    // Add or merge traces services
    tracesServices.forEach((bucket: any) => {
      if (serviceMap.has(bucket.key)) {
        // Update existing service with additional info
        const existing = serviceMap.get(bucket.key)!;
        serviceMap.set(bucket.key, {
          ...existing,
          instances: (existing.instances || 0) + bucket.doc_count,
          // Only update version if it was unknown before
          version: existing.version === 'unknown' ?
            (bucket.versions?.buckets?.[0]?.key || 'unknown') :
            existing.version
        });
      } else {
        // Add new service from traces
        serviceMap.set(bucket.key, {
          name: bucket.key,
          instances: bucket.doc_count,
          version: bucket.versions?.buckets?.[0]?.key || 'unknown',
          lastSeen: new Date().toISOString()
        });
      }
    });

    return Array.from(serviceMap.values());
  }

  /**
   * Core methods - delegate to core adapter
   */
  public callRequest(method: string, url: string, data?: any, config?: any): Promise<any> {
    return this.core.callRequest(method, url, data, config);
  }

  public async getIndices(): Promise<string[]> {
    return this.core.getIndices();
  }

  public async checkConnection(): Promise<boolean> {
    return this.core.checkConnection();
  }

  public async getInfo(): Promise<any> {
    return this.core.getInfo();
  }

  public getType(): string {
    return this.core.getType();
  }

  public async getVersion(): Promise<{ version: string; distribution?: string }> {
    const version = await this.core.getVersion();
    return { version, distribution: 'opensearch' };
  }

  public supportsFeature(feature: string): boolean {
    return this.core.supportsFeature(feature);
  }

  /**
   * Telemetry query methods
   */
  public async queryLogs(query: any): Promise<any> {
    return this.logsAdapter.searchLogs(query);
  }

  public async listLogFields(): Promise<any[]> {
    const result = await this.logsAdapter.getLogFields();
    // If it's an error response, return empty array
    if (result && typeof result === 'object' && 'error' in result) {
      logger.error('[OpenSearch Adapter] Error getting log fields', { error: result });
      return [];
    }
    return result as any[];
  }

  public async queryTraces(query: any): Promise<any> {
    return this.tracesAdapter.searchTraces(query);
  }

  public async queryMetrics(query: any): Promise<any> {
    return this.metricsAdapter.searchMetrics(query);
  }

  /**
   * ML methods - simplified implementations
   */
  public async detectAnomalies(
    index: string,
    config: AnomalyConfig,
    timeRange?: { from: string; to: string }
  ): Promise<AnomalyResult[]> {
    // Determine which adapter to use based on index
    if (index.includes('log')) {
      const result = await this.logsAdapter.analysis.detectAnomalies({
        timeRange: {
          from: timeRange?.from || 'now-1h',
          to: timeRange?.to || 'now'
        },
        threshold: config.threshold
      });
      return this.convertToAnomalyResults(result);
    } else if (index.includes('metric')) {
      const result = await this.metricsAdapter.detectMetricAnomalies(
        timeRange?.from || 'now-1h',
        timeRange?.to || 'now',
        { metricField: config.field || 'value', thresholdType: 'stddev' }
      );
      return this.convertToAnomalyResults(result);
    }

    return [];
  }

  public async forecast(
    _index: string,
    config: ForecastConfig,
    historicalData?: { from: string; to: string }
  ): Promise<ForecastResult[]> {
    const analysis = await this.metricsAdapter.timeSeriesAnalysis(
      historicalData?.from || 'now-7d',
      historicalData?.to || 'now',
      {
        metricField: config.field,
        analysisType: 'full',
        forecastPoints: config.periods
      }
    );

    return this.convertToForecastResults(analysis);
  }

  public async analyzePatterns(
    _index: string,
    config: PatternConfig,
    timeRange?: { from: string; to: string }
  ): Promise<PatternResult[]> {
    const patterns = await this.logsAdapter.patterns.extract({
      minSupport: config.minSupport,
      maxPatterns: config.maxPatternLength || 100,
      timeRange: {
        from: timeRange?.from || 'now-1h',
        to: timeRange?.to || 'now'
      }
    });

    return this.convertToPatternResults(patterns);
  }

  /**
   * Helper methods
   */
  private extractFieldInfo(properties: any, path: string, fields: FieldInfo[], search?: string): void {
    for (const field in properties) {
      const fullPath = path ? `${path}.${field}` : field;

      // Check if field matches search pattern
      let matches = true;
      if (search) {
        // Convert wildcard pattern to regex
        const pattern = search
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except *
          .replace(/\*/g, '.*'); // Convert * to .*
        const regex = new RegExp(`^${pattern}$`, 'i');
        matches = regex.test(fullPath);
      }

      if (matches) {
        const fieldInfo = properties[field];
        fields.push({
          name: fullPath,
          type: fieldInfo.type || 'object',
          searchable: fieldInfo.type !== 'binary',
          aggregatable: fieldInfo.type !== 'text',
          count: 0
        });
      }

      if (properties[field].properties) {
        this.extractFieldInfo(properties[field].properties, fullPath, fields, search);
      }
    }
  }

  private convertToAnomalyResults(result: any): AnomalyResult[] {
    if (!result || !result.anomalies) return [];

    return result.anomalies.map((anomaly: any) => ({
      timestamp: anomaly.timestamp,
      value: anomaly.value,
      score: anomaly.anomalyScore || anomaly.score,
      isAnomaly: anomaly.isAnomaly || anomaly.anomalyScore > 0.7,
      field: anomaly.field
    }));
  }

  private convertToForecastResults(analysis: any): ForecastResult[] {
    if (!analysis || !analysis.forecast) return [];

    return analysis.forecast.map((point: any) => ({
      timestamp: point.timestamp,
      predicted: point.value,
      lower: point.lower || point.value * 0.9,
      upper: point.upper || point.value * 1.1,
      confidence: point.confidence || 0.95
    }));
  }

  private convertToPatternResults(patterns: any): PatternResult[] {
    if (!patterns || !patterns.patterns) return [];

    return patterns.patterns.map((pattern: any) => ({
      pattern: pattern.pattern,
      count: pattern.count,
      frequency: pattern.frequency || pattern.count / 100,
      examples: pattern.examples || []
    }));
  }

  /**
   * Override semantic log search to use OpenSearch's capabilities
   */
  public async semanticLogSearch(query: string, options?: any): Promise<any> {
    const results = await this.logsAdapter.ml.semantic.search(query, options);

    // Transform array results to expected format
    if (Array.isArray(results)) {
      return {
        hits: results.map(r => ({
          _source: r.log,
          _score: r.score
        })),
        total: results.length,
        maxScore: results.length > 0 ? Math.max(...results.map(r => r.score)) : 0
      };
    }

    return results;
  }

  /**
   * Override cluster traces to use OpenSearch's capabilities
   */
  public async clusterTraces(options: any): Promise<any> {
    logger.info('[OpenSearch Adapter] Clustering traces', { options });

    try {
      // Extract parameters from options
      const timeRange = options.timeRange || { from: 'now-1h', to: 'now' };
      const features = options.features || ['duration', 'span.name', 'service.name'];
      const numClusters = options.numClusters || 5;
      const service = options.service;

      // Use text content clustering for traces
      // This will extract meaningful text from trace attributes and cluster them
      const clusteringResult = await this.tracesAdapter.clusterTraceAttributes(
        'text_content', // Use text content extraction
        timeRange.from,
        timeRange.to,
        {
          service,
          clusterCount: numClusters,
          minClusterSize: 3,
          includeOutliers: true,
          enableSampling: true,
          samplingPercent: 10,
          maxSamples: 1000,
          embeddingBatchSize: 10
        }
      );

      // Transform the result to match the expected format
      const clusters = clusteringResult.clusters.map((cluster: any, index: number) => ({
        id: cluster.id || index,
        size: cluster.values ? cluster.values.length : 0,
        centroid: {
          // Extract key features from cluster
          'span.name': cluster.label || `Cluster ${index}`,
          'service.name': this.extractCommonService(cluster.values),
          'duration': this.calculateAverageDuration(cluster.values) // Already in milliseconds
        },
        samples: cluster.values ? cluster.values.slice(0, 10).map((value: any) => ({
          id: value.traceId || value.id,
          trace_id: value.traceId || value.id,
          'span.name': value.spanName || value.operation || 'unknown',
          'service.name': value.serviceName || value.service || 'unknown',
          duration: (value.duration || 0) / 1000, // Convert microseconds to milliseconds
          status: value.status || 'OK',
          error: value.error || false,
          error_message: value.errorMessage,
          // Include the actual text content that was clustered
          clustered_text: value.value || value.text
        })) : []
      }));

      return {
        clusters,
        totalTraces: clusteringResult.totalValues || 0,
        sampledTraces: clusteringResult.sampledValues || 0,
        clusterCount: clusteringResult.clusterCount || 0,
        outliers: clusteringResult.outliers ? clusteringResult.outliers.length : 0,
        metadata: {
          timeRange,
          features,
          service,
          samplingEnabled: clusteringResult.samplingEnabled,
          samplingPercent: clusteringResult.samplingPercent
        }
      };
    } catch (error) {
      logger.error('[OpenSearch Adapter] Error clustering traces', { error });

      // Return empty result on error
      return {
        clusters: [],
        totalTraces: 0,
        sampledTraces: 0,
        clusterCount: 0,
        outliers: 0,
        error: error instanceof Error ? error.message : 'Failed to cluster traces',
        metadata: {
          timeRange: options.timeRange || { from: 'now-1h', to: 'now' },
          features: options.features || ['duration', 'span.name', 'service.name'],
          service: options.service
        }
      };
    }
  }

  /**
   * Helper to extract common service from cluster values
   */
  private extractCommonService(values: any[]): string {
    if (!values || values.length === 0) return 'unknown';

    const serviceCounts: Record<string, number> = {};
    values.forEach(value => {
      const service = value.serviceName || value.service || 'unknown';
      serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });

    // Return the most common service
    return Object.entries(serviceCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';
  }

  /**
   * Helper to calculate average duration from cluster values
   */
  private calculateAverageDuration(values: any[]): number {
    if (!values || values.length === 0) return 0;

    const durations = values
      .map(v => v.duration || 0)
      .filter(d => d > 0);

    if (durations.length === 0) return 0;

    // Convert from microseconds to milliseconds
    const avgMicroseconds = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    return avgMicroseconds / 1000;
  }

  /**
   * Override analyze traces to use OpenSearch's capabilities
   */
  public async analyzeTraces(options: any): Promise<any> {
    const config = ConfigLoader.get();
    const timeRange = options.timeRange || { from: 'now-1h', to: 'now' };
    const tracesIndex = this.core.getTracesIndex();

    const result = await this.query(tracesIndex, {
      bool: {
        must: [
          {
            range: {
              [config.telemetry.fields.timestamp]: {
                gte: timeRange.from,
                lte: timeRange.to
              }
            }
          }
        ]
      }
    }, {
      size: 0,
      aggregations: {
        total_traces: {
          cardinality: {
            field: 'trace.id'
          }
        },
        error_traces: {
          filter: {
            term: { 'status.code': 2 }
          },
          aggs: {
            count: {
              cardinality: {
                field: 'trace.id'
              }
            }
          }
        },
        latency_stats: {
          stats: {
            field: 'duration'
          }
        },
        latency_percentiles: {
          percentiles: {
            field: 'duration',
            percents: [50, 95, 99]
          }
        },
        top_operations: {
          terms: {
            field: 'span.name.keyword',
            size: 20
          },
          aggs: {
            avg_duration: {
              avg: {
                field: 'duration'
              }
            },
            error_count: {
              filter: {
                term: { 'status.code': 2 }
              }
            }
          }
        }
      }
    });

    const totalTraces = result.aggregations?.total_traces?.value || 0;
    const errorTraces = result.aggregations?.error_traces?.count?.value || 0;
    const errorRate = totalTraces > 0 ? (errorTraces / totalTraces) * 100 : 0;

    return {
      totalTraces,
      errorRate,
      latency: {
        // Convert from microseconds to milliseconds
        avg: (result.aggregations?.latency_stats?.avg || 0) / 1000,
        min: (result.aggregations?.latency_stats?.min || 0) / 1000,
        max: (result.aggregations?.latency_stats?.max || 0) / 1000,
        p50: (result.aggregations?.latency_percentiles?.values?.['50.0'] || 0) / 1000,
        p95: (result.aggregations?.latency_percentiles?.values?.['95.0'] || 0) / 1000,
        p99: (result.aggregations?.latency_percentiles?.values?.['99.0'] || 0) / 1000
      },
      topOperations: result.aggregations?.top_operations?.buckets?.map((bucket: any) => ({
        ...bucket,
        avg_duration: (bucket.avg_duration?.value || 0) / 1000 // Convert to milliseconds
      })) || []
    };
  }

  async getServiceDependencies(timeRange: { from: string, to: string }): Promise<any> {
    const config = ConfigLoader.get();
    const tracesIndex = config.telemetry.indices.traces;
    
    logger.info('[OpenSearch Adapter] Getting service dependencies using composite aggregations', { timeRange });
    
    // Base query to filter by time range
    const query = {
      bool: {
        must: [
          {
            range: {
              [config.telemetry.fields.timestamp]: {
                gte: timeRange.from,
                lte: timeRange.to
              }
            }
          },
          {
            exists: { 
              field: "ParentSpanId.keyword" 
            }
          }
        ]
      }
    };

    // Maps to store our results
    const spanServiceMap = new Map<string, string>();
    const spanDurationMap = new Map<string, number>();
    const dependencies = new Map<string, any>();
    
    // First, build a map of all span IDs to their service names using pagination
    let afterKey = null;
    let totalSpans = 0;
    
    do {
      const spanServiceResult: any = await this.query(tracesIndex, query, {
        size: 0,
        aggregations: {
          span_services: {
            composite: {
              size: 10000,
              sources: [
                { trace_id: { terms: { field: "TraceId.keyword" } } },
                { span_id: { terms: { field: "SpanId.keyword" } } }
              ],
              ...(afterKey ? { after: afterKey } : {})
            },
            aggregations: {
              service: {
                terms: {
                  field: "Resource.service.name.keyword",
                  size: 1
                }
              },
              duration: {
                avg: {
                  field: "Duration"
                }
              }
            }
          }
        }
      });
      
      const buckets = spanServiceResult.aggregations?.span_services?.buckets || [];
      afterKey = spanServiceResult.aggregations?.span_services?.after_key;
      
      for (const bucket of buckets) {
        const traceId = bucket.key.trace_id;
        const spanId = bucket.key.span_id;
        const serviceBuckets = bucket.service?.buckets || [];
        
        if (serviceBuckets.length > 0) {
          const service = serviceBuckets[0].key;
          const spanKey = `${traceId}:${spanId}`;
          spanServiceMap.set(spanKey, service);
          spanDurationMap.set(spanKey, bucket.duration?.value || 0);
        }
      }
      
      totalSpans += buckets.length;
      logger.debug(`[OpenSearch Adapter] Processed ${buckets.length} spans, total: ${totalSpans}`);
      
    } while (afterKey);
    
    logger.info(`[OpenSearch Adapter] Built span-service map with ${totalSpans} spans`);
    
    // Now, get all parent-child relationships using pagination
    afterKey = null;
    let totalRelationships = 0;
    
    do {
      const parentChildResult: any = await this.query(tracesIndex, query, {
        size: 0,
        aggregations: {
          parent_child: {
            composite: {
              size: 10000,
              sources: [
                { trace_id: { terms: { field: "TraceId.keyword" } } },
                { span_id: { terms: { field: "SpanId.keyword" } } },
                { parent_id: { terms: { field: "ParentSpanId.keyword" } } }
              ],
              ...(afterKey ? { after: afterKey } : {})
            }
          }
        }
      });
      
      const buckets = parentChildResult.aggregations?.parent_child?.buckets || [];
      afterKey = parentChildResult.aggregations?.parent_child?.after_key;
      
      for (const bucket of buckets) {
        const traceId = bucket.key.trace_id;
        const spanId = bucket.key.span_id;
        const parentSpanId = bucket.key.parent_id;
        
        const childService = spanServiceMap.get(`${traceId}:${spanId}`);
        const parentService = spanServiceMap.get(`${traceId}:${parentSpanId}`);
        
        if (childService && parentService && childService !== parentService && 
            childService !== 'unknown' && parentService !== 'unknown') {
          const edgeId = `${parentService}->${childService}`;
          
          if (!dependencies.has(edgeId)) {
            dependencies.set(edgeId, {
              source: parentService,
              target: childService,
              callCount: 0,
              errorCount: 0,
              durations: [],
              latencyStats: {
                avg: 0,
                min: 0,
                max: 0,
                p50: 0,
                p95: 0,
                p99: 0
              },
              throughput: 0,
              successRate: 100
            });
          }
          
          const dep = dependencies.get(edgeId);
          dep.callCount++;
          
          // Collect duration for latency statistics
          const duration = spanDurationMap.get(`${traceId}:${spanId}`);
          if (duration && duration > 0) {
            dep.durations.push(duration);
          }
        }
      }
      
      totalRelationships += buckets.length;
      logger.debug(`[OpenSearch Adapter] Processed ${buckets.length} parent-child relationships, total: ${totalRelationships}`);
      
    } while (afterKey);
    
    // Get error information for each service pair
    // This is a simplified approach - in production, you might want to get more precise error counts
    const errorQuery = {
      bool: {
        must: [
          {
            range: {
              [config.telemetry.fields.timestamp]: {
                gte: timeRange.from,
                lte: timeRange.to
              }
            }
          },
          {
            exists: { 
              field: "ParentSpanId.keyword" 
            }
          },
          {
            bool: {
              should: [
                { term: { "Status.Code": 2 } },
                { term: { "status.code": 2 } },
                { term: { "error": true } }
              ]
            }
          }
        ]
      }
    };
    
    afterKey = null;
    
    do {
      const errorResult: any = await this.query(tracesIndex, errorQuery, {
        size: 0,
        aggregations: {
          error_spans: {
            composite: {
              size: 10000,
              sources: [
                { trace_id: { terms: { field: "TraceId.keyword" } } },
                { span_id: { terms: { field: "SpanId.keyword" } } },
                { parent_id: { terms: { field: "ParentSpanId.keyword" } } }
              ],
              ...(afterKey ? { after: afterKey } : {})
            }
          }
        }
      });
      
      const buckets = errorResult.aggregations?.error_spans?.buckets || [];
      afterKey = errorResult.aggregations?.error_spans?.after_key;
      
      for (const bucket of buckets) {
        const traceId = bucket.key.trace_id;
        const spanId = bucket.key.span_id;
        const parentSpanId = bucket.key.parent_id;
        
        const childService = spanServiceMap.get(`${traceId}:${spanId}`);
        const parentService = spanServiceMap.get(`${traceId}:${parentSpanId}`);
        
        if (childService && parentService && childService !== parentService) {
          const edgeId = `${parentService}->${childService}`;
          
          if (dependencies.has(edgeId)) {
            const dep = dependencies.get(edgeId);
            dep.errorCount++;
          }
        }
      }
      
    } while (afterKey);
    
    // Calculate latency statistics and prepare final results
    const dependencyArray = Array.from(dependencies.values()).map(dep => {
      // Calculate latency percentiles
      if (dep.durations.length > 0) {
        const sorted = dep.durations.sort((a: number, b: number) => a - b);
        const len = sorted.length;
        
        dep.latencyStats = {
          avg: dep.durations.reduce((sum: number, d: number) => sum + d, 0) / len,
          min: sorted[0],
          max: sorted[len - 1],
          p50: sorted[Math.floor(len * 0.5)],
          p95: sorted[Math.floor(len * 0.95)],
          p99: sorted[Math.floor(len * 0.99)]
        };
      }
      
      // Calculate error rate and success rate
      const errorRate = dep.callCount > 0 ? (dep.errorCount / dep.callCount) * 100 : 0;
      dep.errorRate = errorRate;
      dep.successRate = 100 - errorRate;
      
      // Calculate throughput (calls per minute)
      const durationMs = new Date(timeRange.to).getTime() - new Date(timeRange.from).getTime();
      const durationMinutes = durationMs / (1000 * 60);
      dep.throughput = durationMinutes > 0 ? dep.callCount / durationMinutes : 0;
      
      // Clean up durations array to save memory
      delete dep.durations;
      
      // Add visualization hints
      dep.visualization = {
        edgeWidth: Math.min(1 + Math.log10(dep.callCount + 1) * 2, 10),
        edgeColor: errorRate > 10 ? '#ff4444' : errorRate > 5 ? '#ff9800' : '#4caf50',
        animated: errorRate > 20,
        dashArray: errorRate > 50 ? '5,5' : undefined,
        label: `${dep.callCount} calls\n${errorRate.toFixed(1)}% errors\n${dep.latencyStats.avg.toFixed(0)}ms avg`
      };
      
      return dep;
    });
    
    // Calculate service-level metrics
    const serviceMetrics = new Map<string, any>();
    dependencyArray.forEach(dep => {
      // Source service metrics
      if (!serviceMetrics.has(dep.source)) {
        serviceMetrics.set(dep.source, {
          name: dep.source,
          outgoingCalls: 0,
          incomingCalls: 0,
          avgOutgoingLatency: 0,
          avgIncomingLatency: 0,
          errorRate: 0,
          dependencies: [],
          dependents: []
        });
      }
      const sourceMetrics = serviceMetrics.get(dep.source);
      sourceMetrics.outgoingCalls += dep.callCount;
      sourceMetrics.dependencies.push(dep.target);
      sourceMetrics.avgOutgoingLatency = 
        (sourceMetrics.avgOutgoingLatency * (sourceMetrics.dependencies.length - 1) + dep.latencyStats.avg) / 
        sourceMetrics.dependencies.length;
      
      // Target service metrics
      if (!serviceMetrics.has(dep.target)) {
        serviceMetrics.set(dep.target, {
          name: dep.target,
          outgoingCalls: 0,
          incomingCalls: 0,
          avgOutgoingLatency: 0,
          avgIncomingLatency: 0,
          errorRate: 0,
          dependencies: [],
          dependents: []
        });
      }
      const targetMetrics = serviceMetrics.get(dep.target);
      targetMetrics.incomingCalls += dep.callCount;
      targetMetrics.dependents.push(dep.source);
      targetMetrics.avgIncomingLatency = 
        (targetMetrics.avgIncomingLatency * (targetMetrics.dependents.length - 1) + dep.latencyStats.avg) / 
        targetMetrics.dependents.length;
    });
    
    // Add node visualization hints
    const serviceArray = Array.from(serviceMetrics.values()).map(service => {
      const totalCalls = service.incomingCalls + service.outgoingCalls;
      const avgLatency = (service.avgIncomingLatency + service.avgOutgoingLatency) / 2;
      
      return {
        ...service,
        visualization: {
          nodeSize: 20 + Math.min(Math.log10(totalCalls + 1) * 10, 50),
          nodeColor: avgLatency > 1000 ? '#ff4444' : avgLatency > 500 ? '#ff9800' : '#4caf50',
          nodeLabel: `${service.name}\n${totalCalls} calls\n${avgLatency.toFixed(0)}ms avg`,
          isHub: service.dependencies.length > 5 || service.dependents.length > 5,
          isCritical: service.dependents.length > 3 && avgLatency > 500
        }
      };
    });
    
    logger.info('[OpenSearch Adapter] Successfully analyzed service dependencies with enhanced metrics', {
      spansProcessed: totalSpans,
      relationshipsProcessed: totalRelationships,
      dependenciesFound: dependencyArray.length,
      servicesFound: serviceArray.length,
      criticalServices: serviceArray.filter(s => s.visualization.isCritical).map(s => s.name)
    });
    
    return {
      dependencies: dependencyArray,
      services: serviceArray,
      timeRange,
      metadata: {
        totalSpans,
        totalRelationships,
        avgCallsPerDependency: dependencyArray.length > 0 ? 
          dependencyArray.reduce((sum, d) => sum + d.callCount, 0) / dependencyArray.length : 0,
        avgErrorRate: dependencyArray.length > 0 ?
          dependencyArray.reduce((sum, d) => sum + d.errorRate, 0) / dependencyArray.length : 0,
        topBottlenecks: dependencyArray
          .sort((a, b) => b.latencyStats.p95 - a.latencyStats.p95)
          .slice(0, 5)
          .map(d => ({ 
            path: `${d.source} → ${d.target}`, 
            p95Latency: d.latencyStats.p95,
            callCount: d.callCount 
          }))
      }
    };
  }
}

// Re-export for backward compatibility
export { OpenSearchAdapterOptions, OpenSearchCore } from './core/core.js';
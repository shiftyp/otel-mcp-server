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
    }).catch(err => {
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
      
      if (!search || fullPath.includes(search)) {
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
          'duration': this.calculateAverageDuration(cluster.values)
        },
        samples: cluster.values ? cluster.values.slice(0, 10).map((value: any) => ({
          id: value.traceId || value.id,
          trace_id: value.traceId || value.id,
          'span.name': value.spanName || value.operation || 'unknown',
          'service.name': value.serviceName || value.service || 'unknown',
          duration: value.duration || 0,
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
    
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
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
        avg: result.aggregations?.latency_stats?.avg || 0,
        min: result.aggregations?.latency_stats?.min || 0,
        max: result.aggregations?.latency_stats?.max || 0,
        p50: result.aggregations?.latency_percentiles?.values?.['50.0'] || 0,
        p95: result.aggregations?.latency_percentiles?.values?.['95.0'] || 0,
        p99: result.aggregations?.latency_percentiles?.values?.['99.0'] || 0
      },
      topOperations: (result.aggregations?.top_operations?.buckets || []).map((bucket: any) => ({
        operation: bucket.key,
        count: bucket.doc_count,
        avgDuration: bucket.avg_duration?.value || 0,
        errorCount: bucket.error_count?.doc_count || 0
      })),
      timeRange
    };
  }
  
  /**
   * Override getServiceDependencies to return properly formatted data
   */
  public async getServiceDependencies(timeRange: { from: string; to: string }): Promise<any> {
    const config = ConfigLoader.get();
    const tracesIndex = this.core.getTracesIndex();
    
    logger.info('[OpenSearch Adapter] Getting service dependencies using span relationships', { timeRange });
    
    // Get spans to analyze parent-child relationships
    const spansResult = await this.query(tracesIndex, {
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
      size: 10000,
      sort: [{ [config.telemetry.fields.timestamp]: { order: 'desc' } }]
    });
    
    const spans = spansResult.hits?.hits || [];
    logger.info('[OpenSearch Adapter] Retrieved spans for dependency analysis', { count: spans.length });
    
    // Build a map of span_id to service name
    const spanToService = new Map<string, string>();
    const traceSpans = new Map<string, any[]>();
    
    // First pass: map spans to services and group by trace
    for (const hit of spans) {
      const span = hit._source;
      
      // Handle different field naming conventions
      const spanId = span.span_id || span.SpanId || span.spanId;
      const traceId = span.trace_id || span.TraceId || span.traceId;
      const serviceName = span.service?.name || 
                         span.resource?.service?.name || 
                         span.Attributes?.['service.name'] || 
                         span.resource?.attributes?.['service.name'] ||
                         'unknown';
      
      if (spanId) {
        spanToService.set(spanId, serviceName);
      }
      
      if (traceId) {
        if (!traceSpans.has(traceId)) {
          traceSpans.set(traceId, []);
        }
        traceSpans.get(traceId)!.push({
          spanId,
          parentSpanId: span.parent_span_id || span.ParentSpanId || span.parentSpanId,
          serviceName,
          isError: span.status?.code === 2 || span.Status?.Code === 2
        });
      }
    }
    
    // Second pass: analyze dependencies within each trace
    const dependencies = new Map<string, any>();
    
    for (const [, traceSpanList] of traceSpans) {
      for (const span of traceSpanList) {
        if (span.parentSpanId) {
          // Find parent span in the same trace
          const parentSpan = traceSpanList.find(s => s.spanId === span.parentSpanId);
          
          if (parentSpan && parentSpan.serviceName !== span.serviceName) {
            const depKey = `${parentSpan.serviceName}->${span.serviceName}`;
            
            if (!dependencies.has(depKey)) {
              dependencies.set(depKey, {
                source: parentSpan.serviceName,
                target: span.serviceName,
                callCount: 0,
                errorCount: 0
              });
            }
            
            const dep = dependencies.get(depKey);
            dep.callCount++;
            if (span.isError) {
              dep.errorCount++;
            }
          }
        }
      }
    }
    
    // Convert to array and calculate error rates
    const dependencyArray = Array.from(dependencies.values()).map(dep => ({
      ...dep,
      errorRate: dep.callCount > 0 ? (dep.errorCount / dep.callCount) * 100 : 0
    }));
    
    logger.info('[OpenSearch Adapter] Analyzed service dependencies', {
      totalSpans: spans.length,
      totalTraces: traceSpans.size,
      dependenciesFound: dependencyArray.length
    });
    
    return { dependencies: dependencyArray, timeRange };
  }
}

// Re-export for backward compatibility
export { OpenSearchAdapterOptions, OpenSearchCore } from './core/core.js';
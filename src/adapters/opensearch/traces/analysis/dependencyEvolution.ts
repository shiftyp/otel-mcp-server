import { logger } from '../../../../utils/logger.js';
import { OpenSearchCore } from '../../core/core.js';
import { SearchEngineType } from '../../../base/searchAdapter.js';
import { generateEmbeddings, generateEmbedding, EmbeddingOptions } from '../../ml/embeddings.js';
import { extractTextContent, TextExtractionOptions, createTextExtractor } from '../../ml/textExtraction.js';
import { generateEmbeddingsWithProvider, generateEmbeddingWithProvider, EmbeddingProviderConfig, getDefaultEmbeddingConfig } from '../../ml/embeddingProvider.js';
import { createIntelligentSamplingQuery } from '../../ml/sampling.js';
/**
 * Interface for service dependency relationship
 */
interface ServiceDependency {
  parent: string;
  child: string;
  count: number;
  errorCount?: number;
  errorRate?: number;
}

/**
 * Interface for dependency change
 */
interface DependencyChange {
  type: 'new' | 'removed' | 'traffic_change' | 'error_rate_change';
  parent: string;
  child: string;
  previousMetrics?: {
    count: number;
    errorCount?: number;
    errorRate?: number;
  };
  currentMetrics?: {
    count: number;
    errorCount?: number;
    errorRate?: number;
  };
  changeMetrics: {
    countDiff: number;
    countPercentChange: number;
    errorCountDiff?: number;
    errorRateChange?: number;
  };
  severity: 'high' | 'medium' | 'low';
}

/**
 * Service Dependency Evolution Analysis using ML capabilities
 * Supports both OpenSearch and Elasticsearch with different implementations
 */
export class DependencyEvolutionAnalysis extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }
  
  /**
   * Query logs with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async queryLogs(query: any): Promise<any> {
    logger.info('[OpenSearch DependencyEvolutionAnalysis] queryLogs called but not implemented in this adapter');
    throw new Error('queryLogs not implemented in DependencyEvolutionAnalysis');
  }
  
  /**
   * List available log fields (required by OpenSearchCore)
   * @param includeSourceDoc Whether to include source document fields
   */
  public async listLogFields(prefix?: string): Promise<string[]> {
    logger.info('[OpenSearch DependencyEvolutionAnalysis] listLogFields called but not implemented in this adapter');
    throw new Error('listLogFields not implemented in DependencyEvolutionAnalysis');
  }
  
  /**
   * Query metrics with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async searchMetrics(query: any): Promise<any> {
    logger.info('[OpenSearch DependencyEvolutionAnalysis] searchMetrics called but not implemented in this adapter');
    throw new Error('searchMetrics not implemented in DependencyEvolutionAnalysis');
  }
  
  /**
   * Query traces with custom query (required by OpenSearchCore)
   * @param query The query object
   */
  public async queryTraces(query: any): Promise<any> {
    logger.info('[OpenSearch DependencyEvolutionAnalysis] queryTraces called but not implemented in this adapter');
    throw new Error('queryTraces not implemented in DependencyEvolutionAnalysis');
  }

  /**
   * Analyze dependency evolution between two time windows
   */
  public async analyzeDependencyEvolution(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string,
    options: {
      service?: string;
      queryString?: string;
      minCallCount?: number;
      significantChangeThreshold?: number;
      errorRateChangeThreshold?: number;
      engineType?: string;
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      embeddingProviderConfig?: EmbeddingProviderConfig;
    } = {}
  ): Promise<any> {
    // Set default values for options
    const defaultOptions = {
      minCallCount: 10,
      significantChangeThreshold: 0.25,
      errorRateChangeThreshold: 0.05,
      engineType: SearchEngineType.OPENSEARCH,
      useEmbeddings: true,
      embeddingBatchSize: 5,
      similarityThreshold: 0.7
    };
    
    // Merge with provided options
    options = { ...defaultOptions, ...options };
    logger.info('[DependencyEvolutionAnalysis] Analyzing dependency evolution', { 
      startTime1, 
      endTime1, 
      startTime2, 
      endTime2, 
      options
    });
    
    try {
      // Choose implementation based on engine type
      if (options.engineType === SearchEngineType.OPENSEARCH) {
        return this.analyzeDependencyEvolutionWithOpenSearch(
          startTime1, endTime1, startTime2, endTime2, {
            service: options.service,
            queryString: options.queryString,
            minCallCount: options.minCallCount,
            significantChangeThreshold: options.significantChangeThreshold,
            errorRateChangeThreshold: options.errorRateChangeThreshold,
            useEmbeddings: options.useEmbeddings,
            embeddingBatchSize: options.embeddingBatchSize,
            similarityThreshold: options.similarityThreshold,
            embeddingProviderConfig: options.embeddingProviderConfig
          }
        );
      } else {
        return this.analyzeDependencyEvolutionWithElasticsearch(
          startTime1, endTime1, startTime2, endTime2, {
            service: options.service,
            queryString: options.queryString,
            minCallCount: options.minCallCount,
            significantChangeThreshold: options.significantChangeThreshold,
            errorRateChangeThreshold: options.errorRateChangeThreshold,
            useEmbeddings: options.useEmbeddings,
            embeddingBatchSize: options.embeddingBatchSize,
            similarityThreshold: options.similarityThreshold,
            embeddingProviderConfig: options.embeddingProviderConfig
          }
        );
      }
    } catch (error: any) {
      logger.error('[DependencyEvolutionAnalysis] Error analyzing dependency evolution', { error });
      return { 
        changes: [], 
        error: error.message || String(error),
        message: 'Failed to analyze dependency evolution'
      };
    }
  }
  
  /**
   * Analyze dependency evolution using OpenSearch
   */
  private async analyzeDependencyEvolutionWithOpenSearch(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string,
    options: {
      service?: string;
      queryString?: string;
      minCallCount?: number;
      significantChangeThreshold?: number;
      errorRateChangeThreshold?: number;
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      embeddingProviderConfig?: EmbeddingProviderConfig;
    }
  ): Promise<any> {
    // Set default values
    const minCallCount = options.minCallCount ?? 10;
    const significantChangeThreshold = options.significantChangeThreshold ?? 0.25;
    const errorRateChangeThreshold = options.errorRateChangeThreshold ?? 0.05;
    // Get dependencies for both time windows
    const [dependencies1, dependencies2] = await Promise.all([
      this.getServiceDependencies(startTime1, endTime1, options.service, options.queryString),
      this.getServiceDependencies(startTime2, endTime2, options.service, options.queryString)
    ]);
    
    // Filter out low-traffic dependencies
    const filteredDeps1 = dependencies1.filter(dep => dep.count >= minCallCount);
    const filteredDeps2 = dependencies2.filter(dep => dep.count >= minCallCount);
    
    // Create maps for easier lookup
    const depMap1 = new Map<string, ServiceDependency>();
    const depMap2 = new Map<string, ServiceDependency>();
    
    for (const dep of filteredDeps1) {
      depMap1.set(`${dep.parent}:${dep.child}`, dep);
    }
    
    for (const dep of filteredDeps2) {
      depMap2.set(`${dep.parent}:${dep.child}`, dep);
    }
    
    // Identify changes
    const changes: DependencyChange[] = [];
    
    // Find new dependencies (in period 2 but not in period 1)
    for (const [key, dep2] of depMap2.entries()) {
      if (!depMap1.has(key)) {
        changes.push({
          type: 'new',
          parent: dep2.parent,
          child: dep2.child,
          currentMetrics: {
            count: dep2.count,
            errorCount: dep2.errorCount,
            errorRate: dep2.errorRate
          },
          changeMetrics: {
            countDiff: dep2.count,
            countPercentChange: 100, // 100% increase (from 0)
            errorCountDiff: dep2.errorCount,
            errorRateChange: dep2.errorRate
          },
          severity: this.calculateSeverity('new', undefined, dep2)
        });
      }
    }
    
    // Find removed dependencies (in period 1 but not in period 2)
    for (const [key, dep1] of depMap1.entries()) {
      if (!depMap2.has(key)) {
        changes.push({
          type: 'removed',
          parent: dep1.parent,
          child: dep1.child,
          previousMetrics: {
            count: dep1.count,
            errorCount: dep1.errorCount,
            errorRate: dep1.errorRate
          },
          changeMetrics: {
            countDiff: -dep1.count,
            countPercentChange: -100, // 100% decrease (to 0)
            errorCountDiff: dep1.errorCount ? -dep1.errorCount : undefined,
            errorRateChange: dep1.errorRate ? -dep1.errorRate : undefined
          },
          severity: this.calculateSeverity('removed', dep1, undefined)
        });
      }
    }
    
    // Find changes in existing dependencies
    for (const [key, dep1] of depMap1.entries()) {
      if (depMap2.has(key)) {
        const dep2 = depMap2.get(key)!;
        
        // Calculate changes
        const countDiff = dep2.count - dep1.count;
        const countPercentChange = dep1.count > 0 
          ? (countDiff / dep1.count) * 100 
          : 100;
          
        const errorCountDiff = (dep2.errorCount || 0) - (dep1.errorCount || 0);
        const errorRateChange = (dep2.errorRate || 0) - (dep1.errorRate || 0);
        
        // Check if the change is significant
        const isTrafficChangeSignificant = Math.abs(countPercentChange) >= significantChangeThreshold * 100;
        const isErrorRateChangeSignificant = Math.abs(errorRateChange) >= errorRateChangeThreshold;
        
        if (isTrafficChangeSignificant) {
          changes.push({
            type: 'traffic_change',
            parent: dep1.parent,
            child: dep1.child,
            previousMetrics: {
              count: dep1.count,
              errorCount: dep1.errorCount,
              errorRate: dep1.errorRate
            },
            currentMetrics: {
              count: dep2.count,
              errorCount: dep2.errorCount,
              errorRate: dep2.errorRate
            },
            changeMetrics: {
              countDiff,
              countPercentChange,
              errorCountDiff,
              errorRateChange
            },
            severity: this.calculateSeverity('traffic_change', dep1, dep2)
          });
        }
        
        if (isErrorRateChangeSignificant && !isTrafficChangeSignificant) {
          changes.push({
            type: 'error_rate_change',
            parent: dep1.parent,
            child: dep1.child,
            previousMetrics: {
              count: dep1.count,
              errorCount: dep1.errorCount,
              errorRate: dep1.errorRate
            },
            currentMetrics: {
              count: dep2.count,
              errorCount: dep2.errorCount,
              errorRate: dep2.errorRate
            },
            changeMetrics: {
              countDiff,
              countPercentChange,
              errorCountDiff,
              errorRateChange
            },
            severity: this.calculateSeverity('error_rate_change', dep1, dep2)
          });
        }
      }
    }
    
    // Sort changes by severity and then by absolute count difference
    changes.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return Math.abs(b.changeMetrics.countDiff) - Math.abs(a.changeMetrics.countDiff);
    });
    
    // Use ML to detect anomalous changes
    const anomalousChanges = await this.detectAnomalousChanges(changes, {
      useEmbeddings: options.useEmbeddings,
      embeddingBatchSize: options.embeddingBatchSize,
      similarityThreshold: options.similarityThreshold,
      embeddingProviderConfig: options.embeddingProviderConfig
    });
    
    return {
      timeWindow1: {
        startTime: startTime1,
        endTime: endTime1,
        dependencyCount: filteredDeps1.length,
        totalCalls: filteredDeps1.reduce((sum, dep) => sum + dep.count, 0)
      },
      timeWindow2: {
        startTime: startTime2,
        endTime: endTime2,
        dependencyCount: filteredDeps2.length,
        totalCalls: filteredDeps2.reduce((sum, dep) => sum + dep.count, 0)
      },
      changes,
      anomalousChanges,
      summary: {
        totalChanges: changes.length,
        newDependencies: changes.filter(c => c.type === 'new').length,
        removedDependencies: changes.filter(c => c.type === 'removed').length,
        trafficChanges: changes.filter(c => c.type === 'traffic_change').length,
        errorRateChanges: changes.filter(c => c.type === 'error_rate_change').length,
        highSeverityChanges: changes.filter(c => c.severity === 'high').length,
        mediumSeverityChanges: changes.filter(c => c.severity === 'medium').length,
        lowSeverityChanges: changes.filter(c => c.severity === 'low').length
      },
      message: changes.length > 0 
        ? `Found ${changes.length} significant changes in service dependencies` 
        : 'No significant changes in service dependencies detected'
    };
  }
  
  /**
   * Analyze dependency evolution using Elasticsearch
   */
  private async analyzeDependencyEvolutionWithElasticsearch(
    startTime1: string,
    endTime1: string,
    startTime2: string,
    endTime2: string,
    options: {
      service?: string;
      queryString?: string;
      minCallCount?: number;
      significantChangeThreshold?: number;
      errorRateChangeThreshold?: number;
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      embeddingProviderConfig?: EmbeddingProviderConfig;
    }
  ): Promise<any> {
    // Set default values
    const minCallCount = options.minCallCount ?? 10;
    const significantChangeThreshold = options.significantChangeThreshold ?? 0.25;
    const errorRateChangeThreshold = options.errorRateChangeThreshold ?? 0.05;
    // Elasticsearch implementation uses different endpoints and parameters
    // This is a placeholder for the actual implementation
    logger.info('[DependencyEvolutionAnalysis] Using Elasticsearch implementation');
    
    // For now, we'll use the OpenSearch implementation as a fallback
    // In a real implementation, we would use Elasticsearch's APIs
    return this.analyzeDependencyEvolutionWithOpenSearch(
      startTime1, endTime1, startTime2, endTime2, options
    );
  }
  
  /**
   * Get service dependencies for a time window
   */
  private async getServiceDependencies(
    startTime: string,
    endTime: string,
    service?: string,
    queryString?: string
  ): Promise<ServiceDependency[]> {
    const indexPattern = 'traces-*';
    
    // Build the query filters
    const filters: any[] = [
      {
        range: {
          "@timestamp": {
            gte: startTime,
            lte: endTime
          }
        }
      }
    ];
    
    // Add service filter if specified
    if (service) {
      // Support wildcard patterns in service names
      if (service.includes('*')) {
        filters.push({
          wildcard: {
            'resource.attributes.service.name': service
          }
        });
      } else {
        filters.push({
          term: {
            'resource.attributes.service.name': service
          }
        });
      }
    }
    
    // Add query string filter if specified
    if (queryString) {
      filters.push({
        query_string: {
          query: queryString,
          analyze_wildcard: true,
          default_field: '*'
        }
      });
    }
    
    // Apply intelligent sampling based on trace status
    let intelligentSamplingQuery: any = {};
    try {
      // Create intelligent sampling query
      intelligentSamplingQuery = createIntelligentSamplingQuery({
        useIntelligentSampling: true,
        dataType: 'traces',
        context: {
          source: 'DependencyEvolutionAnalysis',
          operation: 'get_dependencies'
        }
      });
      
      logger.info('[DependencyEvolutionAnalysis] Created intelligent sampling query', {
        hasIntelligentSampling: !!intelligentSamplingQuery.function_score
      });
    } catch (error) {
      logger.warn('[DependencyEvolutionAnalysis] Error creating intelligent sampling query', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Build the base query
    let baseQuery: any = {
      bool: {
        filter: filters
      }
    };
    
    // Apply intelligent sampling to the query if available
    if (intelligentSamplingQuery.function_score) {
      logger.info('[DependencyEvolutionAnalysis] Applying intelligent sampling to query');
      
      // Combine the original query with intelligent sampling
      baseQuery = {
        bool: {
          must: [baseQuery],
          filter: [intelligentSamplingQuery]
        }
      };
    }
    
    // OpenSearch query to find spans within the time range
    const query = {
      query: baseQuery,
      size: 0, // We only need aggregations
      aggs: {
        service_relationships: {
          composite: {
            size: 10000,
            sources: [
              {
                parent_service: {
                  terms: {
                    field: "resource.attributes.service.name.keyword"
                  }
                }
              },
              {
                child_service: {
                  terms: {
                    field: "resource.attributes.service.name.keyword"
                  }
                }
              }
            ]
          },
          aggs: {
            error_count: {
              filter: {
                term: {
                  "status.code": 2 // Error status in OpenTelemetry
                }
              }
            }
          }
        }
      }
    };
    
    const response = await this.callRequest('POST', `/${indexPattern}/_search`, query);
    
    // Extract relationships from the aggregation results
    const relationships: ServiceDependency[] = [];
    
    if (response.aggregations && response.aggregations.service_relationships) {
      const buckets = response.aggregations.service_relationships.buckets || [];
      
      for (const bucket of buckets) {
        const parent = bucket.key.parent_service;
        const child = bucket.key.child_service;
        
        // Skip self-relationships
        if (parent === child) continue;
        
        const count = bucket.doc_count;
        const errorCount = bucket.error_count.doc_count;
        const errorRate = count > 0 ? errorCount / count : 0;
        
        relationships.push({
          parent,
          child,
          count,
          errorCount,
          errorRate
        });
      }
    }
    
    return relationships;
  }
  
  /**
   * Calculate severity of a dependency change
   */
  private calculateSeverity(
    changeType: 'new' | 'removed' | 'traffic_change' | 'error_rate_change',
    prevDep?: ServiceDependency,
    currDep?: ServiceDependency
  ): 'high' | 'medium' | 'low' {
    if (changeType === 'new') {
      // New dependencies with errors are high severity
      if (currDep && currDep.errorRate && currDep.errorRate > 0.1) {
        return 'high';
      }
      // New dependencies with high traffic are medium severity
      if (currDep && currDep.count > 100) {
        return 'medium';
      }
      // Other new dependencies are low severity
      return 'low';
    }
    
    if (changeType === 'removed') {
      // Removed dependencies with high traffic are high severity
      if (prevDep && prevDep.count > 1000) {
        return 'high';
      }
      // Removed dependencies with medium traffic are medium severity
      if (prevDep && prevDep.count > 100) {
        return 'medium';
      }
      // Other removed dependencies are low severity
      return 'low';
    }
    
    if (changeType === 'traffic_change') {
      if (!prevDep || !currDep) return 'low';
      
      const countDiff = currDep.count - prevDep.count;
      const countPercentChange = prevDep.count > 0 
        ? (countDiff / prevDep.count) * 100 
        : 100;
      
      // Large traffic increases or decreases are high severity
      if (Math.abs(countPercentChange) > 100 && Math.abs(countDiff) > 1000) {
        return 'high';
      }
      // Medium traffic changes are medium severity
      if (Math.abs(countPercentChange) > 50 && Math.abs(countDiff) > 100) {
        return 'medium';
      }
      // Other traffic changes are low severity
      return 'low';
    }
    
    if (changeType === 'error_rate_change') {
      if (!prevDep || !currDep) return 'low';
      
      const errorRateChange = (currDep.errorRate || 0) - (prevDep.errorRate || 0);
      
      // Large error rate increases are high severity
      if (errorRateChange > 0.1) {
        return 'high';
      }
      // Medium error rate changes are medium severity
      if (Math.abs(errorRateChange) > 0.05) {
        return 'medium';
      }
      // Other error rate changes are low severity
      return 'low';
    }
    
    return 'low';
  }
  
  /**
   * Use ML to detect anomalous changes in dependencies
   * @param changes List of dependency changes to analyze
   * @param options Optional parameters for embedding generation
   */
  private async detectAnomalousChanges(
    changes: DependencyChange[], 
    options: {
      useEmbeddings?: boolean;
      embeddingBatchSize?: number;
      similarityThreshold?: number;
      embeddingProviderConfig?: EmbeddingProviderConfig;
    } = {}
  ): Promise<DependencyChange[]> {
    try {
      // Skip if no changes to analyze
      if (changes.length === 0) {
        return [];
      }

      // Default options
      const useEmbeddings = options.useEmbeddings !== undefined ? options.useEmbeddings : true;
      const embeddingBatchSize = options.embeddingBatchSize || 5;
      const similarityThreshold = options.similarityThreshold || 0.7;
      
      // If embeddings are enabled, use embedding-based anomaly detection
      if (useEmbeddings) {
        return this.detectAnomalousChangesWithEmbeddings(
          changes, 
          embeddingBatchSize, 
          similarityThreshold,
          options.embeddingProviderConfig
        );
      }
      
      // Otherwise, use the original feature vector approach
      // Extract features for ML analysis
      const featureVectors: number[][] = [];
      
      for (const change of changes) {
        const vector = [
          change.type === 'new' ? 1 : 0,
          change.type === 'removed' ? 1 : 0,
          change.type === 'traffic_change' ? 1 : 0,
          change.type === 'error_rate_change' ? 1 : 0,
          change.changeMetrics.countDiff,
          change.changeMetrics.countPercentChange,
          change.changeMetrics.errorCountDiff || 0,
          change.changeMetrics.errorRateChange || 0
        ];
        
        featureVectors.push(vector);
      }
      
      // Use OpenSearch's Random Cut Forest for anomaly detection
      const rcfEndpoint = '/_plugins/_ml/rcf';
      const rcfRequest = {
        rcf_size: 30,
        sample_size: Math.min(256, Math.max(50, Math.floor(featureVectors.length * 0.1))),
        time_decay: 0.1,
        anomaly_score_threshold: 0.7,
        data_points: featureVectors
      };
      
      const rcfResponse = await this.callRequest('POST', rcfEndpoint, rcfRequest);
      
      // Process the results
      const anomalousChanges: DependencyChange[] = [];
      
      if (rcfResponse.results) {
        for (let i = 0; i < rcfResponse.results.length; i++) {
          const result = rcfResponse.results[i];
          
          if (result.anomaly_score && result.anomaly_score >= 0.7) {
            anomalousChanges.push(changes[i]);
          }
        }
      }
      
      return anomalousChanges;
    } catch (error) {
      logger.error('[DependencyEvolutionAnalysis] Error detecting anomalous changes', { error });
      return [];
    }
  }

  /**
   * Detect anomalous changes using embeddings for better semantic understanding
   * This method generates embeddings on-the-fly for each dependency change
   * and uses cosine similarity to identify anomalous changes
   */
  private async detectAnomalousChangesWithEmbeddings(
    changes: DependencyChange[],
    batchSize: number = 5,
    similarityThreshold: number = 0.7,
    embeddingProviderConfig?: EmbeddingProviderConfig
  ): Promise<DependencyChange[]> {
    try {
      logger.info('[DependencyEvolutionAnalysis] Using embeddings for anomaly detection', {
        changeCount: changes.length,
        batchSize,
        similarityThreshold
      });

      // Define text extraction options for dependency changes
      const dependencyTextExtractionOptions: TextExtractionOptions = {
        textFields: ['parent', 'child', 'type', 'severity'],
        dimensionFields: ['previousMetrics', 'currentMetrics', 'changeMetrics'],
        valueFields: []
      };
      
      // Create text extractor function for dependency changes
      const dependencyTextExtractor = createTextExtractor(dependencyTextExtractionOptions);
      
      // Create rich text representations of the dependency changes
      // First try using the centralized text extraction utility for consistent representation
      const changeTexts = changes.map(change => {
        // First try with the centralized text extractor
        const extractedText = this.createRichTextRepresentation(change);
        
        // If we got meaningful text from the extraction, use it
        if (extractedText && extractedText.trim().length > 0) {
          return extractedText;
        }
        
        // Fall back to the original text representation if needed
        return this.createTextRepresentation(change);
      });
      
      // Generate embeddings for all changes using the embedding provider
      const embeddingResults = await generateEmbeddingsWithProvider<{change: DependencyChange, text: string}>(
        this,
        changes.map((change, i) => ({ change, text: changeTexts[i] })),
        item => item.text,
        { 
          batchSize,
          context: { 
            source: 'DependencyEvolutionAnalysis', 
            operation: 'anomaly_detection' 
          }
        },
        // Use the provided embedding provider configuration or the default
        embeddingProviderConfig || getDefaultEmbeddingConfig()
      );

      // If embedding generation failed, fall back to the original method
      if (!embeddingResults || embeddingResults.length === 0) {
        logger.warn('[DependencyEvolutionAnalysis] Embedding generation failed, falling back to feature vectors');
        return this.detectAnomalousChanges(changes, { 
          useEmbeddings: false,
          // Pass through the original embedding provider config in case it's needed for logging
          embeddingProviderConfig: embeddingProviderConfig
        });
      }

      // Calculate the centroid (average) embedding
      const embeddingDimension = embeddingResults[0].item.vector?.length || 0;
      if (embeddingDimension === 0) {
        logger.warn('[DependencyEvolutionAnalysis] Invalid embedding dimension, falling back to feature vectors');
        return this.detectAnomalousChanges(changes, { 
          useEmbeddings: false,
          embeddingProviderConfig: embeddingProviderConfig
        });
      }

      // Calculate centroid embedding
      const centroid = new Array(embeddingDimension).fill(0);
      let validEmbeddingCount = 0;

      for (const result of embeddingResults) {
        if (result.item.vector && result.item.vector.length === embeddingDimension) {
          for (let i = 0; i < embeddingDimension; i++) {
            centroid[i] += result.item.vector[i];
          }
          validEmbeddingCount++;
        }
      }

      // Normalize the centroid
      if (validEmbeddingCount > 0) {
        for (let i = 0; i < embeddingDimension; i++) {
          centroid[i] /= validEmbeddingCount;
        }
      }

      // Calculate cosine similarity between each embedding and the centroid
      const anomalousChanges: DependencyChange[] = [];

      for (const result of embeddingResults) {
        if (result.item.vector && result.item.vector.length === embeddingDimension) {
          const similarity = this.calculateCosineSimilarity(result.item.vector, centroid);
          
          // If similarity is below threshold, consider it anomalous
          if (similarity < similarityThreshold) {
            anomalousChanges.push(result.item.change);
          }
        }
      }

      logger.info('[DependencyEvolutionAnalysis] Embedding-based anomaly detection results', {
        totalChanges: changes.length,
        anomalousChanges: anomalousChanges.length
      });

      return anomalousChanges;
    } catch (error) {
      logger.error('[DependencyEvolutionAnalysis] Error in embedding-based anomaly detection', { error });
      // Fall back to the original method
      return this.detectAnomalousChanges(changes, { 
        useEmbeddings: false,
        embeddingProviderConfig: embeddingProviderConfig
      });
    }
  }

  /**
   * Create a rich text representation of a dependency change for embedding generation
   * using the centralized text extraction utility
   */
  private createRichTextRepresentation(change: DependencyChange): string {
    try {
      // Convert the change object to a format suitable for text extraction
      const changeObject = {
        type: change.type,
        parent: change.parent,
        child: change.child,
        severity: change.severity,
        previousMetrics: change.previousMetrics || {},
        currentMetrics: change.currentMetrics || {},
        changeMetrics: change.changeMetrics || {}
      };
      
      // Use the centralized text extraction utility
      const textExtractionOptions: TextExtractionOptions = {
        textFields: ['type', 'parent', 'child', 'severity'],
        dimensionFields: ['previousMetrics', 'currentMetrics', 'changeMetrics'],
        valueFields: []
      };
      
      // Extract text content using the centralized utility
      const extractedText = extractTextContent(changeObject, textExtractionOptions);
      
      // Add context to make the text more meaningful for embedding
      let richText = `Dependency change analysis: ${extractedText}`;
      
      // Add specific metrics based on change type for more context
      if (change.type === 'new') {
        richText += `. New dependency with ${change.currentMetrics?.count || 0} calls and error rate of ${((change.currentMetrics?.errorRate || 0) * 100).toFixed(2)}%`;
      } else if (change.type === 'removed') {
        richText += `. Removed dependency that had ${change.previousMetrics?.count || 0} calls and error rate of ${((change.previousMetrics?.errorRate || 0) * 100).toFixed(2)}%`;
      } else {
        richText += `. Traffic changed from ${change.previousMetrics?.count || 0} to ${change.currentMetrics?.count || 0} calls (${change.changeMetrics.countPercentChange.toFixed(2)}% change)`;
        richText += `. Error rate changed from ${((change.previousMetrics?.errorRate || 0) * 100).toFixed(2)}% to ${((change.currentMetrics?.errorRate || 0) * 100).toFixed(2)}%`;
      }
      
      return richText;
    } catch (error) {
      logger.warn('[DependencyEvolutionAnalysis] Error creating rich text representation', { error });
      // Fall back to the original text representation
      return this.createTextRepresentation(change);
    }
  }
  
  /**
   * Create a text representation of a dependency change for embedding generation
   * (Original implementation kept for backward compatibility)
   */
  private createTextRepresentation(change: DependencyChange): string {
    // Build a detailed text description of the change
    const parts = [
      `Change type: ${change.type}`,
      `Service relationship: ${change.parent} -> ${change.child}`,
      `Severity: ${change.severity}`
    ];

    // Add metrics based on change type
    if (change.type === 'new') {
      parts.push(
        `New dependency with ${change.currentMetrics?.count || 0} calls`,
        `Error rate: ${(change.currentMetrics?.errorRate || 0) * 100}%`
      );
    } else if (change.type === 'removed') {
      parts.push(
        `Removed dependency that had ${change.previousMetrics?.count || 0} calls`,
        `Previous error rate: ${(change.previousMetrics?.errorRate || 0) * 100}%`
      );
    } else {
      // For traffic or error rate changes
      parts.push(
        `Previous calls: ${change.previousMetrics?.count || 0}`,
        `Current calls: ${change.currentMetrics?.count || 0}`,
        `Call count change: ${change.changeMetrics.countDiff} (${change.changeMetrics.countPercentChange.toFixed(2)}%)`,
        `Previous error rate: ${((change.previousMetrics?.errorRate || 0) * 100).toFixed(2)}%`,
        `Current error rate: ${((change.currentMetrics?.errorRate || 0) * 100).toFixed(2)}%`,
        `Error rate change: ${((change.changeMetrics.errorRateChange || 0) * 100).toFixed(2)}%`
      );
    }

    return parts.join('. ');
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private calculateCosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

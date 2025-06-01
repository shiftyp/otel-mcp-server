import { LogCore } from './logCore.js';
import { logger } from '../../../../utils/logger.js';
import { createErrorResponse, ErrorResponse, isErrorResponse } from '../../../../utils/errorHandling.js';
import { createBoolQuery, createRangeQuery, createTermQuery } from '../../../../utils/queryBuilder.js';
import { ServiceResolver } from '../../../../utils/serviceResolver.js';

/**
 * Log analysis functionality for the OpenSearch Logs Adapter
 */
export class LogAnalysis extends LogCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Detect anomalies in logs
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param method Detection method (pattern or ngram)
   * @param minScore Minimum anomaly score (0-1)
   * @param maxResults Maximum number of results to return
   */
  public async detectLogAnomalies(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    method: 'pattern' | 'ngram' = 'pattern',
    minScore: number = 0.7,
    maxResults: number = 100
  ): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogAnalysis] detectLogAnomalies called', {
        startTime, endTime, service, level, method, minScore, maxResults
      });
      
      // Validate inputs
      if (minScore < 0 || minScore > 1) {
        return createErrorResponse('minScore must be between 0 and 1');
      }
      
      // Choose the appropriate detection method
      if (method === 'pattern') {
        return this.detectPatternAnomalies(startTime, endTime, service, level, minScore, maxResults);
      } else {
        return this.detectNgramAnomalies(startTime, endTime, service, level, minScore, maxResults);
      }
    } catch (error) {
      return createErrorResponse(`Error detecting log anomalies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Detect pattern-based anomalies in logs
   */
  private async detectPatternAnomalies(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    minScore: number = 0.7,
    maxResults: number = 100
  ): Promise<any | ErrorResponse> {
    try {
      // Build query to get logs
      const must = [];
      
      // Add time range
      must.push(createRangeQuery('@timestamp', startTime, endTime));
      
      // Add service filter if provided
      if (service) {
        const serviceQuery = ServiceResolver.createServiceQuery(service, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Add level filter if provided
      if (level) {
        must.push(createTermQuery('SeverityText', level));
      }
      
      // Build the query
      const query = {
        query: createBoolQuery({ must }),
        size: 1000, // Get a good sample size for anomaly detection
        sort: [{ '@timestamp': { order: 'asc' } }]
      };
      
      // Get logs
      const result = await this.searchLogs(query);
      
      if (isErrorResponse(result)) {
        return result;
      }
      
      if (!result.hits || !result.hits.hits || result.hits.hits.length === 0) {
        return { anomalies: [] };
      }
      
      // Extract log messages
      const logs = result.hits.hits.map((hit: any) => {
        const source = hit._source;
        return {
          id: hit._id,
          timestamp: source['@timestamp'],
          message: source.Body || source.body || source.message || '',
          service: source.Resource?.service?.name || source.service?.name || 'unknown',
          level: source.SeverityText || source.severityText || source.level || 'unknown'
        };
      });
      
      // Perform pattern-based anomaly detection
      const patterns = this.extractPatterns(logs);
      const anomalies = this.findPatternAnomalies(logs, patterns, minScore);
      
      // Sort anomalies by score and limit results
      anomalies.sort((a, b) => b.score - a.score);
      const limitedAnomalies = anomalies.slice(0, maxResults);
      
      return {
        anomalies: limitedAnomalies,
        total: anomalies.length,
        returned: limitedAnomalies.length,
        method: 'pattern'
      };
    } catch (error) {
      return createErrorResponse(`Error detecting pattern anomalies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Detect n-gram based anomalies in logs
   */
  private async detectNgramAnomalies(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    minScore: number = 0.7,
    maxResults: number = 100
  ): Promise<any | ErrorResponse> {
    try {
      // Implementation similar to pattern-based detection but using n-grams
      // This is a simplified version for the refactoring example
      
      // Build query to get logs (same as pattern-based)
      const must = [];
      must.push(createRangeQuery('@timestamp', startTime, endTime));
      
      if (service) {
        const serviceQuery = ServiceResolver.createServiceQuery(service, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      if (level) {
        must.push(createTermQuery('SeverityText', level));
      }
      
      const query = {
        query: createBoolQuery({ must }),
        size: 1000,
        sort: [{ '@timestamp': { order: 'asc' } }]
      };
      
      const result = await this.searchLogs(query);
      
      if (isErrorResponse(result)) {
        return result;
      }
      
      if (!result.hits || !result.hits.hits || result.hits.hits.length === 0) {
        return { anomalies: [] };
      }
      
      // Extract log messages
      const logs = result.hits.hits.map((hit: any) => {
        const source = hit._source;
        return {
          id: hit._id,
          timestamp: source['@timestamp'],
          message: source.Body || source.body || source.message || '',
          service: source.Resource?.service?.name || source.service?.name || 'unknown',
          level: source.SeverityText || source.severityText || source.level || 'unknown'
        };
      });
      
      // Perform n-gram based anomaly detection
      const ngrams = this.extractNgrams(logs);
      const anomalies = this.findNgramAnomalies(logs, ngrams, minScore);
      
      // Sort anomalies by score and limit results
      anomalies.sort((a, b) => b.score - a.score);
      const limitedAnomalies = anomalies.slice(0, maxResults);
      
      return {
        anomalies: limitedAnomalies,
        total: anomalies.length,
        returned: limitedAnomalies.length,
        method: 'ngram'
      };
    } catch (error) {
      return createErrorResponse(`Error detecting n-gram anomalies: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Extract patterns from log messages
   */
  private extractPatterns(logs: any[]): any[] {
    // Simplified pattern extraction for refactoring example
    const patterns: any[] = [];
    const patternMap = new Map<string, { count: number, pattern: string }>();
    
    // Process each log message
    logs.forEach(log => {
      if (!log.message) return;
      
      // Create a pattern by replacing variables with placeholders
      const pattern = log.message
        .replace(/\d+/g, '{NUMBER}')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
        .replace(/[0-9a-f]{24}/gi, '{ID}')
        .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '{IP}')
        .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '{EMAIL}');
      
      // Count pattern occurrences
      const existing = patternMap.get(pattern);
      if (existing) {
        existing.count++;
      } else {
        patternMap.set(pattern, { count: 1, pattern });
      }
    });
    
    // Convert map to array
    patternMap.forEach(value => {
      patterns.push({
        pattern: value.pattern,
        count: value.count,
        frequency: value.count / logs.length
      });
    });
    
    // Sort patterns by frequency (descending)
    patterns.sort((a, b) => b.frequency - a.frequency);
    
    return patterns;
  }
  
  /**
   * Find anomalies based on patterns
   */
  private findPatternAnomalies(logs: any[], patterns: any[], minScore: number): any[] {
    const anomalies: any[] = [];
    const commonPatterns = patterns.filter(p => p.frequency >= 0.01);
    
    // Check each log against common patterns
    logs.forEach(log => {
      if (!log.message) return;
      
      // Create a pattern for this log
      const logPattern = log.message
        .replace(/\d+/g, '{NUMBER}')
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
        .replace(/[0-9a-f]{24}/gi, '{ID}')
        .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, '{IP}')
        .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, '{EMAIL}');
      
      // Find the best matching pattern
      let bestMatch = null;
      let bestScore = 0;
      
      for (const pattern of commonPatterns) {
        const similarity = this.calculateSimilarity(logPattern, pattern.pattern);
        if (similarity > bestScore) {
          bestScore = similarity;
          bestMatch = pattern;
        }
      }
      
      // If no good match found, it's an anomaly
      if (bestScore < minScore) {
        anomalies.push({
          log,
          score: 1 - bestScore,
          reason: 'Unusual log pattern'
        });
      }
    });
    
    return anomalies;
  }
  
  /**
   * Extract n-grams from log messages
   */
  private extractNgrams(logs: any[]): any[] {
    // Simplified n-gram extraction for refactoring example
    const ngrams: any[] = [];
    const ngramMap = new Map<string, { count: number, ngram: string }>();
    const n = 3; // Use trigrams
    
    // Process each log message
    logs.forEach(log => {
      if (!log.message) return;
      
      // Tokenize message
      const tokens = log.message.split(/\s+/);
      
      // Extract n-grams
      for (let i = 0; i <= tokens.length - n; i++) {
        const ngram = tokens.slice(i, i + n).join(' ');
        
        // Count n-gram occurrences
        const existing = ngramMap.get(ngram);
        if (existing) {
          existing.count++;
        } else {
          ngramMap.set(ngram, { count: 1, ngram });
        }
      }
    });
    
    // Convert map to array
    ngramMap.forEach(value => {
      ngrams.push({
        ngram: value.ngram,
        count: value.count,
        frequency: value.count / logs.length
      });
    });
    
    // Sort n-grams by frequency (descending)
    ngrams.sort((a, b) => b.frequency - a.frequency);
    
    return ngrams;
  }
  
  /**
   * Find anomalies based on n-grams
   */
  private findNgramAnomalies(logs: any[], ngrams: any[], minScore: number): any[] {
    const anomalies: any[] = [];
    const commonNgrams = ngrams.filter(p => p.frequency >= 0.01);
    
    // Check each log against common n-grams
    logs.forEach(log => {
      if (!log.message) return;
      
      // Tokenize message
      const tokens = log.message.split(/\s+/);
      
      // Check if log contains any common n-grams
      let containsCommonNgram = false;
      for (let i = 0; i <= tokens.length - 3; i++) {
        const ngram = tokens.slice(i, i + 3).join(' ');
        if (commonNgrams.some(n => n.ngram === ngram)) {
          containsCommonNgram = true;
          break;
        }
      }
      
      // If no common n-grams found, it's an anomaly
      if (!containsCommonNgram) {
        anomalies.push({
          log,
          score: 1,
          reason: 'No common n-grams found'
        });
      }
    });
    
    return anomalies;
  }
  
  /**
   * Calculate similarity between two strings
   */
  private calculateSimilarity(str1: string, str2: string): number {
    // Simple Jaccard similarity for demonstration
    const set1 = new Set(str1.split(/\s+/));
    const set2 = new Set(str2.split(/\s+/));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
  
  /**
   * Cluster log messages to find patterns
   * @param startTime Start time in ISO format
   * @param endTime End time in ISO format
   * @param service Optional service filter
   * @param level Optional log level filter
   * @param clusterCount Number of clusters to create
   * @param method Clustering method (kmeans or dbscan)
   * @param maxSamples Maximum number of samples to process
   */
  public async clusterLogMessages(
    startTime: string,
    endTime: string,
    service?: string,
    level?: string,
    clusterCount: number = 5,
    method: 'kmeans' | 'dbscan' = 'kmeans',
    maxSamples: number = 1000
  ): Promise<any | ErrorResponse> {
    try {
      logger.info('[OpenSearch LogAnalysis] clusterLogMessages called', {
        startTime, endTime, service, level, clusterCount, method, maxSamples
      });
      
      // Build query to get logs
      const must = [];
      
      // Add time range
      must.push(createRangeQuery('@timestamp', startTime, endTime));
      
      // Add service filter if provided
      if (service) {
        const serviceQuery = ServiceResolver.createServiceQuery(service, 'LOGS');
        if (!isErrorResponse(serviceQuery)) {
          must.push(serviceQuery);
        }
      }
      
      // Add level filter if provided
      if (level) {
        must.push(createTermQuery('SeverityText', level));
      }
      
      // Build the query
      const query = {
        query: createBoolQuery({ must }),
        size: maxSamples,
        sort: [{ '@timestamp': { order: 'asc' } }]
      };
      
      // Get logs
      const result = await this.searchLogs(query);
      
      if (isErrorResponse(result)) {
        return result;
      }
      
      if (!result.hits || !result.hits.hits || result.hits.hits.length === 0) {
        return { clusters: [] };
      }
      
      // Extract log messages
      const logs = result.hits.hits.map((hit: any) => {
        const source = hit._source;
        return {
          id: hit._id,
          timestamp: source['@timestamp'],
          message: source.Body || source.body || source.message || '',
          service: source.Resource?.service?.name || source.service?.name || 'unknown',
          level: source.SeverityText || source.severityText || source.level || 'unknown'
        };
      });
      
      // Perform clustering based on method
      if (method === 'kmeans') {
        return this.performKMeansClustering(logs, clusterCount);
      } else {
        return this.performDBSCANClustering(logs);
      }
    } catch (error) {
      return createErrorResponse(`Error clustering log messages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Perform k-means clustering on log messages
   */
  private performKMeansClustering(logs: any[], clusterCount: number): any {
    // Simplified k-means clustering for refactoring example
    // In a real implementation, this would use a proper ML algorithm
    
    // Extract patterns as features
    const patterns = this.extractPatterns(logs);
    
    // Define cluster type
    interface LogCluster {
      id: number;
      size: number;
      logs: any[];
      pattern: string;
    }
    
    // Create random clusters for demonstration
    const clusters: LogCluster[] = [];
    for (let i = 0; i < clusterCount; i++) {
      clusters.push({
        id: i,
        size: 0,
        logs: [],
        pattern: ''
      });
    }
    
    // Assign logs to clusters randomly for demonstration
    logs.forEach((log, index) => {
      const clusterIndex = index % clusterCount;
      clusters[clusterIndex].logs.push(log);
      clusters[clusterIndex].size++;
    });
    
    // Assign most common pattern to each cluster
    clusters.forEach(cluster => {
      if (cluster.logs.length > 0) {
        const clusterPatterns = this.extractPatterns(cluster.logs);
        if (clusterPatterns.length > 0) {
          cluster.pattern = clusterPatterns[0].pattern;
        }
      }
    });
    
    return {
      clusters,
      method: 'kmeans',
      total_logs: logs.length
    };
  }
  
  /**
   * Perform DBSCAN clustering on log messages
   */
  private performDBSCANClustering(logs: any[]): any {
    // Simplified DBSCAN clustering for refactoring example
    // In a real implementation, this would use a proper ML algorithm
    
    // For demonstration, just create a single cluster
    const cluster = {
      id: 0,
      size: logs.length,
      logs: logs,
      pattern: ''
    };
    
    // Assign most common pattern to the cluster
    const patterns = this.extractPatterns(logs);
    if (patterns.length > 0) {
      cluster.pattern = patterns[0].pattern;
    }
    
    return {
      clusters: [cluster],
      method: 'dbscan',
      total_logs: logs.length
    };
  }
}

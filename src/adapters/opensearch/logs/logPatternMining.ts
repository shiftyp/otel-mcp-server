import { logger } from '../../../utils/logger.js';
import { LogsAdapterCore } from './logCore.js';

/**
 * Log Pattern Mining using OpenSearch's ML capabilities
 * Discovers patterns in log messages using clustering and text embeddings
 */
export class LogPatternMining {
  /**
   * Discover log patterns using k-means clustering on text embeddings
   * @param client The OpenSearch client to use for requests
   * @param logs Array of log messages to analyze
   * @param options Additional options for pattern mining
   */
  public static async discoverLogPatterns(
    client: LogsAdapterCore,
    logs: Array<{
      id: string;
      timestamp: string;
      message: string;
      service?: string;
      level?: string;
    }>,
    options: {
      clusterCount?: number;
      minClusterSize?: number;
      includeExamples?: boolean;
      maxExamplesPerCluster?: number;
    } = {}
  ): Promise<any> {
    logger.info('[LogPatternMining] Discovering log patterns', { 
      logCount: logs.length, 
      options 
    });
    
    try {
      // Default options
      const clusterCount = options.clusterCount || 10;
      const minClusterSize = options.minClusterSize || 3;
      const includeExamples = options.includeExamples !== undefined ? options.includeExamples : true;
      const maxExamplesPerCluster = options.maxExamplesPerCluster || 5;
      
      if (logs.length === 0) {
        return { 
          patterns: [], 
          message: 'No logs provided for pattern mining'
        };
      }
      
      // First, generate text embeddings for each log message
      const embeddingEndpoint = '/_plugins/_ml/nlp/text_embedding';
      
      // Process in batches to avoid overwhelming the API
      const batchSize = 50;
      const embeddings: number[][] = [];
      
      for (let i = 0; i < logs.length; i += batchSize) {
        const batch = logs.slice(i, i + batchSize);
        const batchRequests = batch.map(log => ({
          text: log.message,
          model_id: 'sentence-transformers/all-MiniLM-L6-v2' // Lightweight embedding model
        }));
        
        const batchResults = await Promise.all(
          batchRequests.map(req => client.request('POST', embeddingEndpoint, req))
        );
        
        for (const result of batchResults) {
          if (result.embedding_vector) {
            embeddings.push(result.embedding_vector);
          } else {
            // Use a zero vector as fallback
            embeddings.push(new Array(384).fill(0)); // Default embedding size for the model
          }
        }
      }
      
      // Use OpenSearch's ML plugin for k-means clustering
      const mlEndpoint = '/_plugins/_ml';
      const kmeansRequest = {
        algorithm: 'kmeans',
        parameters: {
          centroids: clusterCount,
          iterations: 10,
          distance_type: 'cosine'
        },
        input_data: {
          feature_vectors: embeddings
        }
      };
      
      const kmeansResponse = await client.request('POST', `${mlEndpoint}/execute_cluster`, kmeansRequest);
      
      if (!kmeansResponse.cluster_result || !kmeansResponse.cluster_result.cluster_indices) {
        return { 
          patterns: [], 
          error: 'Failed to get clustering results',
          message: 'OpenSearch ML plugin failed to cluster log patterns'
        };
      }
      
      // Process the clustering results
      const clusterIndices = kmeansResponse.cluster_result.cluster_indices;
      
      // Group logs by cluster
      const clusters: Record<number, Array<{
        id: string;
        timestamp: string;
        message: string;
        service?: string;
        level?: string;
      }>> = {};
      
      for (let i = 0; i < logs.length; i++) {
        if (i < clusterIndices.length) {
          const clusterIndex = clusterIndices[i];
          
          if (!clusters[clusterIndex]) {
            clusters[clusterIndex] = [];
          }
          
          clusters[clusterIndex].push(logs[i]);
        }
      }
      
      // Extract patterns from each cluster
      const patterns = [];
      
      for (const [clusterIndex, clusterLogs] of Object.entries(clusters)) {
        // Skip small clusters
        if (clusterLogs.length < minClusterSize) {
          continue;
        }
        
        // Extract common pattern using token alignment
        const pattern = this.extractCommonPattern(clusterLogs.map(log => log.message));
        
        // Count services and levels
        const serviceCounts: Record<string, number> = {};
        const levelCounts: Record<string, number> = {};
        
        for (const log of clusterLogs) {
          const service = log.service || 'unknown';
          const level = log.level || 'unknown';
          
          serviceCounts[service] = (serviceCounts[service] || 0) + 1;
          levelCounts[level] = (levelCounts[level] || 0) + 1;
        }
        
        // Sort by count (descending)
        const topServices = Object.entries(serviceCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([service, count]) => ({ service, count }));
          
        const topLevels = Object.entries(levelCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([level, count]) => ({ level, count }));
        
        const clusterResult: any = {
          clusterId: parseInt(clusterIndex),
          pattern,
          count: clusterLogs.length,
          services: topServices,
          levels: topLevels,
          firstSeen: clusterLogs[0].timestamp,
          lastSeen: clusterLogs[clusterLogs.length - 1].timestamp
        };
        
        // Include examples if requested
        if (includeExamples) {
          clusterResult.examples = clusterLogs
            .slice(0, maxExamplesPerCluster)
            .map(log => ({
              id: log.id,
              timestamp: log.timestamp,
              message: log.message,
              service: log.service,
              level: log.level
            }));
        }
        
        patterns.push(clusterResult);
      }
      
      // Sort patterns by count (descending)
      patterns.sort((a, b) => b.count - a.count);
      
      return {
        patterns,
        summary: {
          totalLogs: logs.length,
          clusterCount: Object.keys(clusters).length,
          patternCount: patterns.length,
          coverage: logs.length > 0 
            ? patterns.reduce((sum, pattern) => sum + pattern.count, 0) / logs.length 
            : 0
        },
        message: `Discovered ${patterns.length} log patterns from ${logs.length} log messages`
      };
    } catch (error: any) {
      logger.error('[LogPatternMining] Error discovering log patterns', { error });
      return { 
        patterns: [], 
        error: error.message || String(error),
        message: 'Failed to discover log patterns'
      };
    }
  }
  
  /**
   * Extract common pattern from a set of log messages
   * @param messages Array of log messages
   */
  private static extractCommonPattern(messages: string[]): string {
    if (messages.length === 0) return '';
    if (messages.length === 1) return messages[0];
    
    // Tokenize messages
    const tokenizedMessages = messages.map(message => this.tokenizeMessage(message));
    
    // Find common tokens
    const baseTokens = tokenizedMessages[0];
    const commonPattern: string[] = [];
    
    for (let i = 0; i < baseTokens.length; i++) {
      const token = baseTokens[i];
      
      // Check if this token is common across all messages
      const isCommon = tokenizedMessages.every(tokens => 
        tokens.length > i && tokens[i] === token
      );
      
      if (isCommon) {
        commonPattern.push(token);
      } else {
        // Check if this is a variable part (number, ID, etc.)
        const isVariable = tokenizedMessages.every(tokens => 
          tokens.length > i && this.isSameTokenType(tokens[i], token)
        );
        
        if (isVariable) {
          commonPattern.push('*');
        } else {
          // Different token types, try to continue alignment
          const nextCommonIndex = this.findNextCommonToken(tokenizedMessages, i);
          
          if (nextCommonIndex > i) {
            commonPattern.push('*');
            i = nextCommonIndex - 1; // -1 because loop will increment
          } else {
            // No more common tokens
            commonPattern.push('*');
            break;
          }
        }
      }
    }
    
    // Convert back to string
    return this.untokenizeMessage(commonPattern);
  }
  
  /**
   * Tokenize a log message into words and special characters
   * @param message Log message
   */
  private static tokenizeMessage(message: string): string[] {
    // Split by whitespace and special characters, keeping the separators
    return message.split(/(\s+|[,.;:!?()[\]{}'"<>\/\\-])/g)
      .filter(token => token.length > 0);
  }
  
  /**
   * Untokenize a message from tokens
   * @param tokens Array of tokens
   */
  private static untokenizeMessage(tokens: string[]): string {
    // Join tokens, handling whitespace appropriately
    let result = '';
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const nextToken = i < tokens.length - 1 ? tokens[i + 1] : null;
      
      // Add the token
      result += token;
      
      // Add space if needed
      if (nextToken && !this.isSpecialCharacter(token) && !this.isSpecialCharacter(nextToken)) {
        result += ' ';
      }
    }
    
    return result;
  }
  
  /**
   * Check if a token is a special character
   * @param token Token to check
   */
  private static isSpecialCharacter(token: string): boolean {
    return /^[,.;:!?()[\]{}'"<>\/\\-]$/.test(token);
  }
  
  /**
   * Check if two tokens are of the same type
   * @param token1 First token
   * @param token2 Second token
   */
  private static isSameTokenType(token1: string, token2: string): boolean {
    // Check if both are numbers
    const isNumber1 = /^\d+$/.test(token1);
    const isNumber2 = /^\d+$/.test(token2);
    
    if (isNumber1 && isNumber2) return true;
    
    // Check if both are IDs (alphanumeric with hyphens/underscores)
    const isId1 = /^[a-zA-Z0-9_-]+$/.test(token1);
    const isId2 = /^[a-zA-Z0-9_-]+$/.test(token2);
    
    if (isId1 && isId2) return true;
    
    // Check if both are special characters
    const isSpecial1 = this.isSpecialCharacter(token1);
    const isSpecial2 = this.isSpecialCharacter(token2);
    
    if (isSpecial1 && isSpecial2) return true;
    
    // Otherwise, they're different types
    return false;
  }
  
  /**
   * Find the next common token across all messages
   * @param tokenizedMessages Array of tokenized messages
   * @param startIndex Starting index to search from
   */
  private static findNextCommonToken(tokenizedMessages: string[][], startIndex: number): number {
    const baseTokens = tokenizedMessages[0];
    
    for (let i = startIndex + 1; i < baseTokens.length; i++) {
      const token = baseTokens[i];
      
      // Check if this token is common across all messages
      const isCommon = tokenizedMessages.every(tokens => 
        tokens.includes(token, startIndex)
      );
      
      if (isCommon) {
        return i;
      }
    }
    
    return -1; // No common token found
  }
  
  /**
   * Analyze log message frequency patterns over time
   * @param client The OpenSearch client to use for requests
   * @param startTime The start time for the analysis window
   * @param endTime The end time for the analysis window
   * @param options Additional options for frequency analysis
   */
  public static async analyzeLogFrequencyPatterns(
    client: LogsAdapterCore,
    startTime: string,
    endTime: string,
    options: {
      service?: string;
      level?: string;
      queryString?: string;
      interval?: string;
      minFrequency?: number;
    } = {}
  ): Promise<any> {
    logger.info('[LogPatternMining] Analyzing log frequency patterns', { 
      startTime, 
      endTime, 
      options 
    });
    
    try {
      // Default options
      const interval = options.interval || '5m';
      const minFrequency = options.minFrequency || 5;
      
      // Use OpenSearch's PPL (Piped Processing Language) for frequency analysis
      const pplEndpoint = '/_plugins/_ppl';
      
      // Build the query filters
      let filterClause = `where @timestamp >= '${startTime}' and @timestamp <= '${endTime}'`;
      
      // Add service filter if specified
      if (options.service) {
        filterClause += ` and resource.attributes.service.name = '${options.service}'`;
      }
      
      // Add level filter if specified
      if (options.level) {
        filterClause += ` and severity_text = '${options.level}'`;
      }
      
      // Add additional query string if specified
      if (options.queryString) {
        filterClause += ` and ${options.queryString}`;
      }
      
      // PPL query for frequency analysis
      const pplQuery = `
        source = logs-*
        | ${filterClause}
        | stats count() by span(@timestamp, ${interval}), body.keyword
        | sort count() desc
      `;
      
      const pplResponse = await client.request('POST', pplEndpoint, { query: pplQuery });
      
      if (!pplResponse.datarows || pplResponse.datarows.length === 0) {
        return { 
          patterns: [], 
          message: 'No log data found for frequency analysis'
        };
      }
      
      // Process the results
      const frequencyData: Record<string, Array<{
        timestamp: string;
        count: number;
      }>> = {};
      
      for (const row of pplResponse.datarows) {
        const timestamp = row[0];
        const message = row[1];
        const count = row[2];
        
        if (count >= minFrequency) {
          if (!frequencyData[message]) {
            frequencyData[message] = [];
          }
          
          frequencyData[message].push({
            timestamp,
            count
          });
        }
      }
      
      // Analyze frequency patterns for each message
      const patterns = [];
      
      for (const [message, frequencies] of Object.entries(frequencyData)) {
        // Sort by timestamp
        frequencies.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        // Calculate frequency statistics
        const counts = frequencies.map(f => f.count);
        const totalCount = counts.reduce((sum, count) => sum + count, 0);
        const avgCount = totalCount / frequencies.length;
        const maxCount = Math.max(...counts);
        const minCount = Math.min(...counts);
        const stdDev = Math.sqrt(
          counts.reduce((sum, count) => sum + Math.pow(count - avgCount, 2), 0) / counts.length
        );
        
        // Detect frequency pattern
        let pattern = 'stable';
        
        if (stdDev / avgCount > 0.5) {
          // High variance indicates spiky pattern
          pattern = 'spiky';
        } else if (frequencies.length >= 3) {
          // Check for increasing or decreasing trend
          const firstCount = frequencies[0].count;
          const lastCount = frequencies[frequencies.length - 1].count;
          const change = (lastCount - firstCount) / firstCount;
          
          if (change > 0.2) {
            pattern = 'increasing';
          } else if (change < -0.2) {
            pattern = 'decreasing';
          }
        }
        
        patterns.push({
          message,
          frequencies,
          pattern,
          stats: {
            totalCount,
            avgCount,
            maxCount,
            minCount,
            stdDev,
            coefficient_of_variation: stdDev / avgCount
          }
        });
      }
      
      // Sort patterns by total count (descending)
      patterns.sort((a, b) => b.stats.totalCount - a.stats.totalCount);
      
      return {
        patterns,
        interval,
        summary: {
          messageCount: patterns.length,
          timeIntervals: patterns.length > 0 ? patterns[0].frequencies.length : 0,
          patternCounts: {
            stable: patterns.filter(p => p.pattern === 'stable').length,
            spiky: patterns.filter(p => p.pattern === 'spiky').length,
            increasing: patterns.filter(p => p.pattern === 'increasing').length,
            decreasing: patterns.filter(p => p.pattern === 'decreasing').length
          }
        },
        message: `Analyzed frequency patterns for ${patterns.length} log messages`
      };
    } catch (error: any) {
      logger.error('[LogPatternMining] Error analyzing log frequency patterns', { error });
      return { 
        patterns: [], 
        error: error.message || String(error),
        message: 'Failed to analyze log frequency patterns'
      };
    }
  }
}

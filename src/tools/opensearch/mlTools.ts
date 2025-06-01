/**
 * Register OpenSearch-specific ML tools
 * These tools leverage OpenSearch's ML capabilities and are not available when using Elasticsearch
 */

import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { registerMcpTool } from '../../utils/registerTool.js';
import { getDefaultEmbeddingConfig } from '../../adapters/opensearch/ml/embeddingProvider.js';
import type { EmbeddingProviderConfig } from '../../adapters/opensearch/ml/embeddingProvider.js';
import { TraceClusteringWithSamplingOptions } from '../../adapters/opensearch/traces/clustering/types.js';

/**
 * Register OpenSearch ML tools with the MCP server
 * @param server The MCP server instance
 * @param osAdapter The OpenSearch adapter instance
 */
export function registerOpenSearchMlTools(server: McpServer, osAdapter: OpenSearchAdapter): void {
  logger.info('Registering OpenSearch ML tools');

  // Register Phase 1 ML tools
  registerCompareHistogramPatternsTool(server, osAdapter);
  registerSemanticLogSearchTool(server, osAdapter);
  registerAnalyzeDependencyEvolutionTool(server, osAdapter);
  registerClusterTraceAttributesTool(server, osAdapter);
}

/**
 * Register the compareHistogramPatterns tool
 */
function registerCompareHistogramPatternsTool(server: McpServer, osAdapter: OpenSearchAdapter): void {
  const toolName = 'compareHistogramPatterns';
  const schema = {
    startTime1: z.string().describe('Start time for first time range (ISO8601, required, e.g. 2023-01-01T00:00:00Z)'),
    endTime1: z.string().describe('End time for first time range (ISO8601, required, e.g. 2023-01-02T00:00:00Z)'),
    startTime2: z.string().describe('Start time for second time range (ISO8601, required, e.g. 2023-01-03T00:00:00Z)'),
    endTime2: z.string().describe('End time for second time range (ISO8601, required, e.g. 2023-01-04T00:00:00Z)'),
    metricField: z.string().describe('Metric field to analyze (supports dot notation for nested fields, e.g. system.cpu.usage)'),
    service: z.string().optional().describe('Filter to a specific service'),
    queryString: z.string().optional().describe('Additional Elasticsearch query string filter (e.g., "error AND NOT timeout")'),
    compareMethod: z.enum(['kl_divergence', 'js_divergence', 'wasserstein', 'all']).optional().default('all').describe('Method to use for comparison'),
    detectModes: z.boolean().optional().default(true).describe('Detect modes in histograms'),
    runStatTests: z.boolean().optional().default(true).describe('Run statistical tests to compare distributions'),
    smoothing: z.number().optional().default(0.1).describe('Smoothing parameter for kernel density estimation'),
    useEmbeddings: z.boolean().optional().default(true).describe('Use embeddings for semantic comparison'),
    embeddingModel: z.string().optional().describe('Embedding model to use (defaults to environment configuration)')
  };
  
  const handler = async (args: any): Promise<MCPToolOutput> => {
    try {
      logger.info('[MCP TOOL] compareHistogramPatterns called', { args });
      
      // Check if the metrics adapter has the compareHistograms method
      if (typeof osAdapter.metricsAdapter.compareHistograms !== 'function') {
        logger.warn('[MCP TOOL] compareHistograms method not found in metrics adapter');
        
        // Parse the dot-delimited metric field into components for logging
        const metricFieldParts = args.metricField.split('.');
        const metricName = metricFieldParts[metricFieldParts.length - 1];
        const metricNamespace = metricFieldParts.slice(0, -1).join('.');
        
        logger.info('[MCP TOOL] Processing metric field', {
          metricField: args.metricField,
          metricName,
          metricNamespace
        });
        
        // Return a proper error message
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Method not implemented',
                details: {
                  message: 'The compareHistograms method is not implemented in the metrics adapter',
                  metricField: args.metricField,
                  timeRange1: {
                    start: args.startTime1,
                    end: args.endTime1
                  },
                  timeRange2: {
                    start: args.startTime2,
                    end: args.endTime2
                  }
                }
              })
            },
            {
              type: 'text',
              text: `Cannot compare histogram distributions for metric field '${args.metricField}'. The compareHistograms method is not implemented in the metrics adapter.`
            }
          ]
        };
      }
      
      // Get histogram data for both time ranges
      // Parse the dot-delimited metric field for the actual API call
      const metricFieldParts = args.metricField.split('.');
      const metricName = metricFieldParts[metricFieldParts.length - 1];
      const metricNamespace = metricFieldParts.slice(0, -1).join('.');
      
      const histogramData1 = await osAdapter.metricsAdapter.searchMetrics({
        startTime: args.startTime1,
        endTime: args.endTime1,
        metricField: args.metricField,
        metricName: metricName,
        metricNamespace: metricNamespace || undefined,
        service: args.service,
        queryString: args.queryString,
        aggregation: 'histogram'
      });
      
      const histogramData2 = await osAdapter.metricsAdapter.searchMetrics({
        startTime: args.startTime2,
        endTime: args.endTime2,
        metricField: args.metricField,
        metricName: metricName,
        metricNamespace: metricNamespace || undefined,
        service: args.service,
        queryString: args.queryString,
        aggregation: 'histogram'
      });
      
      // Get default config and override model if specified
      let embeddingProviderConfig: EmbeddingProviderConfig | undefined = undefined;
      if (args.useEmbeddings !== false) { // Use embeddings by default unless explicitly disabled
        embeddingProviderConfig = getDefaultEmbeddingConfig();
        
        // Override the model if specified
        if (args.embeddingModel && embeddingProviderConfig.provider === 'openai' && embeddingProviderConfig.openai) {
          embeddingProviderConfig.openai.model = args.embeddingModel;
        }
      }
      
      // Compare the histograms using the built-in methods
      const comparisonResult = await osAdapter.metricsAdapter.compareHistograms(
        histogramData1,
        histogramData2,
        {
          compareMethod: args.compareMethod,
          detectModes: args.detectModes,
          runStatTests: args.runStatTests,
          smoothing: args.smoothing,
          useEmbeddings: args.useEmbeddings,
          embeddingProviderConfig
        }
      );
      
      // Format the result as an MCPToolOutput with only JSON
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(comparisonResult)
          }
        ]
      };
    } catch (error: any) {
      logger.error('[MCP TOOL] Error in compareHistogramPatterns', {
        error: error.message,
        stack: error.stack,
        openSearchError: error.openSearchError,
        args
      });
      
      // Return error as JSON with detailed OpenSearch error information
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              details: {
                tool: 'compareHistogramPatterns',
                args,
                status: error.status,
                statusText: error.statusText,
                openSearchError: error.openSearchError,
                request: error.request
              }
            })
          }
        ]
      };
    }
  };
  
  registerMcpTool(server, toolName, schema, handler);
}

/**
 * Register the semanticLogSearch tool
 */
function registerSemanticLogSearchTool(server: McpServer, osAdapter: OpenSearchAdapter): void {
  const toolName = 'semanticLogSearch';
  const schema = {
    query: z.string().describe('Search query or natural language question'),
    startTime: z.string().optional().describe('Start time (ISO8601, e.g. 2023-01-01T00:00:00Z)'),
    endTime: z.string().optional().describe('End time (ISO8601, e.g. 2023-01-02T00:00:00Z)'),
    service: z.string().optional().describe('Filter to a specific service'),
    level: z.string().optional().describe('Filter by log level'),
    queryString: z.string().optional().describe('Additional Elasticsearch query string filter (e.g., "error AND NOT timeout")'),
    k: z.number().optional().default(10).describe('Number of results to return'),
    minSimilarity: z.number().optional().default(0.7).describe('Minimum similarity score (0-1)'),
    includeContext: z.boolean().optional().default(true).describe('Include surrounding log context'),
    contextWindowSize: z.number().optional().default(5).describe('Number of log lines to include before/after each match'),
    samplingPercent: z.number().optional().default(20).describe('Percentage of data to sample (1-100)'),
    embeddingModel: z.string().optional().describe('Embedding model to use (defaults to environment configuration)')
  };
  
  const handler = async (args: any): Promise<MCPToolOutput> => {
    try {
      logger.info('[MCP TOOL] semanticLogSearch called', { args });
      
      // Create embedding provider configuration if model is specified
      let embeddingProviderConfig = undefined;
      if (args.embeddingModel) {
        embeddingProviderConfig = getDefaultEmbeddingConfig();
        // Override the model if specified
        if (embeddingProviderConfig.provider === 'openai' && embeddingProviderConfig.openai) {
          embeddingProviderConfig.openai.model = args.embeddingModel;
        }
      }
      
      // Perform semantic search using the logs adapter
      const result = await osAdapter.semanticLogSearch(
        args.query,
        {
          startTime: args.startTime,
          endTime: args.endTime,
          service: args.service,
          level: args.level,
          queryString: args.queryString,
          k: args.k,
          minSimilarity: args.minSimilarity,
          includeContext: args.includeContext,
          contextWindowSize: args.contextWindowSize,
          samplingPercent: args.samplingPercent,
          embeddingProviderConfig
        }
      );
      
      // Format the result as an MCPToolOutput with only JSON
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error: any) {
      logger.error('[MCP TOOL] Error in semanticLogSearch', {
        error: error.message,
        stack: error.stack,
        openSearchError: error.openSearchError,
        args
      });
      
      // Return error as JSON with detailed OpenSearch error information
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              details: {
                tool: 'semanticLogSearch',
                args,
                status: error.status,
                statusText: error.statusText,
                openSearchError: error.openSearchError,
                request: error.request
              }
            })
          }
        ]
      };
    }
  };
  
  registerMcpTool(server, toolName, schema, handler);
}

/**
 * Register the analyzeDependencyEvolution tool
 */
function registerAnalyzeDependencyEvolutionTool(server: McpServer, osAdapter: OpenSearchAdapter): void {
  const toolName = 'analyzeDependencyEvolution';
  const schema = {
    startTime1: z.string().describe('Start time for first time range (ISO8601, required, e.g. 2023-01-01T00:00:00Z)'),
    endTime1: z.string().describe('End time for first time range (ISO8601, required, e.g. 2023-01-02T00:00:00Z)'),
    startTime2: z.string().describe('Start time for second time range (ISO8601, required, e.g. 2023-01-03T00:00:00Z)'),
    endTime2: z.string().describe('End time for second time range (ISO8601, required, e.g. 2023-01-04T00:00:00Z)'),
    service: z.string().optional().describe('Filter to a specific service'),
    queryString: z.string().optional().describe('Additional Elasticsearch query string filter (e.g., "error AND NOT timeout")'),
    minCallCount: z.number().optional().default(10).describe('Minimum call count to include in analysis'),
    significantChangeThreshold: z.number().optional().default(0.25).describe('Threshold for significant traffic change (0-1)'),
    errorRateChangeThreshold: z.number().optional().default(0.05).describe('Threshold for significant error rate change (0-1)'),
    // Embedding configuration
    useEmbeddings: z.boolean().optional().default(true).describe('Use embeddings for anomaly detection'),
    embeddingModel: z.string().optional().describe('Embedding model to use (defaults to environment configuration)')
  };
  
  const handler = async (args: any): Promise<MCPToolOutput> => {
    try {
      logger.info('[MCP TOOL] analyzeDependencyEvolution called', { args });
      
      // Create embedding provider configuration if model is specified
      let embeddingProviderConfig = undefined;
      if (args.embeddingModel) {
        embeddingProviderConfig = getDefaultEmbeddingConfig();
        // Override the model if specified
        if (embeddingProviderConfig.provider === 'openai' && embeddingProviderConfig.openai) {
          embeddingProviderConfig.openai.model = args.embeddingModel;
        }
      }
      
      // Analyze dependency evolution using the traces adapter
      const result = await osAdapter.tracesAdapter.analyzeDependencyEvolution(
        args.startTime1,
        args.endTime1,
        args.startTime2,
        args.endTime2,
        {
          service: args.service,
          queryString: args.queryString,
          minCallCount: args.minCallCount,
          significantChangeThreshold: args.significantChangeThreshold,
          errorRateChangeThreshold: args.errorRateChangeThreshold,
          // Pass embedding configuration
          useEmbeddings: args.useEmbeddings,
          embeddingProviderConfig
        }
      );
      
      // Format the result as an MCPToolOutput with only JSON
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    } catch (error: any) {
      logger.error('[MCP TOOL] Error in analyzeDependencyEvolution', {
        error: error.message,
        stack: error.stack,
        openSearchError: error.openSearchError,
        args
      });
      
      // Return error as JSON with detailed OpenSearch error information
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.message,
              details: {
                tool: 'analyzeDependencyEvolution',
                args,
                status: error.status,
                statusText: error.statusText,
                openSearchError: error.openSearchError,
                request: error.request
              }
            })
          }
        ]
      };
    }
  };
  
  registerMcpTool(server, toolName, schema, handler);
}

/**
 * Register the clusterTraceAttributes tool
 */
function registerClusterTraceAttributesTool(server: McpServer, osAdapter: OpenSearchAdapter): void {
  const toolName = 'clusterTraceAttributes';
  const schema = {
    attributeKey: z.string().optional().describe('Trace attribute key to cluster. If not provided, will use text content extraction.'),
    useTextContent: z.boolean().optional().default(false).describe('Use text content extraction instead of a specific attribute key'),
    textFields: z.array(z.string()).optional().describe('Specific fields to extract text from when using text content extraction'),
    startTime: z.string().describe('Start time (ISO8601, required, e.g. 2023-01-01T00:00:00Z)'),
    endTime: z.string().describe('End time (ISO8601, required, e.g. 2023-01-02T00:00:00Z)'),
    service: z.string().optional().describe('Filter to a specific service'),
    queryString: z.string().optional().describe('Additional Elasticsearch query string filter (e.g., "error AND NOT timeout")'),
    clusterCount: z.number().optional().default(5).describe('Number of clusters to create'),
    minClusterSize: z.number().optional().default(3).describe('Minimum size of a cluster'),
    includeOutliers: z.boolean().optional().default(true).describe('Include outliers in results'),
    // Sampling parameters for embedding generation
    enableSampling: z.boolean().optional().default(true).describe('Enable data sampling to improve performance'),
    samplingPercent: z.number().optional().default(10).describe('Percentage of data to sample (1-100)'),
    maxSamples: z.number().optional().default(100).describe('Maximum number of samples to process'),
    embeddingBatchSize: z.number().optional().default(3).describe('Batch size for embedding generation requests'),
    // Option to exclude vectors from the response to reduce payload size
    excludeVectors: z.boolean().optional().default(false).describe('Exclude vector embeddings from the response to reduce payload size'),
    // Embedding model configuration
    embeddingModel: z.string().optional().describe('Embedding model to use (defaults to environment configuration)')
  };
  
  const handler = async (args: any): Promise<MCPToolOutput> => {
    try {
      logger.info('[MCP TOOL] clusterTraceAttributes called', { args });
      
      // Create embedding provider configuration if model is specified
      let embeddingProviderConfig = undefined;
      if (args.embeddingModel) {
        embeddingProviderConfig = getDefaultEmbeddingConfig();
        // Override the model if specified
        if (embeddingProviderConfig.provider === 'openai' && embeddingProviderConfig.openai) {
          embeddingProviderConfig.openai.model = args.embeddingModel;
        }
      }
      
      // Log the request parameters for debugging
      logger.debug('[MCP TOOL] clusterTraceAttributes request parameters', {
        attributeKey: args.attributeKey,
        startTime: args.startTime,
        endTime: args.endTime,
        service: args.service,
        samplingEnabled: args.enableSampling,
        samplingPercent: args.samplingPercent
      });
    
      // Create the options object for clustering
      const clusteringOptions = {
        service: args.service,
        queryString: args.queryString,
        clusterCount: args.clusterCount,
        minClusterSize: args.minClusterSize,
        includeOutliers: args.includeOutliers,
        enableSampling: args.enableSampling,
        samplingPercent: args.samplingPercent,
        maxSamples: args.maxSamples,
        embeddingBatchSize: args.embeddingBatchSize,
        // Support for text content extraction
        useTextContent: args.useTextContent,
        textFields: args.textFields,
        // Pass the attribute key as the field for nested field detection
        field: args.attributeKey,
        // Pass embedding provider configuration
        embeddingProviderConfig
      };
      
      // Cluster trace attributes using the traces adapter
      const result = await osAdapter.tracesAdapter.clusterTraceAttributes(
        args.attributeKey,
        args.startTime,
        args.endTime,
        clusteringOptions
      );
      
      // Post-process the result to remove vector data
      let processedResult;
      
      if (result && result.clusters && Array.isArray(result.clusters)) {
        processedResult = {
          ...result,
          clusters: result.clusters.map((cluster: any) => ({
            ...cluster,
            values: Array.isArray(cluster.values) ? cluster.values.map((value: any) => ({
              value: value.value,
              count: value.count,
              vector: undefined
            })) : []
          }))
        };
      } else {
        // Handle case where clusters is undefined or not an array
        processedResult = {
          ...result,
          clusters: result.clusters || []
        };
      }
      
      // Format the result as an MCPToolOutput with only JSON
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(processedResult)
          }
        ]
      };
    } catch (error: any) {
      logger.error('[MCP TOOL] Error in clusterTraceAttributes', {
        error: error.message,
        stack: error.stack,
        openSearchError: error.openSearchError,
        args
      });
      
      // Extract detailed error information from OpenSearch error
      let rootCause = [];
      let reason = '';
      
      if (error.openSearchError && error.openSearchError.error) {
        const osError = error.openSearchError.error;
        rootCause = osError.root_cause || [];
        reason = osError.reason || '';
        
        // Log the detailed error information
        logger.error('[MCP TOOL] OpenSearch error details', {
          rootCause,
          reason,
          phase: osError.phase,
          failedShards: osError.failed_shards
        });
      }
      
      // Return error as JSON with detailed OpenSearch error information
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              attributeKey: args.attributeKey,
              totalValues: 0,
              clusters: [{
                id: 0,
                label: 'Error',
                values: [],
                commonTerms: [],
                isOutlier: false
              }],
              samplingEnabled: false,
              samplingPercent: 0,
              sampledValues: 0,
              error: error.message,
              errorDetails: {
                rootCause,
                reason,
                status: error.status,
                request: error.request,
                response: error.response
              }
            })
          }
        ]
      };
    }
  };
  
  registerMcpTool(server, toolName, schema, handler);
}

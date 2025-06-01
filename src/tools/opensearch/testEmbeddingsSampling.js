/**
 * Test script for the centralized embedding functionality with sampling
 * This script demonstrates how to use the new ML utilities for embedding generation
 * with sampling support to improve performance.
 */

import { OpenSearchAdapter } from '../../adapters/opensearch/index.js';
import { generateEmbeddings } from '../../adapters/opensearch/ml/embeddings.js';
import { createSamplingAggregation, processSamplingResults } from '../../adapters/opensearch/ml/sampling.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

// Configure logging
logger.level = 'debug';

// Create OpenSearch adapter
const osAdapter = new OpenSearchAdapter({
  node: config.opensearch.node,
  auth: config.opensearch.auth
});

async function testEmbeddingWithSampling() {
  try {
    console.log('Testing embedding generation with sampling...');
    
    // Sample data to embed
    const testItems = [
      { id: 1, text: 'This is a test of the embedding system' },
      { id: 2, text: 'OpenAI embeddings are used for semantic search' },
      { id: 3, text: 'Sampling reduces the number of items to process' },
      { id: 4, text: 'Batch processing improves performance' },
      { id: 5, text: 'The OpenSearch ML plugin provides clustering capabilities' }
    ];
    
    // Define embedding options with sampling
    const embeddingOptions = {
      batchSize: 3,
      enableSampling: true,
      samplingPercent: 60,
      maxSamples: 10,
      context: {
        source: 'TestScript',
        testId: 'embedding-sampling-test'
      }
    };
    
    console.log('Generating embeddings with the following options:', embeddingOptions);
    
    // Generate embeddings using the centralized utility
    const results = await generateEmbeddings(
      osAdapter.core,
      testItems,
      (item) => item.text,
      embeddingOptions
    );
    
    // Log results
    console.log(`Generated embeddings for ${results.length} items`);
    console.log('Items with embeddings:', results.filter(r => r.item.vector).length);
    console.log('Items with errors:', results.filter(r => r.error).length);
    
    // Show a sample vector
    const sampleVector = results.find(r => r.item.vector)?.item.vector;
    if (sampleVector) {
      console.log('Sample vector (first 5 dimensions):', sampleVector.slice(0, 5));
      console.log('Vector dimensions:', sampleVector.length);
    }
    
    // Test sampling aggregation
    console.log('\nTesting sampling aggregation...');
    
    const samplingOptions = {
      enableSampling: true,
      samplingPercent: 50,
      maxSamples: 100,
      context: {
        source: 'TestScript',
        testId: 'sampling-agg-test'
      }
    };
    
    const samplingAgg = createSamplingAggregation('http.url.keyword', samplingOptions);
    console.log('Generated sampling aggregation:', JSON.stringify(samplingAgg, null, 2));
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error testing embedding with sampling:', error);
  } finally {
    // Close the OpenSearch connection
    await osAdapter.close();
  }
}

// Run the test
testEmbeddingWithSampling();

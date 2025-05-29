import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenSearch Logs Adapter Core
 * Provides base functionality for working with OpenTelemetry logs data in OpenSearch
 */
export class LogsAdapterCore extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }
  
  /**
   * Recursively extract fields from mapping properties
   */
  protected extractFields(properties: any, prefix: string, fields: any[]): void {
    for (const fieldName in properties) {
      if (Object.prototype.hasOwnProperty.call(properties, fieldName)) {
        const field = properties[fieldName];
        const fullName = prefix ? `${prefix}.${fieldName}` : fieldName;
        
        // Add the field to the list
        fields.push({
          name: fullName,
          type: field.type || 'object',
          description: field.description || ''
        });
        
        // Recursively process nested properties
        if (field.properties) {
          this.extractFields(field.properties, fullName, fields);
        }
      }
    }
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  protected cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Extract common terms from a set of messages
   */
  protected extractCommonTerms(messages: string[]): string[] {
    if (messages.length === 0) {
      return [];
    }
    
    // Tokenize messages
    const tokenizedMessages = messages.map(message => {
      return message
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 2); // Filter out short tokens
    });
    
    // Count token frequencies
    const tokenCounts: Record<string, number> = {};
    
    for (const tokens of tokenizedMessages) {
      // Count unique tokens in each message
      // Convert Set to Array using Array.from() instead of spread operator for better TypeScript compatibility
      const uniqueTokens = Array.from(new Set(tokens));
      
      for (const token of uniqueTokens) {
        tokenCounts[token] = (tokenCounts[token] || 0) + 1;
      }
    }
    
    // Find common terms (appearing in at least half of the messages)
    const threshold = Math.max(2, Math.floor(messages.length * 0.5));
    const commonTerms = Object.entries(tokenCounts)
      .filter(([_, count]) => count >= threshold)
      .map(([term, _]) => term)
      .sort((a, b) => tokenCounts[b] - tokenCounts[a]);
    
    return commonTerms.slice(0, 5); // Return top 5 common terms
  }
}

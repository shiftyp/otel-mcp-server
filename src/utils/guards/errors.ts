/**
 * Error class for Elasticsearch data availability issues
 */
export class ElasticsearchDataError extends Error {
  constructor(message: string, public dataType: 'logs' | 'metrics' | 'traces', public details?: any) {
    super(message);
    this.name = 'ElasticsearchDataError';
  }
}

/**
 * Types for data availability in Elasticsearch
 */
export type DataType = 'logs' | 'metrics' | 'traces';

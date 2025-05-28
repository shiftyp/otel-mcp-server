import { ElasticsearchCore } from '../../core/core.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Core functionality for trace operations
 */
export class TraceCore extends ElasticsearchCore {
  /**
   * Make a request to Elasticsearch
   * @param method The HTTP method
   * @param url The URL path to query
   * @param body The query body
   * @returns The response from Elasticsearch with data already extracted
   */
  public async request(method: string, url: string, body: any) {
    const response = await this.client.request({
      method,
      url,
      data: body
    });
    
    // Return the data property which contains hits and aggregations
    return response.data;
  }

  /**
   * Extract service name from various possible fields (both OTEL and ECS mapping modes)
   */
  protected extractServiceName(span: any): string {
    // Try different paths where service name might be stored
    const serviceName = (
      // OTEL mapping - standard paths
      (span.resource?.attributes?.['service.name']) ||
      (span.Resource?.attributes?.['service.name']) ||
      // OTEL mapping - alternative paths
      (span.resource?.attributes?.service?.name) ||
      (span.Resource?.service?.name) ||
      // ECS mapping
      (span.service?.name) ||
      // Kubernetes deployment name as fallback
      (span.resource?.attributes?.['k8s.deployment.name']) ||
      (span.Resource?.attributes?.['k8s.deployment.name']) ||
      // Fallback
      'unknown'
    );
    
    logger.debug('[ES Adapter] Extracted service name', { 
      serviceName, 
      spanId: span.span_id,
      resourcePaths: {
        resourceAttrsServiceName: span.resource?.attributes?.['service.name'],
        ResourceAttrsServiceName: span.Resource?.attributes?.['service.name'],
        resourceAttrsServiceNameNested: span.resource?.attributes?.service?.name,
        ResourceServiceName: span.Resource?.service?.name,
        serviceName: span.service?.name,
        k8sDeploymentName: span.resource?.attributes?.['k8s.deployment.name'] || span.Resource?.attributes?.['k8s.deployment.name']
      }
    });
    
    return serviceName;
  }

  /**
   * Common index pattern for trace queries
   */
  protected get traceIndexPattern(): string {
    return '.ds-traces-*,traces*,*traces*,otel-trace*,spans*,*spans*';
  }
}

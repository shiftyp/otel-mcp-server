import { OpenSearchSubAdapter } from '../../core/baseAdapter.js';
import { logger } from '../../../../utils/logger.js';
import { ConfigLoader } from '../../../../config/index.js';

/**
 * OpenSearch Traces Adapter Core
 * Provides base functionality for working with trace data in OpenSearch
 */
export class TracesAdapterCore extends OpenSearchSubAdapter {
  protected tracesIndex: string;
  
  constructor(options: any) {
    super(options);
    this.tracesIndex = options.tracesIndex || 'traces-*';
  }

  /**
   * Query traces index
   */
  public async searchTraces(query: any): Promise<any> {
    return this.request('POST', `/${this.tracesIndex}/_search`, query);
  }
  
  /**
   * Get trace fields from mapping
   */
  public async getTraceFields(): Promise<any[]> {
    const response = await this.request('GET', `/${this.tracesIndex}/_mapping`);
    
    const fields: any[] = [];
    for (const index in response) {
      const mappings = response[index].mappings;
      if (mappings && mappings.properties) {
        this.extractTraceFields(mappings.properties, '', fields);
      }
    }
    
    return fields;
  }
  
  /**
   * Helper to extract trace field information from mapping
   */
  protected extractTraceFields(properties: any, path: string, fields: any[]): void {
    for (const field in properties) {
      const fullPath = path ? `${path}.${field}` : field;
      const fieldInfo = properties[field];
      
      // Add field info
      fields.push({
        field: fullPath,
        type: fieldInfo.type || 'object',
        searchable: fieldInfo.type !== 'binary' && fieldInfo.type !== 'geo_shape',
        aggregatable: fieldInfo.type !== 'text' && fieldInfo.type !== 'binary',
        isTraceField: this.isTraceSpecificField(fullPath)
      });
      
      // Process nested fields
      if (fieldInfo.properties) {
        this.extractTraceFields(fieldInfo.properties, fullPath, fields);
      }
      
      // Process fields with subfields
      if (fieldInfo.fields) {
        for (const subfield in fieldInfo.fields) {
          fields.push({
            field: `${fullPath}.${subfield}`,
            type: fieldInfo.fields[subfield].type || 'keyword',
            searchable: true,
            aggregatable: true,
            isTraceField: this.isTraceSpecificField(`${fullPath}.${subfield}`)
          });
        }
      }
    }
  }
  
  /**
   * Check if field is trace-specific
   */
  protected isTraceSpecificField(fieldName: string): boolean {
    const traceFields = [
      'trace.id', 'trace_id', 'traceId',
      'span.id', 'span_id', 'spanId',
      'parent.id', 'parent_id', 'parentId',
      'span.name', 'operation.name',
      'span.kind', 'span.status',
      'span.duration', 'duration'
    ];
    
    return traceFields.some(tf => fieldName.includes(tf));
  }
  
  /**
   * Build service dependency query
   */
  public buildServiceDependencyQuery(timeRange: { from: string; to: string }): any {
    const config = ConfigLoader.get();
    const timestampField = config.telemetry.fields.timestamp;
    
    return {
      size: 0,
      query: {
        bool: {
          must: [
            {
              range: {
                [timestampField]: {
                  gte: timeRange.from,
                  lte: timeRange.to
                }
              }
            },
            {
              exists: {
                field: 'span.id'
              }
            }
          ]
        }
      },
      aggs: {
        services: {
          terms: {
            field: 'resource.attributes.service.name.keyword',
            size: 100
          },
          aggs: {
            dependencies: {
              terms: {
                field: 'attributes.peer.service.keyword',
                size: 100
              }
            }
          }
        }
      }
    };
  }
}
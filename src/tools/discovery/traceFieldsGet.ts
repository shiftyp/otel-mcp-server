import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../config/index.js';
import { MCPToolSchema } from '../../types.js';

// Define the Zod schema
const TraceFieldsGetArgsSchema = {
  search: z.string().optional().describe('Search pattern for field names (supports wildcards, e.g., "span.*", "*.duration", "*error*")')
};

type TraceFieldsGetArgs = MCPToolSchema<typeof TraceFieldsGetArgsSchema>;

/**
 * Tool for discovering trace fields
 */
export class TraceFieldsGetTool extends BaseTool<typeof TraceFieldsGetArgsSchema> {
  // Static schema property
  static readonly schema = TraceFieldsGetArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'discoverTraceFields',
      category: ToolCategory.DISCOVERY,
      description: 'Discover trace field names, types, and usage patterns. Use search patterns like "span.*", "*.duration", or "*error*" to filter fields',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return TraceFieldsGetArgsSchema;
  }
  
  protected async executeImpl(args: TraceFieldsGetArgs): Promise<any> {
    const config = ConfigLoader.get();
    const index = config.telemetry.indices.traces;
    
    const fields = await this.adapter.getFields(index, args.search);
    
    // Group fields by type
    const fieldsByType: Record<string, string[]> = {};
    for (const field of fields) {
      if (!fieldsByType[field.type]) {
        fieldsByType[field.type] = [];
      }
      fieldsByType[field.type].push(field.name);
    }
    
    // Get sample trace for common fields
    const sampleResult = await this.adapter.query(index, { match_all: {} }, { size: 1 });
    const sampleTrace = sampleResult.hits.hits[0]?._source;
    
    // If search was provided, include search info
    const searchInfo = args.search ? {
      searchPattern: args.search,
      matchedFields: fields.length,
      totalFieldsInIndex: await this.adapter.getFields(index).then(allFields => allFields.length)
    } : null;

    // Identify trace-specific fields
    const traceSpecificFields = {
      spanFields: fields.filter(f => f.name.toLowerCase().includes('span')).map(f => f.name),
      traceFields: fields.filter(f => f.name.toLowerCase().includes('trace')).map(f => f.name),
      durationFields: fields.filter(f => f.name.toLowerCase().includes('duration')).map(f => f.name),
      statusFields: fields.filter(f => 
        f.name.toLowerCase().includes('status') || 
        f.name.toLowerCase().includes('error')
      ).map(f => f.name),
      serviceFields: fields.filter(f => f.name.toLowerCase().includes('service')).map(f => f.name)
    };

    return this.formatJsonOutput({
      ...(searchInfo ? { search: searchInfo } : {}),
      totalFields: fields.length,
      fieldsByType,
      aggregatableFields: fields.filter(f => f.aggregatable).map(f => f.name),
      searchableFields: fields.filter(f => f.searchable).map(f => f.name),
      ...traceSpecificFields,
      commonFields: sampleTrace ? Object.keys(sampleTrace).slice(0, 20) : [],
      fieldDetails: fields.slice(0, 100) // First 100 fields with full details
    });
  }
}
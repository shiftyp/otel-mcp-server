import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../config/index.js';
import { MCPToolSchema } from '../../types.js';

// Define the Zod schema
const TraceFieldsGetArgsSchema = {
  index: z.string().optional().describe('Specific index to query (optional, uses default if not specified)')
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
      description: 'Discover trace field names, types, and usage patterns to understand trace schema',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return TraceFieldsGetArgsSchema;
  }
  
  protected async executeImpl(args: TraceFieldsGetArgs): Promise<any> {
    const config = ConfigLoader.get();
    const index = args.index || config.telemetry.indices.traces;
    
    const fields = await this.adapter.getFields(index);
    
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
    
    return this.formatJsonOutput({
      totalFields: fields.length,
      fieldsByType,
      aggregatableFields: fields.filter(f => f.aggregatable).map(f => f.name),
      searchableFields: fields.filter(f => f.searchable).map(f => f.name),
      commonFields: sampleTrace ? Object.keys(sampleTrace).slice(0, 20) : [],
      fieldDetails: fields.slice(0, 100) // First 100 fields with full details
    });
  }
}
import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../config/index.js';
import { LogDocument } from '../../types/opensearch-types.js';
import { MCPToolSchema } from '../../types.js';

// Define the Zod schema
const LogFieldsGetArgsSchema = {
  index: z.string().optional().describe('Specific index to query (optional, uses default if not specified)')
};

type LogFieldsGetArgs = MCPToolSchema<typeof LogFieldsGetArgsSchema>;

/**
 * Tool for discovering log fields with co-occurrence analysis
 */
export class LogFieldsGetTool extends BaseTool<typeof LogFieldsGetArgsSchema> {
  // Static schema property
  static readonly schema = LogFieldsGetArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'discoverLogFields',
      category: ToolCategory.DISCOVERY,
      description: 'Discover log field names, types, and co-occurrence patterns to understand log schema',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return LogFieldsGetArgsSchema;
  }
  
  protected async executeImpl(args: LogFieldsGetArgs): Promise<any> {
    const config = ConfigLoader.get();
    const index = args.index || config.telemetry.indices.logs;
    
    const fields = await this.adapter.getFields(index);
    
    // Group fields by type
    const fieldsByType: Record<string, string[]> = {};
    for (const field of fields) {
      if (!fieldsByType[field.type]) {
        fieldsByType[field.type] = [];
      }
      fieldsByType[field.type].push(field.name);
    }
    
    // Get sample logs for field co-occurrence
    const sampleResult = await this.adapter.query<LogDocument>(index, { match_all: {} }, { size: 100 });
    const samples = sampleResult.hits.hits.map(hit => hit._source);
    
    // Analyze field co-occurrence
    const fieldCoOccurrence: Record<string, Set<string>> = {};
    for (const sample of samples) {
      const presentFields = Object.keys(sample);
      for (const field1 of presentFields) {
        if (!fieldCoOccurrence[field1]) {
          fieldCoOccurrence[field1] = new Set();
        }
        for (const field2 of presentFields) {
          if (field1 !== field2) {
            fieldCoOccurrence[field1].add(field2);
          }
        }
      }
    }
    
    // Convert sets to arrays and get top co-occurring fields
    const topCoOccurringFields: Record<string, string[]> = {};
    for (const [field, coFields] of Object.entries(fieldCoOccurrence)) {
      topCoOccurringFields[field] = Array.from(coFields).slice(0, 10);
    }
    
    return this.formatJsonOutput({
      totalFields: fields.length,
      fieldsByType,
      aggregatableFields: fields.filter(f => f.aggregatable).map(f => f.name),
      searchableFields: fields.filter(f => f.searchable).map(f => f.name),
      logLevelFields: fields.filter(f => 
        f.name.toLowerCase().includes('level') || 
        f.name.toLowerCase().includes('severity')
      ).map(f => f.name),
      messageFields: fields.filter(f => 
        f.name.toLowerCase().includes('message') || 
        f.name.toLowerCase().includes('msg')
      ).map(f => f.name),
      topCoOccurringFields: Object.entries(topCoOccurringFields).slice(0, 20),
      fieldDetails: fields.slice(0, 100)
    });
  }
}
import { z } from 'zod';
import { BaseTool, ToolCategory } from '../base/tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { MCPToolSchema } from '../../types.js';

// Define the Zod schema
const ServicesGetArgsSchema = {
  includeMetadata: z.boolean().optional().describe('Include detailed metadata in results (default: false)')
};

type ServicesGetArgs = MCPToolSchema<typeof ServicesGetArgsSchema>;

/**
 * Tool for discovering available services
 */
export class ServicesGetTool extends BaseTool<typeof ServicesGetArgsSchema> {
  // Static schema property
  static readonly schema = ServicesGetArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'discoverServices',
      category: ToolCategory.DISCOVERY,
      description: 'Discover all services and their metadata (language, type, dependencies) across traces, logs, and metrics',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return ServicesGetArgsSchema;
  }
  
  protected async executeImpl(args: ServicesGetArgs): Promise<any> {
    const services = await this.adapter.getServices();
    
    if (!args.includeMetadata) {
      // Simple list of service names
      return this.formatJsonOutput({
        services: services.map(s => s.name),
        count: services.length
      });
    }
    
    // Group services by language/framework
    const servicesByLanguage: Record<string, any[]> = {};
    const servicesByType: Record<string, any[]> = {};
    
    for (const service of services) {
      // Group by language
      const language = service.language || 'unknown';
      if (!servicesByLanguage[language]) {
        servicesByLanguage[language] = [];
      }
      servicesByLanguage[language].push(service);
      
      // Group by type
      const type = service.type || 'unknown';
      if (!servicesByType[type]) {
        servicesByType[type] = [];
      }
      servicesByType[type].push(service);
    }
    
    return this.formatJsonOutput({
      services,
      count: services.length,
      byLanguage: servicesByLanguage,
      byType: servicesByType,
      languages: Object.keys(servicesByLanguage),
      types: Object.keys(servicesByType)
    });
  }
}
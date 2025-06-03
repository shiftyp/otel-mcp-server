import { z } from 'zod';
import { BaseTool, ToolCategory, ToolMetadata } from './tool.js';
import { BaseSearchAdapter } from '../../adapters/base/searchAdapter.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool constructor type
 */
type ToolConstructor<T extends Record<string, z.ZodType<any>>> = new (adapter: BaseSearchAdapter) => BaseTool<T>;

/**
 * Tool registry for managing and organizing tools
 */
export class ToolRegistry<T extends Record<string, z.ZodType<any>>> {
  private tools = new Map<string, ToolConstructor<T>>();
  private toolsByCategory = new Map<ToolCategory, Set<string>>();
  
  constructor() {
    // Initialize category sets
    for (const category of Object.values(ToolCategory)) {
      this.toolsByCategory.set(category as ToolCategory, new Set());
    }
  }
  
  /**
   * Register a tool class
   */
  register(ToolClass: ToolConstructor<T>): void {
    // Create a temporary instance to get metadata
    const tempAdapter = {} as BaseSearchAdapter;
    const tempInstance = new ToolClass(tempAdapter);
    const metadata = tempInstance.getMetadata();
    
    // Register the tool
    this.tools.set(metadata.name, ToolClass);
    
    // Add to category index
    const categorySet = this.toolsByCategory.get(metadata.category);
    if (categorySet) {
      categorySet.add(metadata.name);
    }
    
    logger.debug(`Registered tool ${metadata.name} in category ${metadata.category}`);
  }
  
  /**
   * Register multiple tools at once
   */
  registerAll(toolClasses: ToolConstructor<any>[]): void {
    for (const ToolClass of toolClasses) {
      this.register(ToolClass);
    }
  }
  
  /**
   * Create tool instances for a specific adapter
   */
  createTools(adapter: BaseSearchAdapter): Map<string, BaseTool<any>> {
    const instances = new Map<string, BaseTool<any>>();
    
    for (const [name, ToolClass] of this.tools) {
      try {
        const tool = new ToolClass(adapter);
        
        // Only include supported tools
        if (tool.isSupported()) {
          instances.set(name, tool);
          logger.debug(`Created tool instance: ${name}`);
        } else {
          logger.debug(`Tool ${name} not supported by ${adapter.getType()}`);
        }
      } catch (error) {
        logger.error(`Failed to create tool ${name}`, { error });
      }
    }
    
    logger.info(`Created ${instances.size} tool instances for ${adapter.getType()}`);
    return instances;
  }
  
  /**
   * Get tools by category
   */
  getToolsByCategory(category: ToolCategory): string[] {
    const categorySet = this.toolsByCategory.get(category);
    return categorySet ? Array.from(categorySet) : [];
  }
  
  /**
   * Get all registered tool names
   */
  getAllToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
  
  /**
   * Get tool metadata
   */
  getToolMetadata(toolName: string): ToolMetadata | null {
    const ToolClass = this.tools.get(toolName);
    if (!ToolClass) {
      return null;
    }
    
    const tempAdapter = {} as BaseSearchAdapter;
    const tempInstance = new ToolClass(tempAdapter);
    return tempInstance.getMetadata();
  }
  
  /**
   * Get tools organized by category
   */
  getToolsByCategories(): Record<ToolCategory, ToolMetadata[]> {
    const result: Record<ToolCategory, ToolMetadata[]> = {
      [ToolCategory.QUERY]: [],
      [ToolCategory.DISCOVERY]: [],
      [ToolCategory.ANALYSIS]: [],
      [ToolCategory.UTILITY]: []
    };
    
    for (const [category, toolNames] of this.toolsByCategory) {
      for (const toolName of toolNames) {
        const metadata = this.getToolMetadata(toolName);
        if (metadata) {
          result[category].push(metadata);
        }
      }
    }
    
    return result;
  }
}

// Global registry instance
export const globalToolRegistry = new ToolRegistry();
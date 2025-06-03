import { z } from 'zod';
import { BaseSearchAdapter, AdapterCapabilities } from '../../adapters/base/searchAdapter.js';
import { MCPToolOutput, MCPToolSchema } from '../../types.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool category for organization
 */
export enum ToolCategory {
  QUERY = 'query',
  DISCOVERY = 'discovery',
  ANALYSIS = 'analysis',
  UTILITY = 'utility'
}

/**
 * Tool metadata interface
 */
export interface ToolMetadata {
  name: string;
  category: ToolCategory;
  description: string;
  requiredCapabilities?: Array<keyof AdapterCapabilities>;
  backendSpecific?: 'elasticsearch' | 'opensearch' | null;
}

/**
 * Base class for all MCP tools with Zod schema validation
 */
export abstract class BaseTool<TSchema extends Record<string, z.ZodType>, TResult = unknown> {
  protected adapter: BaseSearchAdapter;
  protected metadata: ToolMetadata;

  // Static schema property - must be overridden in subclasses
  static readonly schema: Record<string, z.ZodType>;

  constructor(adapter: BaseSearchAdapter, metadata: ToolMetadata) {
    this.adapter = adapter;
    this.metadata = metadata;
  }

  /**
   * Get the schema for this tool
   */
  protected abstract getSchema(): TSchema;

  /**
   * Get tool metadata
   */
  getMetadata(): ToolMetadata {
    return this.metadata;
  }

  /**
   * Get the parameter schema for MCP
   */
  getParameterSchema(): Record<string, z.ZodType> {
    return this.getSchema();
  }

  /**
   * Check if the tool is supported by the current adapter
   */
  isSupported(): boolean {
    // Check backend type if specified
    if (this.metadata.backendSpecific) {
      if (this.adapter.getType() !== this.metadata.backendSpecific) {
        return false;
      }
    }

    // Check required capabilities
    if (this.metadata.requiredCapabilities) {
      const capabilities = this.adapter.getCapabilities();

      for (const reqCapability of this.metadata.requiredCapabilities) {
        const capabilityGroup = capabilities[reqCapability];
        if (!capabilityGroup || !Object.values(capabilityGroup).some(v => v === true)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Execute the tool with validation
   */
  async execute(args: MCPToolSchema<TSchema>): Promise<MCPToolOutput> {
    try {
      // Check if supported
      if (!this.isSupported()) {
        throw new Error(`Tool ${this.metadata.name} is not supported by ${this.adapter.getType()} backend`);
      }

      // Validate arguments using Zod
      const schema = z.object(this.getSchema());
      logger.debug(`Tool ${this.metadata.name} received args:`, args);
      const validatedArgs = schema.parse(args);

      // Log execution
      logger.info(`Executing tool ${this.metadata.name}`, {
        category: this.metadata.category,
        backend: this.adapter.getType(),
        args: validatedArgs
      });

      // Execute implementation with typed args
      const result = await this.executeImpl(validatedArgs as MCPToolSchema<TSchema>);

      logger.info(`Tool ${this.metadata.name} executed successfully`);

      return this.formatJsonOutput(result);
    } catch (error) {
      logger.error(`Tool ${this.metadata.name} execution failed`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Handle Zod validation errors specially
      if (error instanceof z.ZodError) {
        logger.error(`Zod validation error in ${this.metadata.name}`, {
          errors: error.errors,
          receivedArgs: args
        });
        return this.formatErrorOutput(`Validation error in ${this.metadata.name}: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}\nReceived args: ${JSON.stringify(args, null, 2)}`);
      }

      return {
        content: [{
          type: 'text',
          text: `Error executing ${this.metadata.name}: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }

  /**
   * Execute the tool implementation - must be implemented by subclasses
   */
  protected abstract executeImpl(args: MCPToolSchema<TSchema>): Promise<TResult>;

  /**
   * Helper to format output as text
   */
  protected formatTextOutput(text: string): MCPToolOutput {
    return {
      content: [{
        type: 'text',
        text
      }]
    };
  }

  /**
   * Helper to format JSON output
   */
  protected formatJsonOutput(data: TResult | unknown, pretty = false): MCPToolOutput {
    return {
      content: [{
        type: 'text',
        text: pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
      }]
    };
  }

  /**
   * Helper to format error output
   */
  protected formatErrorOutput(error: Error | string): MCPToolOutput {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : error}`
      }]
    };
  }

  /**
   * Convert Zod schema to JSON Schema (simplified version)
   */
  private zodToJsonSchema(schema: z.ZodType): any {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const properties: any = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodToJsonSchema(value as z.ZodType);

        // Check if field is required
        if (!(value as any).isOptional()) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      };
    }

    if (schema instanceof z.ZodString) {
      return { type: 'string' };
    }

    if (schema instanceof z.ZodNumber) {
      return { type: 'number' };
    }

    if (schema instanceof z.ZodBoolean) {
      return { type: 'boolean' };
    }

    if (schema instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodToJsonSchema(schema.element)
      };
    }

    if (schema instanceof z.ZodOptional) {
      return this.zodToJsonSchema(schema.unwrap());
    }

    if (schema instanceof z.ZodEnum) {
      return {
        type: 'string',
        enum: schema.options
      };
    }

    if (schema instanceof z.ZodUnion) {
      const options = (schema as any)._def.options;
      return {
        oneOf: options.map((opt: z.ZodType) => this.zodToJsonSchema(opt))
      };
    }

    // Default fallback
    return { type: 'string' };
  }
}
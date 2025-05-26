import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAvailableTools, searchTools } from '../../utils/toolRegistry.js';
import { registerMcpTool } from '../../utils/registerTool.js';

/**
 * Register basic utility tools with the MCP server
 */
export function registerBasicTools(server: McpServer) {
  // Echo tool
  registerMcpTool(
    server,
    'echo',
    { message: z.string() },
    async (args: { message: string }, extra: unknown) => {
      const result: MCPToolOutput = { content: [{ type: 'text', text: args.message }] };
      logger.info('[MCP TOOL] echo result', { args, result });
      return result;
    }
  );

  // List tools tool
  registerMcpTool(
    server,
    'listtools',
    { search: z.string().describe('Filter tools by name pattern. Pass an empty string to get all tools') },
    async (args: { search?: string }, extra: unknown) => {
      try {
        const tools = args.search ? searchTools(args.search) : getAvailableTools();
        const result: MCPToolOutput = { content: [{ type: 'text', text: JSON.stringify(tools) }] };
        logger.info('[MCP TOOL] listtools result', { args, toolCount: tools.length });
        return result;
      } catch (error) {
        logger.error('[MCP TOOL] listtools error', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        return { 
          content: [{ 
            type: 'text', 
            text: `Error listing tools: ${error instanceof Error ? error.message : String(error)}` 
          }] 
        };
      }
    }
  );
}

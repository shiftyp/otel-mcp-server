import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register basic utility tools with the MCP server
 */
export function registerBasicTools(server: McpServer) {
  // Echo tool
  server.tool(
    'echo',
    { message: z.string() },
    async (args, extra) => {
      const result: MCPToolOutput = { content: [{ type: 'text', text: args.message }] };
      logger.info('[MCP TOOL] echo result', { args, result });
      return result;
    }
  );

  // List tools
  server.tool(
    'listtools',
    { search: z.string().optional() },
    async (args: { search?: string } = {}) => {
      // Get the actual list of registered tools
      // @ts-ignore - getTools is available but not typed
      const registeredTools = server.getTools ? server.getTools() : [];
      const toolNames = registeredTools.map((tool: any) => tool.name);
      
      // Filter by search term if provided
      let filteredTools = toolNames;
      if (args.search) {
        const searchTerm = args.search.toLowerCase();
        filteredTools = toolNames.filter((name: string) => 
          name.toLowerCase().includes(searchTerm)
        );
      }
      
      const output: MCPToolOutput = { 
        content: [{ 
          type: 'text', 
          text: JSON.stringify(filteredTools, null, 2) 
        }] 
      };
      
      logger.info('[MCP TOOL] listtools result', { 
        searchTerm: args.search, 
        totalTools: toolNames.length,
        filteredTools: filteredTools.length
      });
      
      return output;
    }
  );
}

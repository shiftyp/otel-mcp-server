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

  // List tools
  registerMcpTool(
    server,
    'listtools',
    { search: z.string().optional() },
    async (args: { search?: string } = {}) => {
      // Get the list of available tools from the registry
      let toolList: string[];
      
      if (args.search) {
        // Search for tools matching the search term
        toolList = searchTools(args.search);
      } else {
        // Get all available tools
        toolList = getAvailableTools();
      }
      
      const output: MCPToolOutput = { 
        content: [{ 
          type: 'text', 
          text: JSON.stringify(toolList, null, 2) 
        }] 
      };
      
      logger.info('[MCP TOOL] listtools result', { 
        searchTerm: args.search, 
        totalTools: getAvailableTools().length,
        filteredTools: toolList.length
      });
      
      return output;
    }
  );
}

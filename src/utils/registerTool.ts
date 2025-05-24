/**
 * Tool Registration Utilities
 * 
 * This module provides utilities for registering tools with both the MCP server
 * and the tool registry.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool as addToRegistry } from './toolRegistry.js';
import { logger } from './logger.js';

/**
 * Register a tool with both the MCP server and the tool registry
 * 
 * @param server The MCP server instance
 * @param name The name of the tool
 * @param schema The schema for the tool's parameters
 * @param handler The handler function for the tool
 * @returns The result of registering the tool with the MCP server
 */
export function registerMcpTool(
  server: McpServer,
  name: string,
  schema: any,
  handler: any
): void {
  // Register the tool with the MCP server
  server.tool(name, schema, handler);
  
  // Register the tool with the registry
  addToRegistry(name);
  
  logger.debug('[ToolRegistry] Registered MCP tool', { name });
}

/**
 * Tool Registry - Keeps track of all registered MCP tools
 * 
 * This module provides a central registry for MCP tools, allowing tools to register themselves
 * and providing a way to query the list of available tools.
 */

import { logger } from './logger.js';

// The registry of available tools
const availableTools: Set<string> = new Set();

/**
 * Register a tool with the registry
 * @param toolName The name of the tool to register
 */
export function registerTool(toolName: string): void {
  if (!toolName) {
    logger.warn('[ToolRegistry] Attempted to register tool with empty name');
    return;
  }
  
  availableTools.add(toolName);
  logger.debug('[ToolRegistry] Registered tool', { toolName });
}

/**
 * Get a list of all registered tools
 * @returns Array of tool names
 */
export function getAvailableTools(): string[] {
  return Array.from(availableTools).sort();
}

/**
 * Check if a tool is registered
 * @param toolName The name of the tool to check
 * @returns True if the tool is registered, false otherwise
 */
export function isToolAvailable(toolName: string): boolean {
  return availableTools.has(toolName);
}

/**
 * Search for tools by name
 * @param searchTerm The search term to filter tools by
 * @returns Array of matching tool names
 */
export function searchTools(searchTerm: string): string[] {
  if (!searchTerm) {
    return getAvailableTools();
  }
  
  const term = searchTerm.toLowerCase();
  return getAvailableTools().filter(name => 
    name.toLowerCase().includes(term)
  );
}
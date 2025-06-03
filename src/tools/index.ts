/**
 * New tool registration system
 * This will eventually replace the current index.ts
 */

export { registerToolsWithMCPServer as registerAllTools } from './registration.js';
export { globalToolRegistry } from './base/registry.js';
export { BaseTool, ToolCategory } from './base/tool.js';

// Export all tool classes for direct use
export * from './query/index.js';
export * from './discovery/index.js';
export * from './analysis/index.js';
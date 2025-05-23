// This file provides a compatible type for MCP tool output content items for text, image, audio, resource, etc.
export type MCPToolContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { text: string; uri: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string } };

export type MCPToolOutput = {
  content: MCPToolContentItem[];
  _meta?: any;
  structuredContent?: any;
  isError?: boolean;
};

import z from "zod";

// This file provides a compatible type for MCP tool output content items for text, image, audio, resource, etc.
export type MCPToolContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { text: string; uri: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string } };

export type MCPToolOutput = {
  content: MCPToolContentItem[];
};

export type MCPToolSchema<TSchema extends Record<string, z.ZodType>> = {
  [key in keyof TSchema]: z.infer<TSchema[key]>;
};

// Service information from telemetry data
export interface ServiceInfo {
  name: string;
  type?: string;
  language?: string;
  framework?: string;
  version?: string;
  instances?: number;
  lastSeen?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

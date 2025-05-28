import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../utils/registerTool.js';

/**
 * Registers the spanDurationAnomaliesDetect tool with the MCP server.
 * Detects spans with unusually high durations (latency outliers).
 */
export function registerSpanDurationAnomaliesDetectTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'spanDurationAnomaliesDetect',
    {
      startTime: z.string().describe('Start time (ISO8601, required)'),
      endTime: z.string().describe('End time (ISO8601, required)'),
      service: z.string().optional().describe('Service name (optional)'),
      operation: z.string().optional().describe('Operation/span name (optional)'),
      thresholdType: z.enum(['p99', 'stddev']).default('p99').describe('Threshold type for anomaly detection'),
      maxResults: z.number().default(20).describe('Maximum number of anomalies to return'),
    },
    async (params: { startTime: string, endTime: string, service?: string, operation?: string, thresholdType?: string, maxResults?: number }) => {
      // Placeholder: implement ES query for latency outliers
      // Return structured anomaly results
      return {
        content: [
          { type: 'text', text: 'TODO: Implement span duration anomaly detection' }
        ]
      };
    }
  );
}


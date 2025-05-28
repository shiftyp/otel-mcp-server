import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { registerMcpTool } from '../utils/registerTool.js';

/**
 * Registers the metricAnomaliesDetect tool with the MCP server.
 * Detects anomalies in metric values (outliers, sudden changes).
 */
export function registerMetricAnomaliesDetectTool(server: McpServer, esAdapter: ElasticsearchAdapter) {
  registerMcpTool(
    server,
    'metricAnomaliesDetect',
    {
      startTime: z.string().describe('Start time (ISO8601, required)'),
      endTime: z.string().describe('End time (ISO8601, required)'),
      service: z.string().optional().describe('Service name (optional)'),
      metricName: z.string().optional().describe('Metric name (optional)'),
      thresholdType: z.enum(['p99', 'stddev']).default('stddev').describe('Threshold type for anomaly detection'),
      windowSize: z.number().default(10).describe('Window size for moving average/stddev'),
      maxResults: z.number().default(20).describe('Maximum number of anomalies to return'),
    },
    async (params: { startTime: string, endTime: string, service?: string, metricName?: string, thresholdType?: string, windowSize?: number, maxResults?: number }) => {
      // Placeholder: implement ES query for metric anomalies
      // Return structured anomaly results
      return {
        content: [
          { type: 'text', text: 'TODO: Implement metric anomaly detection' }
        ]
      };
    
    }
  );
}

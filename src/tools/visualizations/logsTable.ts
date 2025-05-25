import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';

/**
 * Tool for generating a logs table visualization.
 */
export class LogsTableTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Generate a logs table visualization
   * 
   * @param startTime Start time for logs query
   * @param endTime End time for logs query
   * @param pattern Optional text pattern to search for
   * @param serviceFilter Optional service or services to filter by
   * @param level Optional log level to filter by
   * @param fields Optional additional fields to include
   * @param maxRows Maximum number of rows to display
   * @param includeTraceLinks Whether to include trace links
   * @returns Markdown table representation of logs
   */
  public async generateLogsTable(
    startTime: string,
    endTime: string,
    pattern?: string,
    serviceFilter?: string | string[],
    level?: string,
    fields?: string[],
    maxRows: number = 20,
    includeTraceLinks: boolean = true
  ): Promise<MCPToolOutput> {
    try {
      logger.info('[LogsTableTool] Generating logs table', { 
        startTime, 
        endTime, 
        pattern, 
        serviceFilter, 
        level, 
        fields 
      });
      
      // Search OTEL logs in Elasticsearch
      const logs = await this.esAdapter.searchOtelLogs(pattern || '', serviceFilter, level, startTime, endTime);
      
      if (!logs.length) {
        const levelInfo = level ? ` with level "${level}"` : '';
        const patternInfo = pattern ? ` matching "${pattern}"` : '';
        return { content: [{ type: 'text', text: `No logs found${patternInfo}${levelInfo}.` }] } as MCPToolOutput;
      }
      
      // Limit the number of logs to display
      const limitedLogs = logs.slice(0, maxRows);
      
      // Define default fields to display
      const defaultFields = ['timestamp', 'service', 'level', 'message'];
      
      // Add additional fields if specified
      const fieldsToDisplay = [...defaultFields];
      if (includeTraceLinks) {
        fieldsToDisplay.push('trace_id');
      }
      if (fields && fields.length > 0) {
        // Add additional fields, avoiding duplicates
        fields.forEach(field => {
          if (!fieldsToDisplay.includes(field)) {
            fieldsToDisplay.push(field);
          }
        });
      }
      
      // Generate markdown table header
      let table = '| ' + fieldsToDisplay.join(' | ') + ' |\n';
      table += '| ' + fieldsToDisplay.map(() => '---').join(' | ') + ' |\n';
      
      // Generate table rows
      for (const log of limitedLogs) {
        const row: string[] = [];
        
        for (const field of fieldsToDisplay) {
          if (field === 'timestamp') {
            // Format timestamp for better readability
            const timestamp = log.timestamp ? new Date(log.timestamp).toISOString().replace('T', ' ').substring(0, 19) : '';
            row.push(timestamp);
          } else if (field === 'service') {
            // Use Resource.service.name if available, otherwise use service field
            let serviceName = log.service;
            
            // Check for service name in various possible locations and formats
            if (log.attributes && typeof log.attributes === 'object') {
              // Common variations of service name attribute
              const serviceNameKeys = [
                'Resource.service.name',
                'resource.service.name',
                'service.name',
                'Resource.service.namespace',
                'service',
                'service_name',
                'app',
                'application',
                'component',
                'k8s.pod.name',
                'Resource.k8s.pod.name',
                'Resource.k8s.deployment.name'
              ];
              
              // Try each possible key
              for (const key of serviceNameKeys) {
                if (log.attributes[key] && typeof log.attributes[key] === 'string') {
                  serviceName = log.attributes[key];
                  break;
                }
              }
            }
            
            row.push(serviceName || 'unknown');
          } else if (field === 'trace_id' && includeTraceLinks) {
            // Add trace link if available
            if (log.trace_id) {
              row.push(`[${log.trace_id.substring(0, 8)}...](trace:${log.trace_id})`);
            } else {
              row.push('-');
            }
          } else if (field === 'message') {
            // Truncate message if too long and escape pipe characters
            const message = log.message || '';
            const truncated = message.length > 100 ? message.substring(0, 97) + '...' : message;
            row.push(truncated.replace(/\|/g, '\\|'));
          } else if (field === 'attributes' && log.attributes) {
            // Format attributes as a compact JSON string
            row.push(JSON.stringify(log.attributes).substring(0, 100).replace(/\|/g, '\\|'));
          } else {
            // Handle any other field, including custom fields from attributes
            let value = log[field as keyof typeof log];
            
            // If the field is not directly on the log object, check attributes
            if (value === undefined && log.attributes && typeof log.attributes === 'object') {
              value = log.attributes[field];
            }
            
            // Format the value for display
            if (value === undefined || value === null) {
              row.push('-');
            } else if (typeof value === 'object') {
              row.push(JSON.stringify(value).substring(0, 50).replace(/\|/g, '\\|'));
            } else {
              row.push(String(value).replace(/\|/g, '\\|'));
            }
          }
        }
        
        table += '| ' + row.join(' | ') + ' |\n';
      }
      
      // Add a note if results were limited
      if (logs.length > maxRows) {
        table += `\n*Showing ${maxRows} of ${logs.length} logs. Use maxRows parameter to adjust.*`;
      }
      
      return { 
        content: [{ 
          type: 'text', 
          text: table
        }] 
      };
    } catch (error) {
      logger.error('[LogsTableTool] Error generating logs table', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      return { 
        content: [{ 
          type: 'text', 
          text: `Error generating logs table: ${error instanceof Error ? error.message : String(error)}` 
        }] 
      };
    }
  }
}

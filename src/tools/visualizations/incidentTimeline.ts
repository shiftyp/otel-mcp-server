import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';

/**
 * Tool for generating a timeline of events during an incident.
 * The timeline shows errors, warnings, and other significant events in chronological order.
 */
export class IncidentTimelineTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Generates a timeline visualization of events during an incident.
   *
   * @param startTime ISO8601 start of incident window
   * @param endTime ISO8601 end of incident window
   * @param services Optional array of services to include
   * @param maxEvents Maximum number of events to include in the timeline
   * @param query Optional query string to filter events
   * @returns Mermaid timeline diagram
   */
  async generateIncidentTimeline(
    startTime: string, 
    endTime: string, 
    services?: string[],
    maxEvents: number = 20,
    query?: string
  ): Promise<string> {
    try {
      // Build the Elasticsearch query
      const must: any[] = [
        {
          range: {
            '@timestamp': {
              gte: startTime,
              lte: endTime,
              format: 'strict_date_optional_time'
            }
          }
        },
        // Focus on logs with severity level warning or higher
        {
          bool: {
            should: [
              { term: { 'severity.text': 'ERROR' } },
              { term: { 'severity.text': 'WARN' } },
              { term: { 'level': 'error' } },
              { term: { 'level': 'warn' } },
              { term: { 'Severity': 'ERROR' } },
              { term: { 'Severity': 'WARN' } }
            ],
            minimum_should_match: 1
          }
        }
      ];
      
      // Add service filter if provided
      if (services && services.length > 0) {
        const serviceFilter: any = {
          bool: {
            should: services.map(service => ({
              bool: {
                should: [
                  { term: { 'Resource.service.name': service } },
                  { term: { 'resource.attributes.service.name': service } },
                  { term: { 'service.name': service } }
                ]
              }
            })),
            minimum_should_match: 1
          }
        };
        must.push(serviceFilter);
      }
      
      // Add custom query if provided
      if (query) {
        must.push({
          query_string: {
            query: query
          }
        });
      }
      
      // Query logs for incident events
      const result = await this.esAdapter.queryLogs({
        size: maxEvents,
        query: {
          bool: {
            must
          }
        },
        sort: [
          { '@timestamp': { order: 'asc' } }
        ]
      });
      
      if (!result.hits || !result.hits.hits || result.hits.hits.length === 0) {
        return 'No incident events found in the specified time range.';
      }
      
      // Extract events from the query result
      const events = result.hits.hits.map((hit: any) => {
        const source = hit._source;
        const timestamp = source['@timestamp'];
        const service = source['Resource.service.name'] || 
                        source['resource.attributes.service.name'] || 
                        source['service.name'] || 'unknown';
        const level = source['severity.text'] || 
                      source['level'] || 
                      source['Severity'] || 'INFO';
        const message = source['body'] || 
                        source['message'] || 
                        source['Body'] || 
                        'No message';
        
        return {
          timestamp,
          service,
          level,
          message: message.substring(0, 100) // Truncate long messages
        };
      });
      
      // Generate the Mermaid timeline diagram
      let mermaidDiagram = 'timeline\n';
      
      // Define event type
      interface IncidentEvent {
        timestamp: string;
        service: string;
        level: string;
        message: string;
      }
      
      // Group events by service
      const serviceGroups = new Map<string, IncidentEvent[]>();
      events.forEach((event: IncidentEvent) => {
        if (!serviceGroups.has(event.service)) {
          serviceGroups.set(event.service, []);
        }
        serviceGroups.get(event.service)?.push(event);
      });
      
      // Add each service section to the timeline
      serviceGroups.forEach((serviceEvents, service) => {
        mermaidDiagram += `    section ${service}\n`;
        
        // Add events for this service
        serviceEvents.forEach(event => {
          const date = new Date(event.timestamp);
          const formattedTime = date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit',
            second: '2-digit'
          });
          
          // Set color based on level
          let color = '';
          if (event.level.toUpperCase().includes('ERROR')) {
            color = ' : critical';
          } else if (event.level.toUpperCase().includes('WARN')) {
            color = ' : warning';
          }
          
          // Add the event to the timeline
          mermaidDiagram += `        ${formattedTime} : ${event.message.replace(/[:\n]/g, ' ')}${color}\n`;
        });
      });
      
      return mermaidDiagram;
    } catch (error) {
      logger.error('[IncidentTimelineTool] Error generating incident timeline', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}

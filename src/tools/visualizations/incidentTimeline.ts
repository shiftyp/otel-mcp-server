import { logger } from '../../utils/logger.js';
import type { MCPToolOutput } from '../../types.js';
import { ElasticsearchAdapter } from '../../adapters/elasticsearch/index.js';
import { escapeMermaidString } from '../../utils/mermaidEscaper.js';

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
   * Includes information from logs, traces, and metrics with correlation between related events.
   *
   * @param startTime ISO8601 start of incident window
   * @param endTime ISO8601 end of incident window
   * @param services Optional array of services to include
   * @param maxEvents Maximum number of events to include in the timeline
   * @param query Optional query string to filter events
   * @param includeTraces Whether to include trace anomalies (default: true)
   * @param includeMetrics Whether to include metric anomalies (default: true)
   * @param timeFormat Optional format for displaying time (uses date-fns format strings)
   * @param correlateEvents Whether to correlate related events across telemetry types (default: true)
   * @returns Mermaid timeline diagram
   */
  async generateIncidentTimeline(
    startTime: string, 
    endTime: string, 
    services?: string[],
    maxEvents: number = 20,
    query?: string,
    includeTraces: boolean = true,
    includeMetrics: boolean = true,
    timeFormat: string = 'HH:mm',
    correlateEvents: boolean = true,
    useRelativeTime: boolean = false
  ): Promise<string> {
    // Variables for relative time calculations
    let firstEventTime = 0;
    let lastEventTime = 0;
    let totalDuration = 0;
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
              { term: { 'SeverityText': 'ERROR' } },
              { term: { 'SeverityText': 'WARN' } },
              { term: { 'SeverityText': 'error' } },
              { term: { 'SeverityText': 'warn' } },
              // Keep legacy fields for backward compatibility
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
                  // Match service name fields with exact term
                  { term: { 'Resource.service.name': service } },
                  { term: { 'resource.attributes.service.name': service } },
                  { term: { 'service.name': service } },
                  
                  // Also match Kubernetes deployment name fields with exact term
                  { term: { 'kubernetes.deployment.name': service } },
                  { term: { 'k8s.deployment.name': service } }
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
      
      // Initialize events array
      let events: any[] = [];
      
      // Query logs for incident events
      const logResult = await this.esAdapter.queryLogs({
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
      
      // Add log events if found
      if (logResult.hits && logResult.hits.hits && logResult.hits.hits.length > 0) {
        const logEvents = logResult.hits.hits.map((hit: any) => {
          const source = hit._source;
          const timestamp = source['@timestamp'];
          const service = source['Resource.service.name'] || 
                          source['resource.attributes.service.name'] || 
                          source['service.name'] || 'unknown';
          const level = source['SeverityText'] || 
                        source['severity.text'] || 
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
            message: message.substring(0, 100), // Truncate long messages
            source: 'log'
          };
        });
        
        events = [...events, ...logEvents];
      }
      
      // Directly query for trace errors if trace inclusion is enabled
      if (includeTraces) {
        try {
          const traceResult = await this.esAdapter.queryTraces({
            size: maxEvents,
            query: {
              bool: {
                must: [
                  {
                    range: {
                      '@timestamp': {
                        gte: startTime,
                        lte: endTime
                      }
                    }
                  },
                  {
                    term: {
                      'TraceStatus': 2 // Error status
                    }
                  }
                ],
                should: services && services.length > 0 ? [
                  {
                    terms: {
                      'Resource.service.name': services
                    }
                  }
                ] : []
              }
            },
            sort: [
              { '@timestamp': { order: 'asc' } }
            ]
          });
          
          if (traceResult.hits && traceResult.hits.hits && traceResult.hits.hits.length > 0) {
            const traceEvents = traceResult.hits.hits.map((hit: any) => {
              const source = hit._source;
              const timestamp = source['@timestamp'];
              const service = source['Resource.service.name'] || 'unknown';
              const traceId = source['TraceId'] || '';
              const spanId = source['SpanId'] || '';
              const parentSpanId = source['ParentSpanId'] || '';
              const name = source['Name'] || 'unknown operation';
              const attributes = Object.keys(source)
                .filter(key => key.startsWith('Attributes.'))
                .reduce((obj: any, key) => {
                  const attrName = key.replace('Attributes.', '');
                  obj[attrName] = source[key];
                  return obj;
                }, {});
              
              // Extract error information
              const errorMsg = attributes['error.message'] || 
                              attributes['error'] || 
                              (attributes['http.status_code'] && parseInt(attributes['http.status_code']) >= 400) ? 
                                `HTTP ${attributes['http.status_code']}` : 
                                'Error in trace';
              
              // Create a minimal message with just operation name and IDs
              let message = `${name}`;
              
              // Add trace and span IDs
              message += ` [${traceId.substring(0, 8)}...][${spanId.substring(0, 8)}...]`;
              
              return {
                timestamp,
                service,
                level: 'ERROR',
                message,
                traceId,
                spanId,
                parentSpanId,
                source: 'trace'
              };
            });
            
            events = [...events, ...traceEvents];
          }
        } catch (error) {
          logger.warn('[IncidentTimelineTool] Error querying traces', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
      
      // If no events found, return early
      if (events.length === 0) {
        return 'No incident events found in the specified time range.';
      }
      
      // This code block is replaced by the new implementation above
      
      // If includeMetrics is true, add metric-based events
      if (includeMetrics) {
        try {
          // First try to use the detectMetricAnomalies tool if available
          try {
            // Import the AnomalyDetectionTool if it exists
            const AnomalyDetectionTool = require('../anomalyDetection').AnomalyDetectionTool;
            const anomalyDetector = new AnomalyDetectionTool(this.esAdapter);
            
            // Use the detectMetricAnomalies method to find real anomalies
            const anomalyResults = await anomalyDetector.detectMetricAnomalies(
              startTime, 
              endTime, 
              undefined, // metricField
              services, // serviceOrServices
              {
                zScoreThreshold: 2.5,
                percentileThreshold: 95,
                maxResults: maxEvents
              }
            );
            
            logger.info('[IncidentTimelineTool] Detected metric anomalies', { 
              anomalyCount: anomalyResults?.anomalies?.length || 0 
            });
            
            // Convert anomalies to timeline events
            if (anomalyResults?.anomalies?.length > 0) {
              const metricEvents = anomalyResults.anomalies.map((anomaly: any) => {
                const service = anomaly.service || 'unknown';
                const field = anomaly.field || anomaly.metricField || 'unknown';
                const value = anomaly.value !== undefined ? anomaly.value : 0;
                const formattedValue = typeof value === 'number' ? value.toFixed(2) : value;
                
                // Only skip anomalies with undefined values or extremely small values
                // We don't want to skip valid plateau anomalies or other anomalies with small deviations
                if (value === undefined || (typeof value === 'number' && Math.abs(value) < 0.0001)) {
                  return null;
                }
                
                // Create a more informative message
                let message = '';
                
                // Add metric name/field
                if (field && field !== 'unknown') {
                  // Extract the last part of the field name if it contains dots
                  const fieldParts = field.split('.');
                  const shortField = fieldParts[fieldParts.length - 1];
                  message = `${shortField}`;
                } else {
                  message = 'Metric';
                }
                
                // Add anomaly type if available
                if (anomaly.type) {
                  message += ` ${anomaly.type}`;
                } else {
                  message += ` anomaly`;
                }
                
                // Add value with appropriate formatting
                if (value !== undefined) {
                  // Format based on value magnitude
                  let displayValue;
                  if (Math.abs(value) >= 1000000) {
                    displayValue = (value / 1000000).toFixed(1) + 'M';
                  } else if (Math.abs(value) >= 1000) {
                    displayValue = (value / 1000).toFixed(1) + 'K';
                  } else if (Math.abs(value) >= 1) {
                    displayValue = value.toFixed(1);
                  } else {
                    displayValue = value.toFixed(3);
                  }
                  message += ` [${displayValue}]`;
                }
                
                // Add threshold info if available
                if (anomaly.threshold) {
                  message += ` (threshold: ${anomaly.threshold})`;
                }
                
                return {
                  timestamp: anomaly.timestamp,
                  service,
                  level: anomaly.severity || 'WARN',
                  message,
                  source: 'metric',
                  metricField: field // Store the field for deduplication
                };
              });
              
              // Filter out null events and deduplicate by metricField to reduce noise
              const validMetricEvents = metricEvents.filter((event: any) => event !== null);
              
              // Group by service and metricField to deduplicate
              const metricGroups = new Map<string, any[]>();
              validMetricEvents.forEach((event: any) => {
                const key = `${event.service}:${event.metricField}`;
                if (!metricGroups.has(key)) {
                  metricGroups.set(key, []);
                }
                metricGroups.get(key)?.push(event);
              });
              
              // Take only the most significant anomaly from each group
              const dedupedMetricEvents: any[] = [];
              metricGroups.forEach(groupEvents => {
                // Sort by timestamp (most recent first)
                groupEvents.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                // Only take the most recent event from each group
                dedupedMetricEvents.push(groupEvents[0]);
              });
              
              events.push(...dedupedMetricEvents);
            }
          } catch (error) {
            // If the anomaly detection tool isn't available or fails, fall back to basic metrics
            logger.warn('[IncidentTimelineTool] Anomaly detection unavailable, using basic metrics', { 
              error: error instanceof Error ? error.message : String(error) 
            });
          }
          
          // Fall back to basic metric query if anomaly detection fails or returns no results
          const metricResult = await this.esAdapter.queryMetrics({
            size: maxEvents,
            query: {
              bool: {
                must: [
                  {
                    range: {
                      '@timestamp': {
                        gte: startTime,
                        lte: endTime
                      }
                    }
                  }
                ]
              }
            },
            sort: [
              { '@timestamp': { order: 'asc' } }
            ]
          });
          
          if (metricResult.hits && metricResult.hits.hits && metricResult.hits.hits.length > 0) {
            const metricEvents = metricResult.hits.hits.map((hit: any) => {
              const source = hit._source;
              const timestamp = source['@timestamp'];
              
              // Extract service name from various possible fields
              let service = 'unknown';
              if (source['Resource'] && source['Resource'].service && source['Resource'].service.name) {
                service = source['Resource'].service.name;
              } else if (source['resource'] && source['resource'].attributes && source['resource'].attributes.service && source['resource'].attributes.service.name) {
                service = source['resource'].attributes.service.name;
              } else if (source['service'] && source['service'].name) {
                service = source['service'].name;
              } else if (source['Resource.service.name']) {
                service = source['Resource.service.name'];
              } else if (source['resource.attributes.service.name']) {
                service = source['resource.attributes.service.name'];
              } else if (source['service.name']) {
                service = source['service.name'];
              }
              
              // Extract field name
              let fieldName = 'unknown';
              if (source['field']) {
                fieldName = source['field'];
              } else if (source['name']) {
                fieldName = source['name'];
              } else if (source['Name']) {
                fieldName = source['Name'];
              } else if (source['metric'] && source['metric'].name) {
                fieldName = source['metric'].name;
              } else if (source['metric.name']) {
                fieldName = source['metric.name'];
              }
              
              // Get metric value
              let value = 0;
              if (source['value'] !== undefined) {
                value = source['value'];
              } else if (source['Value'] !== undefined) {
                value = source['Value'];
              } else if (source['metric'] && source['metric'].value !== undefined) {
                value = source['metric'].value;
              } else if (source['metric.value'] !== undefined) {
                value = source['metric.value'];
              }
              
              // Format the value if it's a number
              let formattedValue: string | number = value;
              if (typeof value === 'number' && !isNaN(value)) {
                formattedValue = value.toFixed(2);
              }
              
              // Skip metrics with zero or very small values as they're likely not meaningful
              if (value === 0 || (typeof value === 'number' && Math.abs(value) < 0.001)) {
                return null;
              }
              
              // Create a more informative message
              let message = '';
              
              // Add metric name/field
              if (fieldName && fieldName !== 'unknown') {
                // Extract the last part of the field name if it contains dots
                const fieldParts = fieldName.split('.');
                const shortField = fieldParts[fieldParts.length - 1];
                message = `${shortField}`;
              } else {
                message = 'Metric';
              }
              
              // Add anomaly indication
              message += ` spike`;
              
              // Add value with appropriate formatting
              if (value !== undefined) {
                // Format based on value magnitude
                let displayValue;
                if (Math.abs(value) >= 1000000) {
                  displayValue = (value / 1000000).toFixed(1) + 'M';
                } else if (Math.abs(value) >= 1000) {
                  displayValue = (value / 1000).toFixed(1) + 'K';
                } else if (Math.abs(value) >= 1) {
                  displayValue = value.toFixed(1);
                } else {
                  displayValue = value.toFixed(3);
                }
                message += ` [${displayValue}]`;
              }
              
              // Add unit if available
              const metricUnit = source['metric.unit'] || source['unit'] || '';
              if (metricUnit) {
                message += ` ${metricUnit}`;
              }
              
              return {
                timestamp,
                service,
                level: 'WARN',
                message,
                source: 'metric',
                metricField: fieldName // Store the field for deduplication
              };
            });
            
            // Filter out null events and deduplicate by metricField to reduce noise
            const validMetricEvents = metricEvents.filter((event: any) => event !== null);
            
            // Group by service and metricField to deduplicate
            const metricGroups = new Map<string, any[]>();
            validMetricEvents.forEach((event: any) => {
              const key = `${event.service}:${event.metricField}`;
              if (!metricGroups.has(key)) {
                metricGroups.set(key, []);
              }
              metricGroups.get(key)?.push(event);
            });
            
            // Take only the most significant anomaly from each group
            const dedupedMetricEvents: any[] = [];
            metricGroups.forEach(groupEvents => {
              // Sort by timestamp (most recent first)
              groupEvents.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
              // Only take the most recent event from each group
              dedupedMetricEvents.push(groupEvents[0]);
            });
            
            events.push(...dedupedMetricEvents);
          }
        } catch (error) {
          logger.error('[IncidentTimelineTool] Error querying metrics', { 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
        }
      }
      
      // If correlation is enabled, fetch trace data to correlate events
      if (includeTraces && correlateEvents) {
        try {
          // Query for trace data in the same time window
          const traceResult = await this.esAdapter.queryTraces({
            size: maxEvents * 2, // Get more traces to ensure we find correlations
            query: {
              bool: {
                must: [
                  {
                    range: {
                      '@timestamp': {
                        gte: startTime,
                        lte: endTime
                      }
                    }
                  }
                ]
              }
            },
            sort: [
              { '@timestamp': { order: 'asc' } }
            ]
          });
          
          if (traceResult.hits && traceResult.hits.hits && traceResult.hits.hits.length > 0) {
            // Extract trace IDs and span IDs for correlation
            const traceMap = new Map<string, any[]>(); // Map of trace ID to spans
            const spanMap = new Map<string, any>(); // Map of span ID to span
            
            traceResult.hits.hits.forEach((hit: any) => {
              const source = hit._source;
              const traceId = source['trace.id'] || source['traceId'] || '';
              const spanId = source['span.id'] || source['spanId'] || '';
              
              if (traceId) {
                if (!traceMap.has(traceId)) {
                  traceMap.set(traceId, []);
                }
                traceMap.get(traceId)?.push(source);
              }
              
              if (spanId) {
                spanMap.set(spanId, source);
              }
            });
            
            // Enhance events with trace correlation information
            events = events.map((event: any) => {
              // Check if this event has trace information
              const traceId = event.traceId || event.trace_id || event['trace.id'];
              const spanId = event.spanId || event.span_id || event['span.id'];
              
              if (traceId) {
                // This event is part of a trace, add correlation info
                const relatedSpans = traceMap.get(traceId) || [];
                if (relatedSpans.length > 0) {
                  // Count spans by service to identify distributed trace path
                  const serviceCount = new Map<string, number>();
                  relatedSpans.forEach(span => {
                    const spanService = span['service.name'] || 
                                      span['Resource.service.name'] || 
                                      span['resource.attributes.service.name'] || 
                                      'unknown';
                    serviceCount.set(spanService, (serviceCount.get(spanService) || 0) + 1);
                  });
                  
                  // Add trace correlation info to the message
                  const servicePath = Array.from(serviceCount.keys()).join(' → ');
                  event.message += ` [Trace: ${traceId.substring(0, 8)}... spans across ${servicePath}]`;
                  event.correlatedTraceId = traceId;
                }
              }
              
              return event;
            });
            
            // Group trace events by traceId to find related spans
            const traceGroups = new Map<string, any[]>();
            events.filter((event: any) => event.source === 'trace' && event.traceId)
              .forEach((event: any) => {
                if (!traceGroups.has(event.traceId)) {
                  traceGroups.set(event.traceId, []);
                }
                traceGroups.get(event.traceId)?.push(event);
              });
            
            // Enhance trace events with related span information
            traceGroups.forEach((traceEvents, traceId) => {
              if (traceEvents.length > 1) {
                // Create a map of services involved in this trace
                const services = new Set<string>();
                traceEvents.forEach(event => {
                  if (event.service && event.service !== 'unknown') {
                    services.add(event.service);
                  }
                });
                
                // Don't add any correlation information to the trace events
                traceEvents.forEach(event => {
                  event.relatedSpanCount = traceEvents.length - 1;
                });
              }
            });
            
            // Look for metric anomalies that occurred close to error events
            // This helps identify potential cause-effect relationships
            const errorEvents = events.filter((event: any) => 
              event.level.toUpperCase().includes('ERROR') || 
              event.level.toUpperCase().includes('CRITICAL'));
            
            const metricEvents = events.filter((event: any) => event.source === 'metric');
            
            // For each error, find metrics that happened within 5 minutes before
            errorEvents.forEach((errorEvent: any) => {
              const errorTime = new Date(errorEvent.timestamp).getTime();
              const relevantMetrics = metricEvents.filter((metricEvent: any) => {
                const metricTime = new Date(metricEvent.timestamp).getTime();
                const timeDiff = errorTime - metricTime;
                // Metric happened 0-5 minutes before the error
                return timeDiff >= 0 && timeDiff <= 5 * 60 * 1000;
              });
              
              // Don't add any correlation between metrics and errors
              if (relevantMetrics.length > 0) {
                // Just track the relationship internally without adding to the message
                errorEvent.correlatedMetrics = relevantMetrics.map((m: any) => m.message);
                
                // Don't add any correlation info to metric events
                relevantMetrics.forEach((metricEvent: any) => {
                  metricEvent.correlatedErrors = metricEvent.correlatedErrors || [];
                  metricEvent.correlatedErrors.push(errorEvent);
                });
              }
            });
            
            // Look for related errors across services that happened close in time
            // This helps identify cascading failures
            if (errorEvents.length > 1) {
              // Group errors by service
              const serviceErrors = new Map<string, any[]>();
              errorEvents.forEach(event => {
                if (!serviceErrors.has(event.service)) {
                  serviceErrors.set(event.service, []);
                }
                serviceErrors.get(event.service)?.push(event);
              });
              
              // If we have errors in multiple services, look for potential cascading failures
              if (serviceErrors.size > 1) {
                // Sort errors by timestamp
                const sortedErrors = errorEvents.sort((a, b) => 
                  new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                
                // For each error, find other errors that happened within 30 seconds after
                sortedErrors.forEach((sourceError, i) => {
                  const sourceTime = new Date(sourceError.timestamp).getTime();
                  const sourceService = sourceError.service;
                  
                  // Look at subsequent errors in different services
                  for (let j = i + 1; j < sortedErrors.length; j++) {
                    const targetError = sortedErrors[j];
                    const targetTime = new Date(targetError.timestamp).getTime();
                    const targetService = targetError.service;
                    
                    // If error is in a different service and happened within 30 seconds
                    // Just track the relationship internally without adding to the message
                    if (targetService !== sourceService && targetTime - sourceTime <= 30 * 1000) {
                      sourceError.cascadedTo = sourceError.cascadedTo || [];
                      targetError.cascadedFrom = targetError.cascadedFrom || [];
                      
                      sourceError.cascadedTo.push(targetService);
                      targetError.cascadedFrom.push(sourceService);
                    }
                  }
                });
              }
            }
          }
        } catch (error) {
          logger.warn('[IncidentTimelineTool] Error correlating traces', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
      
      // If no events found, return early
      if (events.length === 0) {
        return 'No incident events found in the specified time range.';
      }
      
      // Generate the Mermaid timeline diagram
      let mermaidDiagram = 'timeline\n';
      
      // Add title with correlation information and relative time precision
      let precisionInfo = '';
      if (useRelativeTime && totalDuration !== undefined) {
        if (totalDuration > 3600000) { // > 1 hour
          precisionInfo = ' (relative time - hours/minutes)';
        } else if (totalDuration > 300000) { // > 5 minutes
          precisionInfo = ' (relative time - minutes/seconds)';
        } else if (totalDuration > 10000) { // > 10 seconds
          precisionInfo = ' (relative time - seconds)';
        } else { // Very short incidents
          precisionInfo = ' (relative time - milliseconds)';
        }
      } else if (useRelativeTime) {
        precisionInfo = ' (relative time)';
      }
      
      mermaidDiagram += `title Incident Timeline${correlateEvents ? ' (with correlation)' : ''}${precisionInfo}\n`;
      
      // Group events by service
      const serviceGroups = new Map<string, any[]>();
      events.forEach((event: any) => {
        if (!serviceGroups.has(event.service)) {
          serviceGroups.set(event.service, []);
        }
        serviceGroups.get(event.service)?.push(event);
      });
      
      // Calculate the earliest and latest timestamp for relative time if needed
      if (useRelativeTime) {
        // Sort all events by timestamp and get the earliest one
        const sortedEvents = [...events].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        if (sortedEvents.length > 0) {
          firstEventTime = new Date(sortedEvents[0].timestamp).getTime();
          lastEventTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
          totalDuration = lastEventTime - firstEventTime;
        }
      }
      
      // Add each service section to the timeline
      serviceGroups.forEach((serviceEvents, service) => {
        // Escape service name for section header
        const escapedService = escapeMermaidString(service);
        mermaidDiagram += `    section ${escapedService}\n`;
        
        // Add events for this service
        serviceEvents.forEach(event => {
          const date = new Date(event.timestamp);
          let formattedTime;
          
          if (useRelativeTime) {
            // Calculate time difference from first event in seconds/minutes
            const timeDiff = date.getTime() - firstEventTime;
            
            // Adjust precision based on total duration of the incident
            if (totalDuration > 3600000) { // > 1 hour
              // Format as hours and minutes for long incidents
              const hours = Math.floor(timeDiff / (60 * 60 * 1000));
              const minutes = Math.floor((timeDiff % (60 * 60 * 1000)) / (60 * 1000));
              formattedTime = `+${hours}h${minutes}m`;
            } else if (totalDuration > 300000) { // > 5 minutes
              // Format as minutes and seconds for medium incidents
              const minutes = Math.floor(timeDiff / (60 * 1000));
              const seconds = Math.floor((timeDiff % (60 * 1000)) / 1000);
              formattedTime = `+${minutes}m${seconds}s`;
            } else if (totalDuration > 10000) { // > 10 seconds
              // Format as seconds for short incidents
              const seconds = Math.floor(timeDiff / 1000);
              const milliseconds = Math.floor((timeDiff % 1000) / 10); // Round to 2 digits
              formattedTime = `+${seconds}.${milliseconds.toString().padStart(2, '0')}s`;
            } else { // Very short incidents
              // Format as milliseconds for very short incidents
              const milliseconds = Math.floor(timeDiff);
              formattedTime = `+${milliseconds}ms`;
            }
          } else {
            // Use the specified time format
            formattedTime = date.toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit'
            });
            // Use escapeMermaidString for consistent escaping of all special characters
            formattedTime = escapeMermaidString(formattedTime);
          }
          
          // Set color based on level
          let color = '';
          if (event.level.toUpperCase().includes('ERROR')) {
            color = ' #58; critical';
          } else if (event.level.toUpperCase().includes('WARN')) {
            color = ' #58; warning';
          }
          
          // Add text labels instead of emojis to avoid rendering issues
          let icon = '';
          if (event.source === 'metric') {
            icon = 'Metric ';
          } else if (event.correlatedTraceId) {
            icon = 'Correlated ';
          } else if (event.level.toUpperCase().includes('ERROR')) {
            icon = 'Error ';
          } else {
            icon = 'Warning ';
          }
          
          // Use the escapeMermaidString utility to handle special characters and emojis
          let escapedMessage = escapeMermaidString(event.message);
          
          // Limit message length to avoid overwhelming the diagram
          if (escapedMessage.length > 100) {
            escapedMessage = escapedMessage.substring(0, 97) + '...';
          }
          
          mermaidDiagram += `        ${formattedTime} #58; ${icon}${escapedMessage}${color}\n`;
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

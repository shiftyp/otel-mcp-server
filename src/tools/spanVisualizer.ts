import { ElasticsearchAdapter } from '../adapters/elasticsearch/index.js';
import { logger } from '../utils/logger.js';

/**
 * Tool for visualizing spans and their relationships as Mermaid Gantt charts
 */
export class SpanVisualizerTool {
  private esAdapter: ElasticsearchAdapter;

  constructor(esAdapter: ElasticsearchAdapter) {
    this.esAdapter = esAdapter;
  }

  /**
   * Generate a Mermaid Gantt chart for a span and its connections
   * @param spanId The ID of the span to visualize
   * @param query Optional query to filter related spans
   * @returns Mermaid Gantt chart representation
   */
  async generateGanntChart(spanId: string, query?: string): Promise<string> {
    try {
      logger.info('[SpanVisualizer] Generating flowchart for span', { spanId, query });
      
      // Get the target span
      const span = await this.esAdapter.spanLookup(spanId);
      if (!span) {
        logger.warn('[SpanVisualizer] No span found', { spanId });
        return `No span found with ID: ${spanId}`;
      }
      
      logger.info('[SpanVisualizer] Found span', { 
        spanId, 
        name: span.Name,
        service: span.Resource?.service?.name
      });
      
      // Get the trace ID for this span
      const traceId = span.TraceId;
      if (!traceId) {
        logger.warn('[SpanVisualizer] Span has no trace ID', { spanId });
        return `Span ${spanId} does not have a trace ID`;
      }
      
      // Get all spans in this trace
      const allSpans = await this.getSpansForTrace(traceId, query);
      if (!allSpans || allSpans.length === 0) {
        logger.warn('[SpanVisualizer] No spans found for trace', { traceId });
        return `No spans found for trace ID: ${traceId}`;
      }
      
      logger.info('[SpanVisualizer] Building flowchart', { 
        spanId, 
        traceId, 
        spanCount: allSpans.length 
      });
      
      // Build the Mermaid Gantt chart
      const ganttChart = this.buildMermaidGanttChart(span, allSpans);
      logger.info('[SpanVisualizer] Gantt chart generated successfully');
      return ganttChart;
    } catch (error) {
      logger.error('[SpanVisualizer] Error generating flowchart', { 
        spanId, 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return `Error generating flowchart: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  
  /**
   * Get all spans for a trace, optionally filtered by a query
   */
  private async getSpansForTrace(traceId: string, query?: string): Promise<any[]> {
    logger.info('[SpanVisualizer] Getting spans for trace', { traceId, query });
    
    // Build the Elasticsearch query
    const esQuery: any = {
      size: 1000,
      query: {
        bool: {
          must: [
            { term: { 'TraceId.keyword': traceId } }
          ]
        }
      },
      sort: [
        { 'Resource.service.name.keyword': { order: 'asc' } },
        { 'Name.keyword': { order: 'asc' } }
      ]
    };
    
    // Add additional query if provided
    if (query && query.trim() !== '') {
      esQuery.query.bool.must.push({
        query_string: {
          query: query
        }
      });
    }
    
    logger.info('[SpanVisualizer] Executing trace query', { esQuery });
    
    // Execute the query
    const response = await this.esAdapter.queryTraces(esQuery);
    
    // Extract and return the spans
    const spans = response.hits?.hits?.map((hit: any) => hit._source) || [];
    logger.info('[SpanVisualizer] Found spans for trace', { traceId, count: spans.length });
    
    return spans;
  }
  
  /**
   * Build a Mermaid Gantt chart from spans
   */
  private buildMermaidGanttChart(targetSpan: any, allSpans: any[]): string {
    // Log more detailed information about spans for debugging
    if (allSpans.length > 0) {
      // Log the first span's structure
      logger.info('[SpanVisualizer] Sample span structure', { 
        spanId: allSpans[0].SpanId,
        fields: Object.keys(allSpans[0]),
        startTime: allSpans[0].StartTimeUnixNano,
        endTime: allSpans[0].EndTimeUnixNano
      });
      
      // Log timestamp information for all spans to debug timing issues
      const spanTimings = allSpans.map(span => ({
        spanId: span.SpanId,
        name: span.Name,
        startTime: span.StartTimeUnixNano,
        endTime: span.EndTimeUnixNano,
        duration: span.EndTimeUnixNano && span.StartTimeUnixNano ? 
          (span.EndTimeUnixNano - span.StartTimeUnixNano) / 1_000_000 : 'unknown' // in ms
      }));
      logger.info('[SpanVisualizer] Span timings', { spanTimings });
    }
    
    // Start building the Mermaid Gantt chart
    const mermaidLines = ['gantt'];
    mermaidLines.push('  dateFormat X');  // Use Unix timestamp format
    mermaidLines.push('  axisFormat %s');  // Show seconds on axis
    mermaidLines.push('  title Trace Timeline');
    
    // Add comments for the chart
    mermaidLines.push('  %% Trace visualization chart');
    
    // Check if we have timestamp data in nanoseconds or microseconds
    // OTEL can use either depending on the source
    let isNanoseconds = true;
    if (allSpans.length > 0) {
      // If timestamps are very large (> 10^18), they're likely nanoseconds
      // If they're around 10^15, they're likely microseconds
      // If they're around 10^12, they're likely milliseconds
      const sampleTime = allSpans[0].StartTimeUnixNano || 0;
      if (sampleTime > 0 && sampleTime < 10_000_000_000_000_000) {
        isNanoseconds = false;
        logger.info('[SpanVisualizer] Detected non-nanosecond timestamps', { sampleTime });
      }
    }
    
    // Check if we have Duration field in nanoseconds
    let hasDurationInNanos = false;
    for (const span of allSpans) {
      if (span.Duration && typeof span.Duration === 'number') {
        // If Duration is very small (< 1000), it might be in milliseconds
        // If it's larger, it's likely in nanoseconds
        hasDurationInNanos = span.Duration > 1000;
        logger.info('[SpanVisualizer] Detected duration format', { 
          duration: span.Duration, 
          inNanoseconds: hasDurationInNanos 
        });
        break;
      }
    }
    
    // Convert all timestamps to a consistent format (nanoseconds)
    for (const span of allSpans) {
      if (!isNanoseconds && span.StartTimeUnixNano) {
        // Convert to nanoseconds if needed
        span.StartTimeUnixNano = span.StartTimeUnixNano * 1000;
      }
      if (!isNanoseconds && span.EndTimeUnixNano) {
        span.EndTimeUnixNano = span.EndTimeUnixNano * 1000;
      }
    }
    
    // Sort spans by start time
    allSpans.sort((a, b) => {
      const aStartTime = a.StartTimeUnixNano || 0;
      const bStartTime = b.StartTimeUnixNano || 0;
      return aStartTime - bStartTime;
    });
    
    // Find the earliest and latest start times to calculate the time range
    let earliestTime = Number.MAX_SAFE_INTEGER;
    let latestTime = 0;
    let latestEndTime = 0;
    
    for (const span of allSpans) {
      if (span.StartTimeUnixNano && typeof span.StartTimeUnixNano === 'number' && !isNaN(span.StartTimeUnixNano)) {
        if (span.StartTimeUnixNano < earliestTime) {
          earliestTime = span.StartTimeUnixNano;
        }
        if (span.StartTimeUnixNano > latestTime) {
          latestTime = span.StartTimeUnixNano;
        }
      }
      
      if (span.EndTimeUnixNano && typeof span.EndTimeUnixNano === 'number' && !isNaN(span.EndTimeUnixNano)) {
        if (span.EndTimeUnixNano > latestEndTime) {
          latestEndTime = span.EndTimeUnixNano;
        }
      }
    }
    
    // If we couldn't find a valid earliest time, default to 0
    if (earliestTime === Number.MAX_SAFE_INTEGER) {
      earliestTime = 0;
    }
    
    // Calculate the total trace duration in seconds
    const totalTraceDuration = (latestEndTime - earliestTime) / 1_000_000_000;
    const timeRange = (latestTime - earliestTime) / 1_000_000_000;
    
    logger.info('[SpanVisualizer] Trace time range', { 
      earliestTime, 
      latestTime, 
      latestEndTime,
      timeRangeSeconds: timeRange,
      totalDurationSeconds: totalTraceDuration
    });
    
    // Log the reference time
    logger.info('[SpanVisualizer] Reference time', { earliestTime });
    
    // Group spans by service
    const serviceSpans = new Map<string, any[]>();
    for (const span of allSpans) {
      const service = this.getServiceName(span);
      if (!serviceSpans.has(service)) {
        serviceSpans.set(service, []);
      }
      const spans = serviceSpans.get(service) || [];
      spans.push(span);
      serviceSpans.set(service, spans);
    }
    
    // Create a map of task IDs for each span for linking
    const spanTaskIds = new Map<string, string>();
    for (const span of allSpans) {
      const spanId = span.SpanId;
      const taskId = this.sanitizeId(`task_${spanId.substring(0, 8)}`);
      spanTaskIds.set(spanId, taskId);
    }
    
    // Add spans grouped by service
    for (const [service, spans] of serviceSpans.entries()) {
      mermaidLines.push(`  section ${service}`);
      
      for (const span of spans) {
        const name = span.Name || 'unnamed';
        const spanId = span.SpanId;
        const parentSpanId = span.ParentSpanId;
        
        // Calculate relative times in seconds, handling potential NaN values
        let startTime = 0;
        // Default to a small duration if we can't calculate it properly
        let duration = 0.1; // Default 100ms duration
        
        if (span.StartTimeUnixNano && typeof span.StartTimeUnixNano === 'number' && !isNaN(span.StartTimeUnixNano)) {
          startTime = (span.StartTimeUnixNano - earliestTime) / 1_000_000_000; // to seconds
        }
        
        // Try different approaches to get duration
        if (span.Duration && typeof span.Duration === 'number' && !isNaN(span.Duration)) {
          // If duration is directly available
          if (hasDurationInNanos) {
            duration = span.Duration / 1_000_000_000; // Convert from ns to seconds
          } else {
            // Assume it's in milliseconds
            duration = span.Duration / 1000; // Convert from ms to seconds
          }
          
          logger.info('[SpanVisualizer] Using explicit duration for span', { 
            spanId: span.SpanId, 
            name: span.Name, 
            rawDuration: span.Duration, 
            calculatedDuration: duration 
          });
        } else if (span.EndTimeUnixNano && typeof span.EndTimeUnixNano === 'number' && !isNaN(span.EndTimeUnixNano)) {
          const endTime = (span.EndTimeUnixNano - earliestTime) / 1_000_000_000;
          if (endTime > startTime) {
            duration = endTime - startTime;
            logger.info('[SpanVisualizer] Calculated duration from timestamps', { 
              spanId: span.SpanId, 
              name: span.Name, 
              startTime, 
              endTime, 
              calculatedDuration: duration 
            });
          }
        }
        
        // Ensure start time is properly scaled to show the actual timing relationships
        // This helps when the total trace duration is large but differences in start times are small
        const normalizedStartTime = startTime;
        
        logger.info('[SpanVisualizer] Start time for span', {
          spanId: span.SpanId,
          name: span.Name,
          rawStartTimeNano: span.StartTimeUnixNano,
          relativeStartTime: startTime,
          normalizedStartTime
        });
        
        // Ensure spans have different start times for visualization
        // This helps when spans appear to start at the same time
        const spanIndex = allSpans.indexOf(span);
        if (spanIndex > 0) {
          const prevSpan = allSpans[spanIndex - 1];
          const prevStartTime = (prevSpan.StartTimeUnixNano - earliestTime) / 1_000_000_000;
          
          // If this span starts at the same time as the previous one,
          // add a tiny offset to make them visually distinct
          if (Math.abs(startTime - prevStartTime) < 0.0001) {
            startTime += 0.0001 * spanIndex;
          }
        }
        
        // Check for circular dependencies where a child appears to start after its parent ends
        // or where a child is a parent of its own parent
        const isCircularDependency = (span: any, parentSpanId: string): boolean => {
          const parentSpan = allSpans.find(s => s.SpanId === parentSpanId);
          if (!parentSpan) return false;
          
          // Case 1: Child starts after parent ends
          const parentEndTime = parentSpan.EndTimeUnixNano || (parentSpan.StartTimeUnixNano + (parentSpan.Duration || 0));
          const childStartsAfterParentEnds = span.StartTimeUnixNano > parentEndTime;
          
          // Case 2: Circular reference in the span hierarchy
          const isParentOfParent = (childSpan: any, potentialDescendantId: string): boolean => {
            // If this child's parent is the potential descendant, we have a circular reference
            if (childSpan.ParentSpanId === potentialDescendantId) return true;
            
            // Otherwise, check if any of this child's ancestors is the potential descendant
            const childParent = allSpans.find(s => s.SpanId === childSpan.ParentSpanId);
            if (!childParent) return false;
            
            return isParentOfParent(childParent, potentialDescendantId);
          };
          
          const circularReference = isParentOfParent(parentSpan, span.SpanId);
          
          return childStartsAfterParentEnds || circularReference;
        };
        
        // Format the display name with parent relationship indicator
        let relationshipIndicator = '';
        let circularRef = false;
        
        if (parentSpanId) {
          // Check if this is a circular reference
          circularRef = isCircularDependency(span, parentSpanId);
          
          if (circularRef) {
            // For circular references, show a different indicator
            const parentShortId = this.shortenId(parentSpanId);
            relationshipIndicator = ` ⟲ ${parentShortId}`; // Circular arrow
          } else {
            // Normal parent-child relationship
            const parentShortId = this.shortenId(parentSpanId);
            relationshipIndicator = ` ← ${parentShortId}`;
          }
        }
        
        // Determine if this is the target span and set marker accordingly
        let targetMarker = '';
        let displayName = `${name} [${this.shortenId(spanId)}${relationshipIndicator}]`;
        
        if (spanId === targetSpan.SpanId) {
          displayName = `${name} [${this.shortenId(spanId)}${relationshipIndicator}] (TARGET)`;
          targetMarker = 'crit,';
        }
        
        // Add dependency information if available
        let dependency = '';
        if (parentSpanId) {
          // Find the task ID of the parent span to create a dependency
          dependency = ` after ${parentSpanId.substring(0, 8)}`;
        }
        
        // Add the span as a task
        // Format: task_name :modifier, start_time, duration
        // Use a sanitized ID for the task
        const taskId = this.sanitizeId(`task_${spanId.substring(0, 8)}`);
        
        // For Gantt charts in Mermaid, we need to use a specific format
        // Make sure start is at least 0.001 to avoid invalid date issues
        const safeStart = Math.max(startTime, 0.001);
        
        // Handle timing relationships between spans
        let startSyntax = '';
        
        if (parentSpanId) {
          // Find the parent span in our map
          const parentSpan = allSpans.find(s => s.SpanId === parentSpanId);
          
          if (parentSpan && !circularRef) {
            // Normal case: child starts during or after parent starts
            const parentTaskId = this.sanitizeId(`task_${parentSpanId.substring(0, 8)}`);
            startSyntax = `after ${parentTaskId}`;
          } else {
            // Either parent not found or we have a circular dependency
            // Use the actual start time instead of a dependency
            startSyntax = `after ${safeStart.toFixed(3)}s`;
            
            // Log the issue for debugging
            if (parentSpan && circularRef) {
              logger.warn('[SpanVisualizer] Circular dependency detected', {
                spanId: span.SpanId,
                parentSpanId,
                spanStart: new Date(span.StartTimeUnixNano / 1_000_000).toISOString(),
                parentEnd: new Date(parentSpan.EndTimeUnixNano / 1_000_000).toISOString()
              });
            }
          }
        } else {
          // Root span - use the actual start time
          startSyntax = `after ${safeStart.toFixed(3)}s`;
        }
        
        // Use a minimum duration to ensure visibility, but only if the actual duration is very small
        const minDuration = 0.001; // 1ms minimum for visibility
        const visibleDuration = duration < minDuration ? minDuration : duration;
        
        logger.info('[SpanVisualizer] Final timing for span', { 
          spanId: span.SpanId, 
          name: span.Name, 
          startTime: safeStart,
          duration: visibleDuration,
          startSyntax
        });
        
        // Add the span as a task
        mermaidLines.push(`    ${displayName} :${targetMarker}${taskId}, ${startSyntax}, ${visibleDuration.toFixed(3)}s`);
        
        // Add click handler for the span to enable navigation
        // Include more detailed information in the tooltip
        // For Mermaid, we need to escape special characters and use a single line
        const tooltipInfo = [
          `Span ID: ${spanId}`,
          `Name: ${name}`,
          `Service: ${service}`,
          `Duration: ${visibleDuration.toFixed(3)}s`,
          parentSpanId ? `Parent: ${parentSpanId.substring(0, 8)}` : 'Root Span'
          // Removing these fields to simplify tooltip and avoid syntax errors
          // span.Kind ? `Kind: ${span.Kind}` : '',
          // span.TraceId ? `Trace ID: ${span.TraceId}` : ''
        ].filter(Boolean).join(' | ');
        
        // Escape any quotes in the tooltip to avoid syntax errors
        const escapedTooltip = tooltipInfo.replace(/"/g, '\\"');
        mermaidLines.push(`  click ${taskId} href "#" "${escapedTooltip}"`);
        
        // Add visual distinction for the target span and error spans using the task name
        if (spanId === targetSpan.SpanId) {
          // Already using crit marker for target span
        } else if (span.TraceStatus && span.TraceStatus !== 0) {
          // Add 'ERROR' to the display name for error spans
          mermaidLines.push(`    %% Error span: ${spanId}`);
        }
      }
    }
    
    // Add a section for additional information
    mermaidLines.push('  section Info');
    const targetName = targetSpan.Name || 'unnamed';
    mermaidLines.push(`    Target: ${targetName} :milestone, after 0.001s, 0.001s`);
    
    // Add explicit links between spans and their parents
    mermaidLines.push('  %% Explicit links between spans and their parents');
    for (const span of allSpans) {
      const spanId = span.SpanId;
      const parentSpanId = span.ParentSpanId;
      
      if (parentSpanId) {
        const spanTaskId = spanTaskIds.get(spanId);
        const parentTaskId = spanTaskIds.get(parentSpanId);
        
        if (spanTaskId && parentTaskId) {
          // We don't add these as visible links because they would clutter the chart
          // But we record them as comments for documentation
          mermaidLines.push(`  %% Link from ${parentTaskId} to ${spanTaskId}`);
        }
      }
    }
    
    return mermaidLines.join('\n');
  }

  /**
   * Get service name from a span
   */
  private getServiceName(span: any): string {
    if (span['Resource.service.name']) {
      return span['Resource.service.name'];
    } else if (span.Resource?.service?.name) {
      return span.Resource.service.name;
    } else if (span.Scope?.name) {
      return span.Scope.name;
    }
    return 'unknown';
  }

  /**
   * Sanitize a string to be used as a Mermaid ID
   */
  private sanitizeId(id: string): string {
    // Replace non-alphanumeric characters with underscores
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }
  
  // Create a shortened ID for display purposes
  private shortenId(id: string): string {
    return id ? id.substring(0, 8) : 'unknown';
  }
}

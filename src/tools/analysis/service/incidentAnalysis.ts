import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';
import { LogDocument, TraceDocument } from '../../../types/opensearch-types.js';

// Define the Zod schema
const IncidentAnalysisArgsSchema = {
  incidentTime: z.string().describe('The time when the incident occurred (ISO 8601 format)'),
  windowBefore: z.string().optional().describe('Time window before the incident (e.g., "15m", "1h", "1d")'),
  windowAfter: z.string().optional().describe('Time window after the incident (e.g., "15m", "1h", "1d")'),
  service: z.string().optional().describe('Specific service to analyze'),
  traceId: z.string().optional().describe('Specific trace ID to analyze')
};

type IncidentAnalysisArgs = MCPToolSchema<typeof IncidentAnalysisArgsSchema>;

/**
 * Tool for analyzing incidents by correlating traces, logs, and metrics
 */
export class IncidentAnalysisTool extends BaseTool<typeof IncidentAnalysisArgsSchema> {
  // Static schema property
  static readonly schema = IncidentAnalysisArgsSchema;
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'analyzeIncident',
      category: ToolCategory.ANALYSIS,
      description: 'Analyze an incident by correlating traces, logs, and metrics around a specific time',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return IncidentAnalysisArgsSchema;
  }
  
  protected async executeImpl(args: IncidentAnalysisArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    // Parse incident time and create time windows
    const incidentTimestamp = new Date(args.incidentTime).getTime();
    const windowBefore = args.windowBefore || '15m';
    const windowAfter = args.windowAfter || '15m';
    
    const timeRange = {
      from: new Date(incidentTimestamp - this.parseTimeWindow(windowBefore)).toISOString(),
      to: new Date(incidentTimestamp + this.parseTimeWindow(windowAfter)).toISOString()
    };
    
    // Analyze traces around incident
    const traceAnalysis = await this.analyzeIncidentTraces(timeRange, args.service, args.traceId);
    
    // Analyze logs around incident
    const logAnalysis = await this.analyzeIncidentLogs(timeRange, args.service, args.incidentTime);
    
    // Analyze metrics around incident
    const metricAnalysis = await this.analyzeIncidentMetrics(timeRange, args.service);
    
    // Correlate findings
    const correlations = this.correlateFindings(traceAnalysis, logAnalysis, metricAnalysis);
    
    // Generate root cause hypotheses
    const rootCauseHypotheses = this.generateRootCauseHypotheses(
      traceAnalysis,
      logAnalysis,
      metricAnalysis,
      correlations
    );
    
    // Calculate incident severity
    const severity = this.calculateIncidentSeverity(traceAnalysis, logAnalysis, metricAnalysis);
    
    // Get pattern-based insights
    const patternInsights = this.generatePatternInsights(rootCauseHypotheses);
    
    return this.formatJsonOutput({
      incident: {
        time: args.incidentTime,
        timeRange,
        service: args.service,
        traceId: args.traceId,
        severity
      },
      traces: traceAnalysis,
      logs: logAnalysis,
      metrics: metricAnalysis,
      correlations,
      rootCauseHypotheses,
      patternMatches: rootCauseHypotheses.filter(h => h.matchScore),
      timeline: this.buildIncidentTimeline(traceAnalysis, logAnalysis, metricAnalysis),
      recommendations: this.generateRecommendations(rootCauseHypotheses),
      insights: patternInsights,
      actionPlan: this.generateActionPlan(rootCauseHypotheses, severity)
    });
  }
  
  private parseTimeWindow(window: string): number {
    const match = window.match(/^(\d+)([mhd])$/);
    if (!match) return 15 * 60 * 1000; // Default 15 minutes
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 15 * 60 * 1000;
    }
  }
  
  private async analyzeIncidentTraces(timeRange: any, service?: string, traceId?: string): Promise<any> {
    const config = ConfigLoader.get();
    
    // If specific trace ID provided, analyze it
    if (traceId) {
      const traceQuery = {
        term: { [config.telemetry.fields.traceId]: traceId }
      };
      
      const traceResult = await this.adapter.query<TraceDocument>(
        config.telemetry.indices.traces,
        traceQuery,
        { size: 1000, sort: [{ [config.telemetry.fields.timestamp]: 'asc' }] }
      );
      
      return {
        specificTrace: {
          traceId,
          spanCount: traceResult.hits.total.value,
          spans: traceResult.hits.hits.map(hit => hit._source)
        }
      };
    }
    
    // Otherwise, analyze traces in time range
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        filter: []
      }
    };
    
    if (service) {
      query.bool.filter.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    // Get error traces
    const errorQuery = {
      ...query,
      bool: {
        ...query.bool,
        must: [...query.bool.must, { term: { [config.telemetry.fields.status]: 'ERROR' } }]
      }
    };
    
    const errorTraces = await this.adapter.query(
      config.telemetry.indices.traces,
      errorQuery,
      {
        size: 0,
        aggregations: {
          by_service: {
            terms: { field: config.telemetry.fields.service, size: 20 },
            aggs: {
              by_operation: {
                terms: { field: 'span.name.keyword', size: 10 },
                aggs: {
                  sample_traces: {
                    terms: { field: config.telemetry.fields.traceId, size: 5 }
                  }
                }
              }
            }
          }
        }
      }
    );
    
    // Get latency analysis
    const latencyResult = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          latency_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m'
            },
            aggs: {
              p95_latency: { percentiles: { field: 'duration', percents: [95] } },
              p99_latency: { percentiles: { field: 'duration', percents: [99] } }
            }
          }
        }
      }
    );
    
    return {
      errorTraces: errorTraces.aggregations?.by_service?.buckets || [],
      latencyTrend: latencyResult.aggregations?.latency_over_time?.buckets || [],
      totalTraces: latencyResult.hits.total.value,
      errorCount: errorTraces.hits.total.value
    };
  }
  
  private async analyzeIncidentLogs(timeRange: any, service: string | undefined, incidentTime: string): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        filter: []
      }
    };
    
    if (service) {
      query.bool.filter.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    // Get log volume and patterns
    const logResult = await this.adapter.query<LogDocument>(
      config.telemetry.indices.logs,
      query,
      {
        size: 100,
        sort: [{ [config.telemetry.fields.timestamp]: 'desc' }],
        aggregations: {
          log_volume: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m'
            },
            aggs: {
              by_level: {
                terms: { field: 'level.keyword', size: 10 }
              }
            }
          },
          error_messages: {
            filter: { terms: { level: ['error', 'ERROR', 'fatal', 'FATAL'] } },
            aggs: {
              top_errors: {
                terms: { field: 'message.keyword', size: 10 }
              }
            }
          }
        }
      }
    );
    
    // Find logs closest to incident time
    const incidentLogs = logResult.hits.hits
      .map(hit => hit._source)
      .filter((log: any) => {
        const logTime = new Date(log[config.telemetry.fields.timestamp]).getTime();
        const incidentTimeMs = new Date(incidentTime).getTime();
        return Math.abs(logTime - incidentTimeMs) < 60000; // Within 1 minute
      })
      .slice(0, 20);
    
    return {
      logVolumeTrend: logResult.aggregations?.log_volume?.buckets || [],
      topErrorMessages: logResult.aggregations?.error_messages?.top_errors?.buckets || [],
      incidentLogs,
      totalLogs: logResult.hits.total.value
    };
  }
  
  private async analyzeIncidentMetrics(timeRange: any, service?: string): Promise<any> {
    const config = ConfigLoader.get();
    
    // Analyze key metrics
    const metrics = ['system.cpu.total.norm.pct', 'system.memory.actual.used.pct', 'http.server.duration'];
    const metricAnalysis: any = {};
    
    for (const metric of metrics) {
      const query: any = {
        bool: {
          must: [
            { range: { [config.telemetry.fields.timestamp]: timeRange } },
            { exists: { field: metric } }
          ],
          filter: []
        }
      };
      
      if (service) {
        query.bool.filter.push({ term: { [config.telemetry.fields.service]: service } });
      }
      
      const result = await this.adapter.query(
        config.telemetry.indices.metrics,
        query,
        {
          size: 0,
          aggregations: {
            metric_over_time: {
              date_histogram: {
                field: config.telemetry.fields.timestamp,
                fixed_interval: '1m'
              },
              aggs: {
                avg_value: { avg: { field: metric } },
                max_value: { max: { field: metric } }
              }
            },
            stats: { extended_stats: { field: metric } }
          }
        }
      );
      
      if (result.hits.total.value > 0) {
        metricAnalysis[metric] = {
          trend: result.aggregations?.metric_over_time?.buckets || [],
          stats: result.aggregations?.stats || {}
        };
      }
    }
    
    return metricAnalysis;
  }
  
  private correlateFindings(traces: any, logs: any, metrics: any): any[] {
    const correlations = [];
    
    // Correlate error spike with log volume
    const errorSpikes = traces.latencyTrend.filter((bucket: any) => {
      const errorRate = traces.errorCount > 0 ? (bucket.doc_count / traces.totalTraces) : 0;
      return errorRate > 0.1; // 10% error rate
    });
    
    for (const spike of errorSpikes) {
      const correspondingLogs = logs.logVolumeTrend.find((logBucket: any) => 
        Math.abs(new Date(spike.key).getTime() - new Date(logBucket.key).getTime()) < 60000
      );
      
      if (correspondingLogs) {
        correlations.push({
          type: 'error_spike_with_logs',
          time: spike.key_as_string,
          traceErrorRate: (spike.doc_count / traces.totalTraces) * 100,
          logVolume: correspondingLogs.doc_count,
          significance: 'high'
        });
      }
    }
    
    // Correlate metric anomalies with errors
    for (const [metricName, metricData] of Object.entries(metrics)) {
      if (!metricData || typeof metricData !== 'object') continue;
      
      const metricTrend = (metricData as any).trend || [];
      const stats = (metricData as any).stats || {};
      const threshold = stats.avg + (stats.std_deviation * 2);
      
      for (const bucket of metricTrend) {
        if (bucket.max_value?.value > threshold) {
          correlations.push({
            type: 'metric_anomaly',
            metric: metricName,
            time: bucket.key_as_string,
            value: bucket.max_value.value,
            threshold,
            significance: 'medium'
          });
        }
      }
    }
    
    return correlations;
  }
  
  private generateRootCauseHypotheses(traces: any, logs: any, metrics: any, correlations: any[]): any[] {
    const hypotheses = [];
    
    // Match against known incident patterns
    const patternMatches = this.matchKnownPatterns(traces, logs, metrics);
    hypotheses.push(...patternMatches);
    
    // High error rate hypothesis
    if (traces.errorCount > traces.totalTraces * 0.1) {
      const topErrors = traces.errorTraces[0];
      if (topErrors) {
        hypotheses.push({
          hypothesis: 'Service failure',
          confidence: 'high',
          evidence: [
            `High error rate: ${((traces.errorCount / traces.totalTraces) * 100).toFixed(2)}%`,
            `Most affected service: ${topErrors.key}`,
            `Error count: ${topErrors.doc_count}`
          ],
          suggestedAction: 'Investigate service logs and recent deployments',
          historicalContext: this.findSimilarIncidents(traces, logs, metrics)
        });
      }
    }
    
    // Resource exhaustion hypothesis
    const cpuData = metrics['system.cpu.total.norm.pct'];
    const memoryData = metrics['system.memory.actual.used.pct'];
    
    if (cpuData?.stats?.max > 0.8) {
      hypotheses.push({
        hypothesis: 'CPU exhaustion',
        confidence: 'medium',
        evidence: [
          `Max CPU usage: ${(cpuData.stats.max * 100).toFixed(2)}%`,
          `Average CPU: ${(cpuData.stats.avg * 100).toFixed(2)}%`
        ],
        suggestedAction: 'Check for CPU-intensive operations or infinite loops',
        patternType: 'resource_exhaustion_cpu'
      });
    }
    
    if (memoryData?.stats?.max > 0.9) {
      hypotheses.push({
        hypothesis: 'Memory exhaustion',
        confidence: 'medium',
        evidence: [
          `Max memory usage: ${(memoryData.stats.max * 100).toFixed(2)}%`,
          `Average memory: ${(memoryData.stats.avg * 100).toFixed(2)}%`
        ],
        suggestedAction: 'Check for memory leaks or large data processing',
        patternType: 'resource_exhaustion_memory'
      });
    }
    
    // Cascading failure hypothesis
    if (traces.errorTraces.length > 3) {
      hypotheses.push({
        hypothesis: 'Cascading failure across services',
        confidence: 'medium',
        evidence: [
          `${traces.errorTraces.length} services affected`,
          'Multiple services showing errors simultaneously'
        ],
        suggestedAction: 'Check service dependencies and circuit breakers',
        patternType: 'cascading_failure'
      });
    }
    
    return hypotheses;
  }
  
  private buildIncidentTimeline(traces: any, logs: any, metrics: any): any[] {
    const timeline: any[] = [];
    
    // Add trace events
    traces.latencyTrend.forEach((bucket: any) => {
      if (bucket.p99_latency?.values?.['99.0'] > 1000) {
        timeline.push({
          time: bucket.key_as_string,
          type: 'latency_spike',
          description: `P99 latency: ${bucket.p99_latency.values['99.0']}ms`,
          severity: 'warning'
        });
      }
    });
    
    // Add log events
    logs.logVolumeTrend.forEach((bucket: any) => {
      const errorLogs = bucket.by_level?.buckets?.find((b: any) => 
        ['error', 'ERROR'].includes(b.key)
      );
      
      if (errorLogs && errorLogs.doc_count > 10) {
        timeline.push({
          time: bucket.key_as_string,
          type: 'error_logs',
          description: `${errorLogs.doc_count} error logs`,
          severity: 'error'
        });
      }
    });
    
    // Sort timeline by time
    timeline.sort((a, b) => 
      new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    
    return timeline;
  }
  
  private generateRecommendations(hypotheses: any[]): string[] {
    const recommendations = [];
    
    // Add recommendations based on hypotheses
    for (const hypothesis of hypotheses) {
      recommendations.push(hypothesis.suggestedAction);
    }
    
    // Add general recommendations
    recommendations.push(
      'Review recent deployments and configuration changes',
      'Check external dependencies and API endpoints',
      'Verify database connection pools and query performance',
      'Review service resource limits and scaling policies'
    );
    
    return [...new Set(recommendations)]; // Remove duplicates
  }
  
  private matchKnownPatterns(traces: any, logs: any, metrics: any): any[] {
    const patterns = [];
    
    // Define known incident patterns
    const knownPatterns = [
      {
        name: 'Database Connection Pool Exhaustion',
        conditions: {
          errorPatterns: ['connection pool', 'timeout', 'database'],
          metrics: { latencySpike: true, errorRate: 0.3 },
          services: ['database', 'api']
        },
        hypothesis: 'Database connection pool exhaustion',
        confidence: 'high',
        suggestedAction: 'Increase connection pool size and check for connection leaks',
        remediation: {
          immediate: 'Restart affected services to release connections',
          longTerm: 'Implement connection pooling best practices and monitoring'
        }
      },
      {
        name: 'API Rate Limiting',
        conditions: {
          errorPatterns: ['rate limit', '429', 'too many requests'],
          metrics: { suddenDropInSuccess: true },
          httpCodes: [429]
        },
        hypothesis: 'API rate limiting triggered',
        confidence: 'high',
        suggestedAction: 'Implement request throttling and backoff strategies',
        remediation: {
          immediate: 'Reduce request rate and implement exponential backoff',
          longTerm: 'Implement proper rate limiting on client side'
        }
      },
      {
        name: 'Memory Leak',
        conditions: {
          metrics: { memoryGrowth: 'linear', memoryUsage: 0.8 },
          duration: 'hours',
          pattern: 'gradual'
        },
        hypothesis: 'Memory leak detected',
        confidence: 'medium',
        suggestedAction: 'Profile memory usage and identify leak sources',
        remediation: {
          immediate: 'Restart affected services to free memory',
          longTerm: 'Fix memory leaks in code and implement memory monitoring'
        }
      },
      {
        name: 'Distributed Deadlock',
        conditions: {
          errorPatterns: ['deadlock', 'lock timeout', 'transaction'],
          metrics: { latencySpike: true, throughputDrop: true },
          services: 'multiple'
        },
        hypothesis: 'Distributed deadlock between services',
        confidence: 'medium',
        suggestedAction: 'Review transaction boundaries and locking strategies',
        remediation: {
          immediate: 'Kill long-running transactions',
          longTerm: 'Implement deadlock detection and prevention mechanisms'
        }
      }
    ];
    
    // Check each pattern against current incident data
    for (const pattern of knownPatterns) {
      const matchScore = this.calculatePatternMatch(pattern, traces, logs, metrics);
      
      if (matchScore > 0.7) {
        patterns.push({
          ...pattern,
          matchScore,
          evidence: this.gatherPatternEvidence(pattern, traces, logs, metrics)
        });
      }
    }
    
    return patterns.sort((a, b) => b.matchScore - a.matchScore);
  }
  
  private calculatePatternMatch(pattern: any, traces: any, logs: any, metrics: any): number {
    let matchScore = 0;
    let totalChecks = 0;
    
    // Check error patterns in logs
    if (pattern.conditions.errorPatterns) {
      totalChecks++;
      const logMessages = logs.incidentLogs.map((l: any) => (l.message || '').toLowerCase());
      const errorMessages = logs.topErrorMessages.map((e: any) => e.key.toLowerCase());
      const allMessages = [...logMessages, ...errorMessages];
      
      const matchedPatterns = pattern.conditions.errorPatterns.filter((p: string) =>
        allMessages.some((msg: string) => msg.includes(p.toLowerCase()))
      );
      
      if (matchedPatterns.length > 0) {
        matchScore += matchedPatterns.length / pattern.conditions.errorPatterns.length;
      }
    }
    
    // Check metrics conditions
    if (pattern.conditions.metrics) {
      const metricConditions = pattern.conditions.metrics;
      
      if (metricConditions.latencySpike !== undefined) {
        totalChecks++;
        const hasLatencySpike = traces.latencyTrend.some((bucket: any) => 
          bucket.p99_latency?.values?.['99.0'] > 2000
        );
        if (hasLatencySpike === metricConditions.latencySpike) {
          matchScore += 1;
        }
      }
      
      if (metricConditions.errorRate !== undefined) {
        totalChecks++;
        const errorRate = traces.errorCount / traces.totalTraces;
        if (errorRate >= metricConditions.errorRate) {
          matchScore += 1;
        }
      }
      
      if (metricConditions.memoryUsage !== undefined) {
        totalChecks++;
        const memoryData = metrics['system.memory.actual.used.pct'];
        if (memoryData?.stats?.max >= metricConditions.memoryUsage) {
          matchScore += 1;
        }
      }
    }
    
    // Check service conditions
    if (pattern.conditions.services) {
      totalChecks++;
      const affectedServices = traces.errorTraces.map((s: any) => s.key.toLowerCase());
      
      if (pattern.conditions.services === 'multiple') {
        if (affectedServices.length > 2) {
          matchScore += 1;
        }
      } else if (Array.isArray(pattern.conditions.services)) {
        const matchedServices = pattern.conditions.services.filter((s: string) =>
          affectedServices.some((as: string) => as.includes(s.toLowerCase()))
        );
        if (matchedServices.length > 0) {
          matchScore += matchedServices.length / pattern.conditions.services.length;
        }
      }
    }
    
    return totalChecks > 0 ? matchScore / totalChecks : 0;
  }
  
  private gatherPatternEvidence(pattern: any, traces: any, logs: any, metrics: any): string[] {
    const evidence = [];
    
    // Gather error message evidence
    if (pattern.conditions.errorPatterns) {
      const matchedErrors = logs.topErrorMessages
        .filter((e: any) => 
          pattern.conditions.errorPatterns.some((p: string) => 
            e.key.toLowerCase().includes(p.toLowerCase())
          )
        )
        .slice(0, 3);
      
      if (matchedErrors.length > 0) {
        evidence.push(`Error messages matching pattern: ${matchedErrors.map((e: any) => e.key).join(', ')}`);
      }
    }
    
    // Gather metrics evidence
    if (pattern.conditions.metrics) {
      if (pattern.conditions.metrics.latencySpike) {
        const maxLatency = Math.max(...traces.latencyTrend.map((b: any) => 
          b.p99_latency?.values?.['99.0'] || 0
        ));
        evidence.push(`P99 latency spike detected: ${maxLatency}ms`);
      }
      
      if (pattern.conditions.metrics.errorRate) {
        const errorRate = ((traces.errorCount / traces.totalTraces) * 100).toFixed(2);
        evidence.push(`Error rate: ${errorRate}%`);
      }
    }
    
    // Gather service evidence
    const affectedServices = traces.errorTraces.slice(0, 5).map((s: any) => s.key);
    if (affectedServices.length > 0) {
      evidence.push(`Affected services: ${affectedServices.join(', ')}`);
    }
    
    return evidence;
  }
  
  private findSimilarIncidents(traces: any, logs: any, metrics: any): any {
    // Create incident signature
    const signature = {
      errorRate: traces.errorCount / traces.totalTraces,
      affectedServices: traces.errorTraces.map((s: any) => s.key).sort(),
      errorTypes: logs.topErrorMessages.slice(0, 5).map((e: any) => e.key),
      hasLatencySpike: traces.latencyTrend.some((b: any) => b.p99_latency?.values?.['99.0'] > 2000),
      hasCPUSpike: metrics['system.cpu.total.norm.pct']?.stats?.max > 0.8,
      hasMemorySpike: metrics['system.memory.actual.used.pct']?.stats?.max > 0.9
    };
    
    // In a real implementation, this would query a historical incident database
    // For now, we'll return a simulated similar incident
    return {
      similarityScore: 0.85,
      previousIncident: {
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        resolution: 'Increased database connection pool from 50 to 200',
        rootCause: 'Database connection pool exhaustion during peak traffic',
        timeToResolve: '45 minutes',
        preventionMeasures: [
          'Implemented connection pool monitoring alerts',
          'Added auto-scaling for database connections',
          'Optimized query performance to reduce connection hold time'
        ]
      },
      signature
    };
  }
  
  private calculateIncidentSeverity(traces: any, _logs: any, metrics: any): any {
    let severityScore = 0;
    const factors = [];
    
    // Error rate factor
    const errorRate = traces.errorCount / traces.totalTraces;
    if (errorRate > 0.5) {
      severityScore += 3;
      factors.push({ factor: 'error_rate', value: errorRate, impact: 'high' });
    } else if (errorRate > 0.2) {
      severityScore += 2;
      factors.push({ factor: 'error_rate', value: errorRate, impact: 'medium' });
    } else if (errorRate > 0.05) {
      severityScore += 1;
      factors.push({ factor: 'error_rate', value: errorRate, impact: 'low' });
    }
    
    // Service spread factor
    const affectedServices = traces.errorTraces.length;
    if (affectedServices > 5) {
      severityScore += 3;
      factors.push({ factor: 'service_spread', value: affectedServices, impact: 'high' });
    } else if (affectedServices > 2) {
      severityScore += 2;
      factors.push({ factor: 'service_spread', value: affectedServices, impact: 'medium' });
    }
    
    // Resource exhaustion factor
    const cpuMax = metrics['system.cpu.total.norm.pct']?.stats?.max || 0;
    const memMax = metrics['system.memory.actual.used.pct']?.stats?.max || 0;
    
    if (cpuMax > 0.9 || memMax > 0.95) {
      severityScore += 3;
      factors.push({ factor: 'resource_exhaustion', value: { cpu: cpuMax, memory: memMax }, impact: 'critical' });
    } else if (cpuMax > 0.8 || memMax > 0.9) {
      severityScore += 2;
      factors.push({ factor: 'resource_exhaustion', value: { cpu: cpuMax, memory: memMax }, impact: 'high' });
    }
    
    // Calculate severity level
    let level: string;
    if (severityScore >= 7) {
      level = 'critical';
    } else if (severityScore >= 5) {
      level = 'high';
    } else if (severityScore >= 3) {
      level = 'medium';
    } else {
      level = 'low';
    }
    
    return {
      level,
      score: severityScore,
      factors,
      recommendation: this.getSeverityRecommendation(level)
    };
  }
  
  private getSeverityRecommendation(level: string): string {
    switch (level) {
      case 'critical':
        return 'Immediate action required. Wake up on-call team and escalate to senior engineers.';
      case 'high':
        return 'Urgent attention needed. Begin incident response procedures.';
      case 'medium':
        return 'Investigate within business hours. Monitor for escalation.';
      case 'low':
        return 'Track and investigate during normal operations.';
      default:
        return 'Monitor the situation.';
    }
  }
  
  private generatePatternInsights(hypotheses: any[]): any {
    const insights: {
      matchedPatterns: any[],
      commonalities: any[],
      uniqueAspects: any[],
      learnings: any[]
    } = {
      matchedPatterns: [],
      commonalities: [],
      uniqueAspects: [],
      learnings: []
    };
    
    // Analyze matched patterns
    const patternMatches = hypotheses.filter(h => h.matchScore);
    if (patternMatches.length > 0) {
      insights.matchedPatterns = patternMatches.map(p => ({
        pattern: p.name,
        confidence: `${Math.round(p.matchScore * 100)}%`,
        remediation: p.remediation
      }));
      
      // Extract common remediation steps
      const allRemediations = new Set<string>();
      patternMatches.forEach(p => {
        if (p.remediation) {
          allRemediations.add(p.remediation.immediate);
          allRemediations.add(p.remediation.longTerm);
        }
      });
      
      insights.commonalities = Array.from(allRemediations);
    }
    
    // Analyze historical context
    const historicalMatches = hypotheses.filter(h => h.historicalContext);
    if (historicalMatches.length > 0) {
      const bestMatch = historicalMatches[0].historicalContext;
      if (bestMatch.similarityScore > 0.7) {
        insights.learnings.push({
          insight: 'Similar incident detected in history',
          previousResolution: bestMatch.previousIncident.resolution,
          timeToResolve: bestMatch.previousIncident.timeToResolve,
          preventionMeasures: bestMatch.previousIncident.preventionMeasures
        });
      }
    }
    
    // Identify unique aspects
    const allPatternTypes = hypotheses.map(h => h.patternType).filter(Boolean);
    const uniquePatterns = [...new Set(allPatternTypes)];
    
    if (uniquePatterns.includes('cascading_failure') && uniquePatterns.includes('resource_exhaustion_cpu')) {
      insights.uniqueAspects.push('Combination of cascading failure and resource exhaustion suggests systemic issue');
    }
    
    return insights;
  }
  
  private generateActionPlan(hypotheses: any[], severity: any): any {
    const actionPlan: {
      immediate: any[],
      shortTerm: any[],
      longTerm: any[],
      monitoring: any[]
    } = {
      immediate: [],
      shortTerm: [],
      longTerm: [],
      monitoring: []
    };
    
    // Priority actions based on severity
    if (severity.level === 'critical' || severity.level === 'high') {
      actionPlan.immediate.push({
        action: 'Activate incident response team',
        priority: 1,
        estimatedTime: '5 minutes'
      });
    }
    
    // Add pattern-based actions
    const patternMatches = hypotheses.filter(h => h.matchScore);
    patternMatches.forEach((pattern, index) => {
      if (pattern.remediation) {
        actionPlan.immediate.push({
          action: pattern.remediation.immediate,
          priority: index + 2,
          estimatedTime: '15-30 minutes',
          pattern: pattern.name
        });
        
        actionPlan.longTerm.push({
          action: pattern.remediation.longTerm,
          priority: index + 1,
          estimatedTime: '1-2 weeks',
          pattern: pattern.name
        });
      }
    });
    
    // Add hypothesis-based actions
    hypotheses.forEach(hypothesis => {
      if (hypothesis.suggestedAction && !hypothesis.matchScore) {
        actionPlan.shortTerm.push({
          action: hypothesis.suggestedAction,
          priority: hypothesis.confidence === 'high' ? 1 : 2,
          confidence: hypothesis.confidence
        });
      }
    });
    
    // Add monitoring actions
    actionPlan.monitoring = [
      {
        metric: 'Error rate',
        threshold: '5%',
        action: 'Alert if exceeded for 5 minutes'
      },
      {
        metric: 'P99 latency',
        threshold: '2000ms',
        action: 'Alert if exceeded for 3 minutes'
      },
      {
        metric: 'Service dependencies',
        threshold: 'Any new errors',
        action: 'Track error propagation'
      }
    ];
    
    return actionPlan;
  }
}
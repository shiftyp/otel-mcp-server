import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';
import { TraceDocument } from '../../../types/opensearch-types.js';

// Define the Zod schema
const TraceAnomalyClassifierArgsSchema = {
  from: z.string().describe('Start time (ISO 8601 or relative format like "now-1h")'),
  to: z.string().describe('End time (ISO 8601 or relative format like "now")'),
  service: z.string().optional().describe('Service name to filter results (optional)'),
  sensitivityLevel: z.enum(['low', 'medium', 'high']).optional().describe('Detection sensitivity - low/medium/high (default: medium)'),
  includeContext: z.boolean().optional().describe('Include detailed metadata in results (default: true)')
};

type TraceAnomalyClassifierArgs = MCPToolSchema<typeof TraceAnomalyClassifierArgsSchema>;

/**
 * Tool for classifying and explaining trace anomalies
 */
export class TraceAnomalyClassifierTool extends BaseTool<typeof TraceAnomalyClassifierArgsSchema> {
  // Static schema property
  static readonly schema = TraceAnomalyClassifierArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'detectTraceAnomalies',
      category: ToolCategory.ANALYSIS,
      description: 'Detect unusual trace patterns and classify anomaly types with root cause hints',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return TraceAnomalyClassifierArgsSchema;
  }
  
  protected async executeImpl(args: TraceAnomalyClassifierArgs): Promise<any> {
    const config = ConfigLoader.get();
    
    // Query for traces in the time range
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: { gte: args.from, lte: args.to } } }
        ],
        filter: []
      }
    };
    
    if (args.service) {
      query.bool.filter.push({ term: { [config.telemetry.fields.service]: args.service } });
    }
    
    // Get trace statistics
    const statsResult = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          latency_stats: {
            percentiles: { field: 'duration', percents: [50, 75, 90, 95, 99] }
          },
          error_rate: {
            terms: { field: 'status.keyword', size: 10 }
          },
          services: {
            terms: { field: config.telemetry.fields.service, size: 20 },
            aggs: {
              avg_duration: { avg: { field: 'duration' } },
              error_count: {
                filter: { term: { status: 'ERROR' } }
              }
            }
          }
        }
      }
    );
    
    // Get anomalous traces
    const anomalies = await this.detectAnomalies(query, statsResult, args.sensitivityLevel || 'medium');
    
    // Classify anomalies
    const classifiedAnomalies = await this.classifyAnomalies(anomalies);
    
    // Get context if requested
    let contextualInsights = null;
    if (args.includeContext !== false) {
      contextualInsights = await this.getContextualInsights(query, classifiedAnomalies);
    }
    
    // Generate investigation recommendations
    const recommendations = this.generateInvestigationPlan(classifiedAnomalies);
    
    return this.formatJsonOutput({
      timeRange: { from: args.from, to: args.to },
      service: args.service,
      summary: {
        totalTraces: statsResult.hits.total.value,
        anomalyCount: classifiedAnomalies.length,
        anomalyRate: (classifiedAnomalies.length / statsResult.hits.total.value * 100).toFixed(2) + '%',
        topAnomalyTypes: this.summarizeAnomalyTypes(classifiedAnomalies)
      },
      anomalies: classifiedAnomalies,
      contextualInsights,
      recommendations,
      investigationPriority: this.calculateInvestigationPriority(classifiedAnomalies)
    });
  }
  
  private async detectAnomalies(query: any, stats: any, sensitivity: string): Promise<any[]> {
    const config = ConfigLoader.get();
    const anomalies: any[] = [];
    
    // Calculate thresholds based on sensitivity
    const thresholds = this.calculateThresholds(stats, sensitivity);
    
    // Query for high latency traces
    const latencyQuery = {
      ...query,
      bool: {
        ...query.bool,
        must: [
          ...query.bool.must,
          { range: { duration: { gte: thresholds.latency } } }
        ]
      }
    };
    
    const latencyAnomalies = await this.adapter.query<TraceDocument>(
      config.telemetry.indices.traces,
      latencyQuery,
      { size: 100, sort: [{ duration: 'desc' }] }
    );
    
    // Query for error traces
    const errorQuery = {
      ...query,
      bool: {
        ...query.bool,
        must: [
          ...query.bool.must,
          { term: { status: 'ERROR' } }
        ]
      }
    };
    
    const errorTraces = await this.adapter.query<TraceDocument>(
      config.telemetry.indices.traces,
      errorQuery,
      { size: 100, sort: [{ [config.telemetry.fields.timestamp]: 'desc' }] }
    );
    
    // Combine and deduplicate
    type AnomalyTrace = TraceDocument & { anomalyType: 'latency' | 'error'; [key: string]: unknown };
    
    const allAnomalies: AnomalyTrace[] = [
      ...latencyAnomalies.hits.hits.map(hit => ({ ...hit._source, anomalyType: 'latency' as const })),
      ...errorTraces.hits.hits.map(hit => ({ ...hit._source, anomalyType: 'error' as const }))
    ];
    
    // Deduplicate by trace ID
    const uniqueAnomalies = new Map<string, AnomalyTrace>();
    allAnomalies.forEach((anomaly) => {
      const traceId = anomaly[config.telemetry.fields.traceId] as string;
      if (!uniqueAnomalies.has(traceId) || anomaly.anomalyType === 'error') {
        uniqueAnomalies.set(traceId, anomaly);
      }
    });
    
    return Array.from(uniqueAnomalies.values());
  }
  
  private calculateThresholds(stats: any, sensitivity: string): any {
    const latencyPercentiles = stats.aggregations?.latency_stats?.values || {};
    
    switch (sensitivity) {
      case 'low':
        return {
          latency: latencyPercentiles['99.0'] || 5000,
          errorRateThreshold: 0.1
        };
      case 'high':
        return {
          latency: latencyPercentiles['90.0'] || 1000,
          errorRateThreshold: 0.01
        };
      default: // medium
        return {
          latency: latencyPercentiles['95.0'] || 2000,
          errorRateThreshold: 0.05
        };
    }
  }
  
  private async classifyAnomalies(anomalies: any[]): Promise<any[]> {
    const classified = anomalies.map(anomaly => {
      const classification = this.classifySingleAnomaly(anomaly);
      
      return {
        traceId: anomaly.trace?.id || anomaly.traceId,
        timestamp: anomaly['@timestamp'],
        service: anomaly.service?.name || anomaly.resource?.service?.name,
        operation: anomaly['span.name'],
        duration: anomaly.duration,
        status: anomaly.status,
        classification,
        evidence: this.gatherEvidence(anomaly, classification),
        investigationHints: this.generateHints(classification),
        severity: this.calculateSeverity(anomaly, classification)
      };
    });
    
    return classified.sort((a, b) => b.severity.score - a.severity.score);
  }
  
  private classifySingleAnomaly(anomaly: any): any {
    const classifications = [];
    
    // Timeout classification
    if (anomaly.duration > 30000) {
      classifications.push({
        type: 'timeout',
        confidence: 0.9,
        description: 'Request exceeded timeout threshold'
      });
    }
    
    // Error cascade classification
    if (anomaly.status === 'ERROR' && anomaly.error?.message?.includes('circuit breaker')) {
      classifications.push({
        type: 'circuit_breaker_open',
        confidence: 0.95,
        description: 'Circuit breaker triggered due to downstream failures'
      });
    }
    
    // Database issue classification
    if (anomaly['span.name']?.toLowerCase().includes('db') || 
        anomaly['span.name']?.toLowerCase().includes('sql')) {
      if (anomaly.duration > 5000) {
        classifications.push({
          type: 'database_slow_query',
          confidence: 0.8,
          description: 'Database operation taking excessive time'
        });
      }
    }
    
    // Connection issue classification
    if (anomaly.error?.message?.match(/connection|refused|reset/i)) {
      classifications.push({
        type: 'connection_failure',
        confidence: 0.85,
        description: 'Network or service connection issue'
      });
    }
    
    // Resource exhaustion classification
    if (anomaly.error?.message?.match(/out of memory|heap|oom/i)) {
      classifications.push({
        type: 'resource_exhaustion',
        subtype: 'memory',
        confidence: 0.9,
        description: 'Memory exhaustion detected'
      });
    }
    
    // Retry storm classification
    if (anomaly.retry_count > 3 || anomaly['span.name']?.includes('retry')) {
      classifications.push({
        type: 'retry_storm',
        confidence: 0.7,
        description: 'Excessive retry attempts detected'
      });
    }
    
    // Default classification if none matched
    if (classifications.length === 0) {
      if (anomaly.anomalyType === 'latency') {
        classifications.push({
          type: 'high_latency',
          confidence: 0.6,
          description: 'Unexplained high latency'
        });
      } else {
        classifications.push({
          type: 'unknown_error',
          confidence: 0.5,
          description: 'Error without clear classification'
        });
      }
    }
    
    return classifications[0]; // Return highest confidence classification
  }
  
  private gatherEvidence(anomaly: any, classification: any): any {
    const evidence: any = {
      duration: `${anomaly.duration}ms`,
      status: anomaly.status
    };
    
    if (anomaly.error?.message) {
      evidence.errorMessage = anomaly.error.message;
    }
    
    if (anomaly.http?.response?.status_code) {
      evidence.httpStatus = anomaly.http.response.status_code;
    }
    
    if (anomaly.db?.statement) {
      evidence.dbQuery = anomaly.db.statement.substring(0, 100) + '...';
    }
    
    // Add classification-specific evidence
    switch (classification.type) {
      case 'database_slow_query':
        evidence.queryDuration = `${anomaly.duration}ms`;
        evidence.dbType = anomaly.db?.type || 'unknown';
        break;
      
      case 'circuit_breaker_open':
        evidence.downstreamService = anomaly.peer?.service || 'unknown';
        evidence.failureCount = anomaly.circuit_breaker?.failure_count || 'unknown';
        break;
      
      case 'retry_storm':
        evidence.retryCount = anomaly.retry_count || 'unknown';
        evidence.lastRetryDelay = anomaly.retry_delay || 'unknown';
        break;
    }
    
    return evidence;
  }
  
  private generateHints(classification: any): string[] {
    const hints: string[] = [];
    
    switch (classification.type) {
      case 'timeout':
        hints.push('Check if downstream services are responding slowly');
        hints.push('Review timeout configuration values');
        hints.push('Look for network latency issues');
        break;
      
      case 'database_slow_query':
        hints.push('Analyze query execution plan');
        hints.push('Check for missing database indexes');
        hints.push('Review database connection pool settings');
        hints.push('Look for table locks or deadlocks');
        break;
      
      case 'circuit_breaker_open':
        hints.push('Investigate downstream service health');
        hints.push('Check circuit breaker configuration thresholds');
        hints.push('Review recent deployment changes');
        break;
      
      case 'connection_failure':
        hints.push('Verify service discovery configuration');
        hints.push('Check network connectivity and firewall rules');
        hints.push('Review service endpoint URLs');
        break;
      
      case 'resource_exhaustion':
        hints.push('Check memory allocation and limits');
        hints.push('Look for memory leaks in recent code changes');
        hints.push('Review garbage collection logs');
        break;
      
      case 'retry_storm':
        hints.push('Implement exponential backoff');
        hints.push('Add circuit breakers to prevent cascading failures');
        hints.push('Review retry policy configuration');
        break;
      
      default:
        hints.push('Check service logs for more details');
        hints.push('Review recent code changes');
        hints.push('Monitor system resources');
    }
    
    return hints;
  }
  
  private calculateSeverity(anomaly: any, classification: any): any {
    let score = 0;
    const factors = [];
    
    // Base score from classification confidence
    score += classification.confidence * 3;
    
    // Duration factor
    if (anomaly.duration > 10000) {
      score += 3;
      factors.push('Very high latency (>10s)');
    } else if (anomaly.duration > 5000) {
      score += 2;
      factors.push('High latency (>5s)');
    }
    
    // Error status factor
    if (anomaly.status === 'ERROR') {
      score += 2;
      factors.push('Error status');
    }
    
    // Classification-specific factors
    switch (classification.type) {
      case 'circuit_breaker_open':
        score += 3;
        factors.push('Circuit breaker open - cascading failure risk');
        break;
      
      case 'resource_exhaustion':
        score += 3;
        factors.push('Resource exhaustion - system stability risk');
        break;
      
      case 'retry_storm':
        score += 2;
        factors.push('Retry storm - amplification risk');
        break;
    }
    
    return {
      score: Math.min(score, 10),
      level: score >= 8 ? 'critical' : score >= 6 ? 'high' : score >= 4 ? 'medium' : 'low',
      factors
    };
  }
  
  private async getContextualInsights(query: any, anomalies: any[]): Promise<any> {
    if (anomalies.length === 0) {
      return null;
    }
    
    const config = ConfigLoader.get();
    
    // Get normal traces for comparison
    const normalQuery = {
      ...query,
      bool: {
        ...query.bool,
        must_not: [
          { term: { status: 'ERROR' } },
          { range: { duration: { gte: 2000 } } }
        ]
      }
    };
    
    const normalTraces = await this.adapter.query(
      config.telemetry.indices.traces,
      normalQuery,
      {
        size: 0,
        aggregations: {
          avg_duration: { avg: { field: 'duration' } },
          services: {
            terms: { field: config.telemetry.fields.service, size: 10 },
            aggs: {
              avg_duration: { avg: { field: 'duration' } }
            }
          }
        }
      }
    );
    
    const insights = {
      normalBaseline: {
        avgDuration: normalTraces.aggregations?.avg_duration?.value || 0,
        serviceBaselines: normalTraces.aggregations?.services?.buckets || []
      },
      anomalyPatterns: this.identifyPatterns(anomalies),
      timeCorrelation: this.analyzeTimeCorrelation(anomalies),
      serviceImpact: this.analyzeServiceImpact(anomalies)
    };
    
    return insights;
  }
  
  private identifyPatterns(anomalies: any[]): any[] {
    const patterns = [];
    
    // Group by classification type
    const typeGroups: Record<string, any[]> = {};
    anomalies.forEach(a => {
      const type = a.classification.type;
      if (!typeGroups[type]) typeGroups[type] = [];
      typeGroups[type].push(a);
    });
    
    // Analyze each group
    for (const [type, group] of Object.entries(typeGroups)) {
      if (group.length >= 3) {
        patterns.push({
          pattern: `Multiple ${type} anomalies`,
          count: group.length,
          services: [...new Set(group.map(a => a.service))],
          timeSpan: this.calculateTimeSpan(group),
          severity: 'high'
        });
      }
    }
    
    // Check for service-specific patterns
    const serviceGroups: Record<string, any[]> = {};
    anomalies.forEach(a => {
      if (a.service) {
        if (!serviceGroups[a.service]) serviceGroups[a.service] = [];
        serviceGroups[a.service].push(a);
      }
    });
    
    for (const [service, group] of Object.entries(serviceGroups)) {
      if (group.length >= 5) {
        patterns.push({
          pattern: `Service-specific anomaly cluster`,
          service,
          count: group.length,
          types: [...new Set(group.map(a => a.classification.type))],
          severity: 'medium'
        });
      }
    }
    
    return patterns;
  }
  
  private analyzeTimeCorrelation(anomalies: any[]): any {
    if (anomalies.length < 2) {
      return { pattern: 'isolated', description: 'Single anomaly detected' };
    }
    
    const sorted = anomalies.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    
    const firstTime = new Date(sorted[0].timestamp).getTime();
    const lastTime = new Date(sorted[sorted.length - 1].timestamp).getTime();
    const duration = lastTime - firstTime;
    
    if (duration < 60000) { // 1 minute
      return {
        pattern: 'burst',
        description: 'All anomalies occurred within 1 minute',
        duration: `${Math.round(duration / 1000)}s`,
        recommendation: 'Likely a sudden system issue or traffic spike'
      };
    } else if (duration < 300000) { // 5 minutes
      return {
        pattern: 'cascade',
        description: 'Anomalies spread over several minutes',
        duration: `${Math.round(duration / 60000)}m`,
        recommendation: 'Possible cascading failure scenario'
      };
    } else {
      return {
        pattern: 'distributed',
        description: 'Anomalies spread over extended time',
        duration: `${Math.round(duration / 3600000)}h`,
        recommendation: 'May indicate ongoing systemic issues'
      };
    }
  }
  
  private calculateTimeSpan(anomalies: any[]): string {
    if (anomalies.length === 0) return '0s';
    
    const times = anomalies.map(a => new Date(a.timestamp).getTime());
    const duration = Math.max(...times) - Math.min(...times);
    
    if (duration < 60000) return `${Math.round(duration / 1000)}s`;
    if (duration < 3600000) return `${Math.round(duration / 60000)}m`;
    return `${Math.round(duration / 3600000)}h`;
  }
  
  private analyzeServiceImpact(anomalies: any[]): any {
    const serviceImpact: Record<string, any> = {};
    
    anomalies.forEach(anomaly => {
      const service = anomaly.service || 'unknown';
      
      if (!serviceImpact[service]) {
        serviceImpact[service] = {
          anomalyCount: 0,
          errorCount: 0,
          avgDuration: 0,
          maxDuration: 0,
          types: new Set()
        };
      }
      
      serviceImpact[service].anomalyCount++;
      if (anomaly.status === 'ERROR') serviceImpact[service].errorCount++;
      serviceImpact[service].avgDuration += anomaly.duration || 0;
      serviceImpact[service].maxDuration = Math.max(
        serviceImpact[service].maxDuration,
        anomaly.duration || 0
      );
      serviceImpact[service].types.add(anomaly.classification.type);
    });
    
    // Calculate averages and convert sets to arrays
    Object.keys(serviceImpact).forEach(service => {
      const impact = serviceImpact[service];
      impact.avgDuration = Math.round(impact.avgDuration / impact.anomalyCount);
      impact.types = Array.from(impact.types);
      impact.severity = impact.errorCount > 5 ? 'high' : 
                       impact.errorCount > 2 ? 'medium' : 'low';
    });
    
    return serviceImpact;
  }
  
  private summarizeAnomalyTypes(anomalies: any[]): any[] {
    const typeCounts: Record<string, number> = {};
    
    anomalies.forEach(anomaly => {
      const type = anomaly.classification.type;
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    
    return Object.entries(typeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }
  
  private generateInvestigationPlan(anomalies: any[]): any {
    const plan: {
      immediate: any[],
      shortTerm: any[],
      preventive: any[]
    } = {
      immediate: [],
      shortTerm: [],
      preventive: []
    };
    
    // Group anomalies by type for targeted recommendations
    const typeGroups: Record<string, number> = {};
    anomalies.forEach(a => {
      typeGroups[a.classification.type] = (typeGroups[a.classification.type] || 0) + 1;
    });
    
    // Immediate actions based on anomaly types
    if (typeGroups['circuit_breaker_open']) {
      plan.immediate.push({
        action: 'Check downstream service health immediately',
        reason: 'Circuit breakers are open, indicating service failures',
        priority: 1
      });
    }
    
    if (typeGroups['resource_exhaustion']) {
      plan.immediate.push({
        action: 'Monitor and potentially restart affected services',
        reason: 'Resource exhaustion can lead to cascading failures',
        priority: 1
      });
    }
    
    if (typeGroups['database_slow_query'] > 3) {
      plan.immediate.push({
        action: 'Analyze database performance and active queries',
        reason: 'Multiple slow queries detected',
        priority: 2
      });
    }
    
    // Short-term actions
    plan.shortTerm.push({
      action: 'Review logs for the top 3 anomalous traces',
      traceIds: anomalies.slice(0, 3).map(a => a.traceId),
      priority: 1
    });
    
    if (typeGroups['timeout'] > 2) {
      plan.shortTerm.push({
        action: 'Review and adjust timeout configurations',
        reason: `${typeGroups['timeout']} timeout anomalies detected`,
        priority: 2
      });
    }
    
    // Preventive actions
    plan.preventive.push({
      action: 'Set up alerts for similar anomaly patterns',
      threshold: 'Alert when > 5 anomalies in 5 minutes',
      priority: 1
    });
    
    if (typeGroups['retry_storm']) {
      plan.preventive.push({
        action: 'Implement circuit breakers and exponential backoff',
        reason: 'Retry storms can amplify failures',
        priority: 2
      });
    }
    
    return plan;
  }
  
  private calculateInvestigationPriority(anomalies: any[]): string {
    if (anomalies.length === 0) return 'low';
    
    const criticalCount = anomalies.filter(a => a.severity.level === 'critical').length;
    const highCount = anomalies.filter(a => a.severity.level === 'high').length;
    
    if (criticalCount > 2 || (criticalCount > 0 && highCount > 3)) {
      return 'immediate';
    } else if (highCount > 5 || criticalCount > 0) {
      return 'high';
    } else if (anomalies.length > 10) {
      return 'medium';
    }
    
    return 'low';
  }
}
import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const RetryStormDetectionArgsSchema = {
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  service: z.string().optional().describe('Specific service to analyze for retry storms'),
  retryThreshold: z.number().optional().describe('Minimum retry ratio to consider as storm (default: 2.0)'),
  minRequests: z.number().optional().describe('Minimum requests to consider for analysis (default: 100)'),
  includeDownstream: z.boolean().optional().describe('Include downstream retry impacts (default: true)')
};

type RetryStormDetectionArgs = MCPToolSchema<typeof RetryStormDetectionArgsSchema>;

/**
 * Tool for detecting retry storms and cascading retry patterns in distributed systems
 */
export class RetryStormDetectionTool extends BaseTool<typeof RetryStormDetectionArgsSchema> {
  // Static schema property
  static readonly schema = RetryStormDetectionArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'detectRetryStorms',
      category: ToolCategory.ANALYSIS,
      description: 'Detect retry storms and cascading retry patterns that can overwhelm services',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return RetryStormDetectionArgsSchema;
  }
  
  protected async executeImpl(args: RetryStormDetectionArgs): Promise<any> {
    const config = ConfigLoader.get();
    const retryThreshold = args.retryThreshold || 2.0;
    const minRequests = args.minRequests || 100;
    const includeDownstream = args.includeDownstream ?? true;
    const timeRange = { from: args.from, to: args.to };
    
    // Detect retry patterns
    const retryPatterns = await this.detectRetryPatterns(
      timeRange,
      args.service,
      retryThreshold,
      minRequests
    );
    
    if (retryPatterns.length === 0) {
      return this.formatJsonOutput({
        status: 'no_storms_detected',
        message: 'No retry storms detected in the specified time range',
        timeRange: timeRange,
        service: args.service
      });
    }
    
    // Analyze retry storm characteristics
    const stormAnalysis = await this.analyzeRetryStorms(retryPatterns, timeRange);
    
    // Identify root causes
    const rootCauses = await this.identifyRootCauses(retryPatterns, timeRange);
    
    // Calculate impact
    const impact = await this.calculateRetryImpact(retryPatterns, includeDownstream);
    
    // Detect cascading patterns
    const cascadingPatterns = await this.detectCascadingRetries(
      retryPatterns,
      timeRange,
      includeDownstream
    );
    
    // Generate mitigation strategies
    const mitigationStrategies = this.generateMitigationStrategies(
      stormAnalysis,
      rootCauses,
      cascadingPatterns
    );
    
    return this.formatJsonOutput({
      detection: {
        stormsDetected: retryPatterns.length,
        timeRange: timeRange,
        service: args.service,
        retryThreshold
      },
      retryStorms: retryPatterns.map(storm => ({
        service: storm.service,
        endpoint: storm.endpoint,
        severity: storm.severity,
        retryRatio: storm.retryRatio,
        totalRequests: storm.totalRequests,
        retryRequests: storm.retryRequests,
        timeWindow: storm.timeWindow,
        peakRetryRate: storm.peakRetryRate
      })),
      stormCharacteristics: {
        patterns: stormAnalysis.patterns,
        duration: stormAnalysis.duration,
        intensity: stormAnalysis.intensity,
        periodicity: stormAnalysis.periodicity
      },
      rootCauses: {
        primary: rootCauses.primary,
        contributing: rootCauses.contributing,
        correlations: rootCauses.correlations
      },
      impact: {
        affectedServices: impact.affectedServices,
        resourceWaste: impact.resourceWaste,
        userImpact: impact.userImpact,
        cascadingRisk: impact.cascadingRisk
      },
      cascadingPatterns: {
        detected: cascadingPatterns.length > 0,
        patterns: cascadingPatterns,
        amplificationFactor: this.calculateAmplificationFactor(cascadingPatterns)
      },
      mitigation: mitigationStrategies,
      insights: this.generateRetryStormInsights(
        retryPatterns,
        stormAnalysis,
        rootCauses,
        impact
      ),
      summary: this.generateRetryStormSummary(
        retryPatterns,
        impact,
        mitigationStrategies
      )
    });
  }
  
  private async detectRetryPatterns(
    timeRange: any,
    service: string | undefined,
    retryThreshold: number,
    minRequests: number
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    
    // Build query
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    if (service) {
      query.bool.must.push({ term: { [config.telemetry.fields.service]: service } });
    }
    
    // Aggregate by service and endpoint to find retry patterns
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          services: {
            terms: { 
              field: config.telemetry.fields.service,
              size: 100
            },
            aggs: {
              endpoints: {
                terms: {
                  field: 'http.url.keyword',
                  size: 50
                },
                aggs: {
                  total_requests: {
                    cardinality: { field: config.telemetry.fields.traceId }
                  },
                  retry_indicators: {
                    filters: {
                      filters: {
                        retries: {
                          bool: {
                            should: [
                              { term: { 'http.retry': true } },
                              { range: { 'http.retry_count': { gt: 0 } } },
                              { terms: { 'tags.keyword': ['retry', 'retried', 'retry_attempt'] } }
                            ]
                          }
                        },
                        timeouts: {
                          bool: {
                            should: [
                              { term: { 'error.type.keyword': 'timeout' } },
                              { term: { 'error.type.keyword': 'RequestTimeout' } },
                              { wildcard: { 'error.message.keyword': '*timeout*' } }
                            ]
                          }
                        }
                      }
                    }
                  },
                  time_buckets: {
                    date_histogram: {
                      field: config.telemetry.fields.timestamp,
                      fixed_interval: '1m'
                    },
                    aggs: {
                      request_rate: {
                        value_count: { field: config.telemetry.fields.traceId }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    );
    
    // Analyze patterns for retry storms
    const retryPatterns: any[] = [];
    const serviceBuckets = result.aggregations?.services?.buckets || [];
    
    for (const serviceBucket of serviceBuckets) {
      const serviceName = serviceBucket.key;
      const endpointBuckets = serviceBucket.endpoints?.buckets || [];
      
      for (const endpointBucket of endpointBuckets) {
        const endpoint = endpointBucket.key;
        const totalRequests = endpointBucket.total_requests?.value || 0;
        const retryCount = endpointBucket.retry_indicators?.buckets?.retries?.doc_count || 0;
        const timeoutCount = endpointBucket.retry_indicators?.buckets?.timeouts?.doc_count || 0;
        
        if (totalRequests >= minRequests) {
          const retryRatio = retryCount / totalRequests;
          
          if (retryRatio >= retryThreshold) {
            // Calculate peak retry rate
            const timeBuckets = endpointBucket.time_buckets?.buckets || [];
            const peakRate = Math.max(...timeBuckets.map((b: any) => b.request_rate?.value || 0));
            
            retryPatterns.push({
              service: serviceName,
              endpoint,
              totalRequests,
              retryRequests: retryCount,
              timeoutRequests: timeoutCount,
              retryRatio,
              severity: this.calculateStormSeverity(retryRatio, totalRequests),
              timeWindow: timeRange,
              peakRetryRate: peakRate,
              timeSeries: timeBuckets
            });
          }
        }
      }
    }
    
    // Sort by severity
    return retryPatterns.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return severityOrder[a.severity as keyof typeof severityOrder] - 
             severityOrder[b.severity as keyof typeof severityOrder];
    });
  }
  
  private calculateStormSeverity(retryRatio: number, totalRequests: number): string {
    // Severity based on retry ratio and volume
    if (retryRatio > 5 && totalRequests > 1000) return 'critical';
    if (retryRatio > 3 || (retryRatio > 2 && totalRequests > 500)) return 'high';
    if (retryRatio > 2) return 'medium';
    return 'low';
  }
  
  private async analyzeRetryStorms(retryPatterns: any[], timeRange: any): Promise<any> {
    const patterns: any[] = [];
    const durations: number[] = [];
    const intensities: number[] = [];
    
    for (const storm of retryPatterns) {
      // Analyze time series for patterns
      const timeSeries = storm.timeSeries || [];
      const pattern = this.identifyTemporalPattern(timeSeries);
      patterns.push(pattern);
      
      // Calculate storm duration
      const activeMinutes = timeSeries.filter((b: any) => b.request_rate?.value > 0).length;
      durations.push(activeMinutes);
      
      // Calculate intensity
      const avgRate = this.calculateAverage(
        timeSeries.map((b: any) => b.request_rate?.value || 0)
      );
      intensities.push(avgRate);
    }
    
    // Detect periodicity
    const periodicity = this.detectPeriodicity(retryPatterns);
    
    return {
      patterns: this.consolidatePatterns(patterns),
      duration: {
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: this.calculateAverage(durations)
      },
      intensity: {
        min: Math.min(...intensities),
        max: Math.max(...intensities),
        avg: this.calculateAverage(intensities)
      },
      periodicity
    };
  }
  
  private identifyTemporalPattern(timeSeries: any[]): any {
    if (timeSeries.length < 3) {
      return { type: 'insufficient_data' };
    }
    
    const rates = timeSeries.map((b: any) => b.request_rate?.value || 0);
    
    // Check for exponential growth
    let exponentialGrowth = true;
    for (let i = 1; i < rates.length - 1; i++) {
      if (rates[i] > 0 && rates[i + 1] > 0) {
        const growthRate = rates[i + 1] / rates[i];
        if (growthRate < 1.5) {
          exponentialGrowth = false;
          break;
        }
      }
    }
    
    if (exponentialGrowth && rates[rates.length - 1] > rates[0] * 2) {
      return {
        type: 'exponential_growth',
        severity: 'critical',
        description: 'Retry rate growing exponentially'
      };
    }
    
    // Check for steady state
    const avgRate = this.calculateAverage(rates);
    const stdDev = this.calculateStdDev(rates);
    const cv = stdDev / avgRate;
    
    if (cv < 0.3) {
      return {
        type: 'steady_state',
        severity: 'medium',
        description: 'Constant retry rate'
      };
    }
    
    // Check for oscillating pattern
    let oscillations = 0;
    for (let i = 1; i < rates.length - 1; i++) {
      if ((rates[i] > rates[i - 1] && rates[i] > rates[i + 1]) ||
          (rates[i] < rates[i - 1] && rates[i] < rates[i + 1])) {
        oscillations++;
      }
    }
    
    if (oscillations > rates.length / 3) {
      return {
        type: 'oscillating',
        severity: 'high',
        description: 'Retry rate oscillating'
      };
    }
    
    return {
      type: 'irregular',
      severity: 'medium',
      description: 'Irregular retry pattern'
    };
  }
  
  private consolidatePatterns(patterns: any[]): any {
    const patternCounts = new Map<string, number>();
    
    patterns.forEach(p => {
      patternCounts.set(p.type, (patternCounts.get(p.type) || 0) + 1);
    });
    
    return Array.from(patternCounts.entries())
      .map(([type, count]) => ({
        type,
        count,
        percentage: (count / patterns.length) * 100
      }))
      .sort((a, b) => b.count - a.count);
  }
  
  private detectPeriodicity(retryPatterns: any[]): any {
    // Simple periodicity detection
    const intervals: number[] = [];
    
    for (let i = 1; i < retryPatterns.length; i++) {
      const prevTime = new Date(retryPatterns[i - 1].timeWindow.from).getTime();
      const currTime = new Date(retryPatterns[i].timeWindow.from).getTime();
      intervals.push(currTime - prevTime);
    }
    
    if (intervals.length < 2) {
      return { periodic: false, reason: 'Insufficient data' };
    }
    
    const avgInterval = this.calculateAverage(intervals);
    const stdDev = this.calculateStdDev(intervals);
    const cv = stdDev / avgInterval;
    
    if (cv < 0.2) {
      return {
        periodic: true,
        intervalMs: avgInterval,
        intervalMinutes: avgInterval / (60 * 1000),
        confidence: 1 - cv
      };
    }
    
    return { periodic: false, reason: 'Irregular intervals' };
  }
  
  private async identifyRootCauses(retryPatterns: any[], timeRange: any): Promise<any> {
    const config = ConfigLoader.get();
    const rootCauses = {
      primary: [] as any[],
      contributing: [] as any[],
      correlations: [] as any[]
    };
    
    // Analyze error types associated with retries
    for (const pattern of retryPatterns.slice(0, 5)) { // Top 5 patterns
      const errorQuery = {
        bool: {
          must: [
            { term: { [config.telemetry.fields.service]: pattern.service } },
            { term: { 'http.url.keyword': pattern.endpoint } },
            { range: { [config.telemetry.fields.timestamp]: timeRange } },
            { exists: { field: 'error.type' } }
          ]
        }
      };
      
      const errorResult = await this.adapter.query(
        config.telemetry.indices.traces,
        errorQuery,
        {
          size: 0,
          aggregations: {
            error_types: {
              terms: { field: 'error.type.keyword', size: 10 }
            },
            status_codes: {
              terms: { field: 'http.status_code', size: 10 }
            }
          }
        }
      );
      
      const errorTypes = errorResult.aggregations?.error_types?.buckets || [];
      const statusCodes = errorResult.aggregations?.status_codes?.buckets || [];
      
      // Identify primary causes
      if (errorTypes.length > 0) {
        const topError = errorTypes[0];
        if (topError.key.includes('timeout') || topError.key.includes('Timeout')) {
          rootCauses.primary.push({
            type: 'timeout',
            service: pattern.service,
            endpoint: pattern.endpoint,
            evidence: `${topError.doc_count} timeout errors`,
            severity: 'high'
          });
        } else if (topError.key.includes('connection') || topError.key.includes('Connection')) {
          rootCauses.primary.push({
            type: 'connection_failure',
            service: pattern.service,
            endpoint: pattern.endpoint,
            evidence: `${topError.doc_count} connection errors`,
            severity: 'high'
          });
        }
      }
      
      // Check status codes
      const serverErrors = statusCodes.filter((s: any) => s.key >= 500);
      const clientErrors = statusCodes.filter((s: any) => s.key >= 400 && s.key < 500);
      
      if (serverErrors.length > 0) {
        rootCauses.contributing.push({
          type: 'server_errors',
          service: pattern.service,
          codes: serverErrors.map((s: any) => ({ code: s.key, count: s.doc_count })),
          severity: 'medium'
        });
      }
      
      if (clientErrors.some((s: any) => s.key === 429)) {
        rootCauses.primary.push({
          type: 'rate_limiting',
          service: pattern.service,
          endpoint: pattern.endpoint,
          evidence: 'HTTP 429 responses detected',
          severity: 'critical'
        });
      }
    }
    
    // Look for correlations
    rootCauses.correlations = this.findCauseCorrelations(rootCauses.primary);
    
    return rootCauses;
  }
  
  private findCauseCorrelations(primaryCauses: any[]): any[] {
    const correlations: any[] = [];
    
    // Group by cause type
    const causeGroups = new Map<string, any[]>();
    primaryCauses.forEach(cause => {
      if (!causeGroups.has(cause.type)) {
        causeGroups.set(cause.type, []);
      }
      causeGroups.get(cause.type)?.push(cause);
    });
    
    // Find patterns
    for (const [type, causes] of causeGroups) {
      if (causes.length > 2) {
        correlations.push({
          pattern: `Multiple services experiencing ${type}`,
          affectedServices: [...new Set(causes.map(c => c.service))],
          likelihood: 'high',
          interpretation: `Systemic ${type} issue across services`
        });
      }
    }
    
    return correlations;
  }
  
  private async calculateRetryImpact(
    retryPatterns: any[],
    includeDownstream: boolean
  ): Promise<any> {
    const affectedServices = new Set<string>();
    let totalRetryRequests = 0;
    let totalNormalRequests = 0;
    
    // Calculate direct impact
    retryPatterns.forEach(pattern => {
      affectedServices.add(pattern.service);
      totalRetryRequests += pattern.retryRequests;
      totalNormalRequests += pattern.totalRequests - pattern.retryRequests;
    });
    
    // Estimate resource waste
    const avgRetryCount = 3; // Assume average 3 retries per failed request
    const wastedRequests = totalRetryRequests * (avgRetryCount - 1);
    const resourceWaste = {
      wastedRequests,
      wastedPercentage: (wastedRequests / (totalRetryRequests + totalNormalRequests)) * 100,
      estimatedCost: this.estimateRetryCost(wastedRequests)
    };
    
    // Estimate user impact
    const userImpact = {
      affectedRequests: totalRetryRequests,
      successRate: totalNormalRequests / (totalRetryRequests + totalNormalRequests) * 100,
      additionalLatency: this.estimateAdditionalLatency(retryPatterns),
      severity: totalRetryRequests > 10000 ? 'high' : 
                totalRetryRequests > 1000 ? 'medium' : 'low'
    };
    
    // Calculate cascading risk
    const cascadingRisk = {
      risk: retryPatterns.some(p => p.severity === 'critical') ? 'high' :
            retryPatterns.length > 5 ? 'medium' : 'low',
      affectedServiceCount: affectedServices.size,
      amplificationPotential: this.calculateAmplificationPotential(retryPatterns)
    };
    
    return {
      affectedServices: Array.from(affectedServices),
      resourceWaste,
      userImpact,
      cascadingRisk
    };
  }
  
  private estimateRetryCost(wastedRequests: number): any {
    // Simple cost estimation
    const costPerRequest = 0.0001; // $0.0001 per request
    const computeCost = wastedRequests * costPerRequest;
    
    return {
      computeCost,
      networkCost: computeCost * 0.3, // Assume 30% additional network cost
      totalCost: computeCost * 1.3,
      hourlyRate: (computeCost * 1.3) * 60 // Extrapolate to hourly
    };
  }
  
  private estimateAdditionalLatency(retryPatterns: any[]): any {
    // Estimate additional latency from retries
    const baseLatency = 100; // ms
    const retryDelay = 1000; // ms between retries
    const avgRetries = 3;
    
    return {
      perRequest: baseLatency * avgRetries + retryDelay * (avgRetries - 1),
      p95Impact: baseLatency * avgRetries * 2 + retryDelay * (avgRetries - 1),
      userExperience: 'Significant delays for affected requests'
    };
  }
  
  private calculateAmplificationPotential(retryPatterns: any[]): number {
    // Calculate potential for retry amplification
    let potential = 1;
    
    retryPatterns.forEach(pattern => {
      if (pattern.retryRatio > 5) potential *= 1.5;
      else if (pattern.retryRatio > 3) potential *= 1.3;
      else if (pattern.retryRatio > 2) potential *= 1.1;
    });
    
    return Math.min(potential, 10); // Cap at 10x
  }
  
  private async detectCascadingRetries(
    retryPatterns: any[],
    timeRange: any,
    includeDownstream: boolean
  ): Promise<any[]> {
    if (!includeDownstream) return [];
    
    const config = ConfigLoader.get();
    const cascadingPatterns: any[] = [];
    
    // For each retry storm, check if it triggered downstream retries
    for (const pattern of retryPatterns.slice(0, 5)) { // Top 5
      const downstreamQuery = {
        bool: {
          must: [
            { range: { [config.telemetry.fields.timestamp]: timeRange } },
            { term: { 'upstream.service.keyword': pattern.service } }
          ]
        }
      };
      
      const downstreamResult = await this.adapter.query(
        config.telemetry.indices.traces,
        downstreamQuery,
        {
          size: 0,
          aggregations: {
            downstream_services: {
              terms: { field: config.telemetry.fields.service, size: 20 },
              aggs: {
                retry_rate: {
                  filters: {
                    filters: {
                      retries: {
                        bool: {
                          should: [
                            { term: { 'http.retry': true } },
                            { range: { 'http.retry_count': { gt: 0 } } }
                          ]
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      );
      
      const downstreamServices = downstreamResult.aggregations?.downstream_services?.buckets || [];
      
      for (const downstream of downstreamServices) {
        const retryCount = downstream.retry_rate?.buckets?.retries?.doc_count || 0;
        const totalCount = downstream.doc_count;
        const retryRate = retryCount / totalCount;
        
        if (retryRate > 0.2) { // 20% retry rate threshold
          cascadingPatterns.push({
            source: pattern.service,
            target: downstream.key,
            sourceRetryRatio: pattern.retryRatio,
            targetRetryRatio: retryRate,
            amplification: retryRate / pattern.retryRatio,
            pattern: `${pattern.service} → ${downstream.key}`
          });
        }
      }
    }
    
    return cascadingPatterns;
  }
  
  private calculateAmplificationFactor(cascadingPatterns: any[]): number {
    if (cascadingPatterns.length === 0) return 1;
    
    const amplifications = cascadingPatterns.map(p => p.amplification);
    return Math.max(...amplifications);
  }
  
  private generateMitigationStrategies(
    stormAnalysis: any,
    rootCauses: any,
    cascadingPatterns: any[]
  ): any {
    const strategies = {
      immediate: [] as any[],
      shortTerm: [] as any[],
      longTerm: [] as any[]
    };
    
    // Immediate actions based on root causes
    if (rootCauses.primary.some((c: any) => c.type === 'rate_limiting')) {
      strategies.immediate.push({
        action: 'Implement exponential backoff with jitter',
        priority: 'critical',
        impact: 'Prevents retry storm escalation',
        implementation: 'Add exponential backoff to retry logic'
      });
    }
    
    if (rootCauses.primary.some((c: any) => c.type === 'timeout')) {
      strategies.immediate.push({
        action: 'Increase timeout values temporarily',
        priority: 'high',
        impact: 'Reduces timeout-induced retries',
        implementation: 'Adjust client timeout settings'
      });
    }
    
    // Short-term strategies
    strategies.shortTerm.push({
      action: 'Implement circuit breakers',
      priority: 'high',
      impact: 'Prevents cascading failures',
      implementation: 'Add circuit breaker pattern to service calls'
    });
    
    if (cascadingPatterns.length > 0) {
      strategies.shortTerm.push({
        action: 'Add retry budgets',
        priority: 'high',
        impact: 'Limits total retry attempts',
        implementation: 'Implement per-service retry budgets'
      });
    }
    
    // Long-term strategies
    strategies.longTerm.push({
      action: 'Implement adaptive retry strategies',
      priority: 'medium',
      impact: 'Dynamically adjusts retry behavior',
      implementation: 'Use ML-based retry decision making'
    });
    
    if (stormAnalysis.patterns.some((p: any) => p.type === 'exponential_growth')) {
      strategies.longTerm.push({
        action: 'Review service capacity and scaling',
        priority: 'medium',
        impact: 'Prevents overload conditions',
        implementation: 'Implement predictive autoscaling'
      });
    }
    
    return strategies;
  }
  
  private generateRetryStormInsights(
    retryPatterns: any[],
    stormAnalysis: any,
    rootCauses: any,
    impact: any
  ): any[] {
    const insights: any[] = [];
    
    // Pattern insights
    const dominantPattern = stormAnalysis.patterns[0];
    if (dominantPattern && dominantPattern.type === 'exponential_growth') {
      insights.push({
        type: 'exponential_retry_growth',
        severity: 'critical',
        description: 'Retry storms showing exponential growth pattern',
        recommendation: 'Implement circuit breakers immediately'
      });
    }
    
    // Root cause insights
    if (rootCauses.primary.some((c: any) => c.type === 'rate_limiting')) {
      insights.push({
        type: 'rate_limit_induced',
        severity: 'high',
        description: 'Retry storms triggered by rate limiting',
        recommendation: 'Implement proper backoff and respect rate limits'
      });
    }
    
    // Impact insights
    if (impact.resourceWaste.wastedPercentage > 50) {
      insights.push({
        type: 'high_resource_waste',
        severity: 'high',
        description: `${impact.resourceWaste.wastedPercentage.toFixed(1)}% of requests are wasteful retries`,
        recommendation: 'Optimize retry logic to reduce waste'
      });
    }
    
    // Cascading insights
    if (impact.cascadingRisk.risk === 'high') {
      insights.push({
        type: 'cascading_risk',
        severity: 'critical',
        description: 'High risk of cascading retry storms',
        recommendation: 'Implement service isolation and bulkheads'
      });
    }
    
    return insights;
  }
  
  private generateRetryStormSummary(
    retryPatterns: any[],
    impact: any,
    mitigationStrategies: any
  ): string {
    const parts: string[] = [];
    
    parts.push(`Detected ${retryPatterns.length} retry storms.`);
    
    const criticalStorms = retryPatterns.filter(p => p.severity === 'critical').length;
    if (criticalStorms > 0) {
      parts.push(`${criticalStorms} critical severity.`);
    }
    
    parts.push(`${impact.affectedServices.length} services affected.`);
    
    if (mitigationStrategies.immediate.length > 0) {
      parts.push('Immediate action required.');
    }
    
    return parts.join(' ');
  }
  
  // Helper methods
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.calculateAverage(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = this.calculateAverage(squaredDiffs);
    return Math.sqrt(variance);
  }
}
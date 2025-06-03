import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const CanaryAnalysisArgsSchema = {
  canaryService: z.string().describe('The canary service/version to analyze'),
  baselineService: z.string().describe('The baseline service/version to compare against'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  metrics: z.array(z.string()).optional().describe('Specific metrics to compare (default: all key metrics)'),
  confidenceLevel: z.number().optional().describe('Statistical confidence level (default: 0.95)'),
  minSampleSize: z.number().optional().describe('Minimum sample size for comparison (default: 100)')
};

type CanaryAnalysisArgs = MCPToolSchema<typeof CanaryAnalysisArgsSchema>;

/**
 * Tool for comparing canary deployments against baseline to detect regressions
 */
export class CanaryAnalysisTool extends BaseTool<typeof CanaryAnalysisArgsSchema> {
  // Static schema property
  static readonly schema = CanaryAnalysisArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'compareCanaryDeployment',
      category: ToolCategory.ANALYSIS,
      description: 'Compare canary deployment metrics against baseline to validate safe rollout',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return CanaryAnalysisArgsSchema;
  }
  
  protected async executeImpl(args: CanaryAnalysisArgs): Promise<any> {
    const config = ConfigLoader.get();
    const confidenceLevel = args.confidenceLevel || 0.95;
    const minSampleSize = args.minSampleSize || 100;
    const timeRange = { from: args.from, to: args.to };
    
    // Collect metrics for both canary and baseline
    const [canaryMetrics, baselineMetrics] = await Promise.all([
      this.collectServiceMetrics(args.canaryService, timeRange, args.metrics),
      this.collectServiceMetrics(args.baselineService, timeRange, args.metrics)
    ]);
    
    // Validate sample sizes
    const sampleValidation = this.validateSampleSizes(
      canaryMetrics.sampleSize,
      baselineMetrics.sampleSize,
      minSampleSize
    );
    
    if (!sampleValidation.valid) {
      return this.formatJsonOutput({
        status: 'insufficient_data',
        message: sampleValidation.message,
        canaryService: args.canaryService,
        baselineService: args.baselineService,
        canarysamples: canaryMetrics.sampleSize,
        baselineSamples: baselineMetrics.sampleSize,
        requiredSamples: minSampleSize
      });
    }
    
    // Perform statistical comparison
    const comparison = this.performStatisticalComparison(
      canaryMetrics,
      baselineMetrics,
      confidenceLevel
    );
    
    // Analyze error patterns
    const errorAnalysis = await this.analyzeErrorPatterns(
      args.canaryService,
      args.baselineService,
      timeRange
    );
    
    // Calculate deployment score
    const deploymentScore = this.calculateDeploymentScore(comparison, errorAnalysis);
    
    // Generate deployment recommendation
    const recommendation = this.generateDeploymentRecommendation(
      deploymentScore,
      comparison,
      errorAnalysis
    );
    
    // Identify risk factors
    const riskFactors = this.identifyRiskFactors(comparison, errorAnalysis);
    
    return this.formatJsonOutput({
      analysis: {
        canaryService: args.canaryService,
        baselineService: args.baselineService,
        timeRange: timeRange,
        sampleSizes: {
          canary: canaryMetrics.sampleSize,
          baseline: baselineMetrics.sampleSize
        },
        confidenceLevel
      },
      comparison: {
        latency: comparison.latency,
        errorRate: comparison.errorRate,
        throughput: comparison.throughput,
        customMetrics: comparison.customMetrics
      },
      statisticalSignificance: {
        overallSignificant: comparison.overallSignificant,
        significantMetrics: comparison.significantMetrics,
        pValues: comparison.pValues
      },
      errorAnalysis: {
        newErrors: errorAnalysis.newErrors,
        errorRateChange: errorAnalysis.errorRateChange,
        errorPatterns: errorAnalysis.patterns
      },
      deploymentScore: {
        score: deploymentScore.score,
        grade: deploymentScore.grade,
        breakdown: deploymentScore.breakdown
      },
      recommendation: {
        decision: recommendation.decision,
        confidence: recommendation.confidence,
        reasoning: recommendation.reasoning,
        actions: recommendation.actions
      },
      riskFactors,
      insights: this.generateCanaryInsights(comparison, errorAnalysis, deploymentScore),
      summary: this.generateCanarySummary(deploymentScore, recommendation)
    });
  }
  
  private async collectServiceMetrics(
    service: string,
    timeRange: any,
    specificMetrics?: string[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Query traces for latency and success metrics
    const traceQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    const traceResult = await this.adapter.query(
      config.telemetry.indices.traces,
      traceQuery,
      {
        size: 0,
        aggregations: {
          total_requests: { value_count: { field: config.telemetry.fields.traceId } },
          latency_percentiles: {
            percentiles: {
              field: 'duration',
              percents: [50, 75, 90, 95, 99]
            }
          },
          latency_histogram: {
            histogram: {
              field: 'duration',
              interval: 50
            }
          },
          error_rate: {
            filters: {
              filters: {
                errors: { term: { [config.telemetry.fields.status]: 'ERROR' } },
                success: { term: { [config.telemetry.fields.status]: 'OK' } }
              }
            }
          },
          requests_over_time: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m'
            },
            aggs: {
              latency_p95: { percentiles: { field: 'duration', percents: [95] } }
            }
          }
        }
      }
    );
    
    // Query custom metrics if specified
    let customMetrics = {};
    if (specificMetrics && specificMetrics.length > 0) {
      customMetrics = await this.collectCustomMetrics(service, timeRange, specificMetrics);
    }
    
    // Extract latency distribution
    const latencyValues = (traceResult.aggregations?.latency_histogram?.buckets || [])
      .flatMap((bucket: any) => Array(bucket.doc_count).fill(bucket.key));
    
    return {
      sampleSize: traceResult.hits.total.value,
      latency: {
        values: latencyValues,
        percentiles: traceResult.aggregations?.latency_percentiles?.values || {},
        mean: this.calculateMean(latencyValues),
        stdDev: this.calculateStdDev(latencyValues)
      },
      errorRate: {
        errors: traceResult.aggregations?.error_rate?.buckets?.errors?.doc_count || 0,
        success: traceResult.aggregations?.error_rate?.buckets?.success?.doc_count || 0,
        rate: this.calculateErrorRate(traceResult.aggregations?.error_rate?.buckets)
      },
      throughput: {
        total: traceResult.hits.total.value,
        timeline: traceResult.aggregations?.requests_over_time?.buckets || []
      },
      customMetrics
    };
  }
  
  private async collectCustomMetrics(
    service: string,
    timeRange: any,
    metrics: string[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    const customMetrics: any = {};
    
    for (const metric of metrics) {
      const metricQuery = {
        bool: {
          must: [
            { term: { [config.telemetry.fields.service]: service } },
            { range: { [config.telemetry.fields.timestamp]: timeRange } },
            { exists: { field: metric } }
          ]
        }
      };
      
      const result = await this.adapter.query(
        config.telemetry.indices.metrics,
        metricQuery,
        {
          size: 0,
          aggregations: {
            metric_stats: { extended_stats: { field: metric } },
            metric_percentiles: {
              percentiles: { field: metric, percents: [50, 90, 95, 99] }
            }
          }
        }
      );
      
      if (result.hits.total.value > 0) {
        customMetrics[metric] = {
          stats: result.aggregations?.metric_stats || {},
          percentiles: result.aggregations?.metric_percentiles?.values || {}
        };
      }
    }
    
    return customMetrics;
  }
  
  private validateSampleSizes(
    canarySamples: number,
    baselineSamples: number,
    minRequired: number
  ): any {
    if (canarySamples < minRequired) {
      return {
        valid: false,
        message: `Insufficient canary samples: ${canarySamples} < ${minRequired}`
      };
    }
    
    if (baselineSamples < minRequired) {
      return {
        valid: false,
        message: `Insufficient baseline samples: ${baselineSamples} < ${minRequired}`
      };
    }
    
    // Check for severely imbalanced samples
    const ratio = Math.max(canarySamples, baselineSamples) / 
                  Math.min(canarySamples, baselineSamples);
    
    if (ratio > 10) {
      return {
        valid: false,
        message: `Sample sizes too imbalanced: ratio ${ratio.toFixed(1)}:1`
      };
    }
    
    return { valid: true };
  }
  
  private performStatisticalComparison(
    canaryMetrics: any,
    baselineMetrics: any,
    confidenceLevel: number
  ): any {
    const comparison: any = {
      latency: {},
      errorRate: {},
      throughput: {},
      customMetrics: {},
      significantMetrics: [],
      pValues: {},
      overallSignificant: false
    };
    
    // Compare latency
    const latencyComparison = this.compareDistributions(
      canaryMetrics.latency,
      baselineMetrics.latency,
      'latency',
      confidenceLevel
    );
    comparison.latency = latencyComparison;
    comparison.pValues.latency = latencyComparison.pValue;
    if (latencyComparison.significant) {
      comparison.significantMetrics.push('latency');
    }
    
    // Compare error rates
    const errorComparison = this.compareProportions(
      canaryMetrics.errorRate,
      baselineMetrics.errorRate,
      'errorRate',
      confidenceLevel
    );
    comparison.errorRate = errorComparison;
    comparison.pValues.errorRate = errorComparison.pValue;
    if (errorComparison.significant) {
      comparison.significantMetrics.push('errorRate');
    }
    
    // Compare throughput
    const throughputComparison = this.compareThroughput(
      canaryMetrics.throughput,
      baselineMetrics.throughput,
      confidenceLevel
    );
    comparison.throughput = throughputComparison;
    comparison.pValues.throughput = throughputComparison.pValue;
    if (throughputComparison.significant) {
      comparison.significantMetrics.push('throughput');
    }
    
    // Compare custom metrics
    for (const [metric, canaryData] of Object.entries(canaryMetrics.customMetrics)) {
      const baselineData = baselineMetrics.customMetrics[metric];
      if (baselineData) {
        const metricComparison = this.compareCustomMetric(
          canaryData,
          baselineData,
          metric,
          confidenceLevel
        );
        comparison.customMetrics[metric] = metricComparison;
        comparison.pValues[metric] = metricComparison.pValue;
        if (metricComparison.significant) {
          comparison.significantMetrics.push(metric);
        }
      }
    }
    
    comparison.overallSignificant = comparison.significantMetrics.length > 0;
    
    return comparison;
  }
  
  private compareDistributions(
    canaryDist: any,
    baselineDist: any,
    metricName: string,
    confidenceLevel: number
  ): any {
    // Calculate statistics
    const canaryMean = canaryDist.mean;
    const baselineMean = baselineDist.mean;
    const canaryStdDev = canaryDist.stdDev;
    const baselineStdDev = baselineDist.stdDev;
    
    // Perform Welch's t-test for unequal variances
    const n1 = canaryDist.values.length;
    const n2 = baselineDist.values.length;
    
    const standardError = Math.sqrt((canaryStdDev * canaryStdDev) / n1 + 
                                   (baselineStdDev * baselineStdDev) / n2);
    
    const tStatistic = standardError > 0 ? 
      (canaryMean - baselineMean) / standardError : 0;
    
    // Approximate degrees of freedom (Welch-Satterthwaite)
    const df = this.calculateWelchDF(
      canaryStdDev, n1,
      baselineStdDev, n2
    );
    
    // Calculate p-value (two-tailed)
    const pValue = this.calculatePValue(Math.abs(tStatistic), df);
    const significant = pValue < (1 - confidenceLevel);
    
    // Calculate effect size (Cohen's d)
    const pooledStdDev = Math.sqrt(
      ((n1 - 1) * canaryStdDev * canaryStdDev + 
       (n2 - 1) * baselineStdDev * baselineStdDev) / 
      (n1 + n2 - 2)
    );
    const effectSize = pooledStdDev > 0 ? 
      (canaryMean - baselineMean) / pooledStdDev : 0;
    
    return {
      canary: {
        mean: canaryMean,
        p50: canaryDist.percentiles['50.0'],
        p95: canaryDist.percentiles['95.0'],
        p99: canaryDist.percentiles['99.0']
      },
      baseline: {
        mean: baselineMean,
        p50: baselineDist.percentiles['50.0'],
        p95: baselineDist.percentiles['95.0'],
        p99: baselineDist.percentiles['99.0']
      },
      difference: {
        absolute: canaryMean - baselineMean,
        percentage: baselineMean > 0 ? 
          ((canaryMean - baselineMean) / baselineMean) * 100 : 0
      },
      statistical: {
        tStatistic,
        pValue,
        significant,
        effectSize,
        interpretation: this.interpretEffectSize(effectSize)
      }
    };
  }
  
  private compareProportions(
    canaryProp: any,
    baselineProp: any,
    metricName: string,
    confidenceLevel: number
  ): any {
    const n1 = canaryProp.errors + canaryProp.success;
    const n2 = baselineProp.errors + baselineProp.success;
    const p1 = canaryProp.rate;
    const p2 = baselineProp.rate;
    
    // Pooled proportion
    const pPooled = (canaryProp.errors + baselineProp.errors) / (n1 + n2);
    
    // Standard error
    const standardError = Math.sqrt(
      pPooled * (1 - pPooled) * (1/n1 + 1/n2)
    );
    
    // Z-statistic
    const zStatistic = standardError > 0 ? 
      (p1 - p2) / standardError : 0;
    
    // P-value (two-tailed)
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zStatistic)));
    const significant = pValue < (1 - confidenceLevel);
    
    return {
      canary: {
        rate: p1 * 100,
        count: canaryProp.errors,
        total: n1
      },
      baseline: {
        rate: p2 * 100,
        count: baselineProp.errors,
        total: n2
      },
      difference: {
        absolute: (p1 - p2) * 100,
        relative: p2 > 0 ? ((p1 - p2) / p2) * 100 : 0
      },
      statistical: {
        zStatistic,
        pValue,
        significant,
        interpretation: significant ? 
          (p1 > p2 ? 'Significantly worse' : 'Significantly better') : 
          'No significant difference'
      }
    };
  }
  
  private compareThroughput(
    canaryThroughput: any,
    baselineThroughput: any,
    confidenceLevel: number
  ): any {
    // Calculate rates per minute
    const canaryRates = canaryThroughput.timeline.map((b: any) => b.doc_count);
    const baselineRates = baselineThroughput.timeline.map((b: any) => b.doc_count);
    
    const canaryMean = this.calculateMean(canaryRates);
    const baselineMean = this.calculateMean(baselineRates);
    const canaryStdDev = this.calculateStdDev(canaryRates);
    const baselineStdDev = this.calculateStdDev(baselineRates);
    
    // Perform comparison
    const comparison = this.compareDistributions(
      { mean: canaryMean, stdDev: canaryStdDev, values: canaryRates, percentiles: {} },
      { mean: baselineMean, stdDev: baselineStdDev, values: baselineRates, percentiles: {} },
      'throughput',
      confidenceLevel
    );
    
    return {
      canary: {
        meanRate: canaryMean,
        totalRequests: canaryThroughput.total
      },
      baseline: {
        meanRate: baselineMean,
        totalRequests: baselineThroughput.total
      },
      difference: comparison.difference,
      statistical: comparison.statistical
    };
  }
  
  private compareCustomMetric(
    canaryMetric: any,
    baselineMetric: any,
    metricName: string,
    confidenceLevel: number
  ): any {
    const canaryStats = canaryMetric.stats;
    const baselineStats = baselineMetric.stats;
    
    return {
      canary: {
        mean: canaryStats.avg,
        p50: canaryMetric.percentiles['50.0'],
        p95: canaryMetric.percentiles['95.0']
      },
      baseline: {
        mean: baselineStats.avg,
        p50: baselineMetric.percentiles['50.0'],
        p95: baselineMetric.percentiles['95.0']
      },
      difference: {
        absolute: canaryStats.avg - baselineStats.avg,
        percentage: baselineStats.avg > 0 ? 
          ((canaryStats.avg - baselineStats.avg) / baselineStats.avg) * 100 : 0
      },
      pValue: 0.05 // Simplified - would need raw values for proper test
    };
  }
  
  private async analyzeErrorPatterns(
    canaryService: string,
    baselineService: string,
    timeRange: any
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Get error types for both services
    const [canaryErrors, baselineErrors] = await Promise.all([
      this.getServiceErrors(canaryService, timeRange),
      this.getServiceErrors(baselineService, timeRange)
    ]);
    
    // Identify new error types in canary
    const newErrors = canaryErrors.types.filter((error: any) => 
      !baselineErrors.types.some((be: any) => be.type === error.type)
    );
    
    // Compare error rates
    const errorRateChange = {
      canary: canaryErrors.rate,
      baseline: baselineErrors.rate,
      change: canaryErrors.rate - baselineErrors.rate,
      percentageChange: baselineErrors.rate > 0 ? 
        ((canaryErrors.rate - baselineErrors.rate) / baselineErrors.rate) * 100 : 0
    };
    
    // Analyze error patterns
    const patterns = this.identifyErrorPatterns(canaryErrors, baselineErrors);
    
    return {
      newErrors,
      errorRateChange,
      patterns,
      canaryErrors,
      baselineErrors
    };
  }
  
  private async getServiceErrors(service: string, timeRange: any): Promise<any> {
    const config = ConfigLoader.get();
    
    const query = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { term: { [config.telemetry.fields.status]: 'ERROR' } }
        ]
      }
    };
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          total_requests: {
            cardinality: { field: config.telemetry.fields.traceId }
          },
          error_types: {
            terms: { field: 'error.type.keyword', size: 20 }
          },
          error_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            }
          }
        }
      }
    );
    
    // Get total requests for error rate calculation
    const totalQuery = {
      bool: {
        must: [
          { term: { [config.telemetry.fields.service]: service } },
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ]
      }
    };
    
    const totalResult = await this.adapter.query(
      config.telemetry.indices.traces,
      totalQuery,
      {
        size: 0,
        aggregations: {
          total: { cardinality: { field: config.telemetry.fields.traceId } }
        }
      }
    );
    
    const errorCount = result.hits.total.value;
    const totalCount = totalResult.aggregations?.total?.value || 1;
    
    return {
      count: errorCount,
      total: totalCount,
      rate: (errorCount / totalCount) * 100,
      types: (result.aggregations?.error_types?.buckets || []).map((b: any) => ({
        type: b.key,
        count: b.doc_count,
        percentage: (b.doc_count / errorCount) * 100
      })),
      timeline: result.aggregations?.error_timeline?.buckets || []
    };
  }
  
  private identifyErrorPatterns(canaryErrors: any, baselineErrors: any): any[] {
    const patterns: any[] = [];
    
    // Check for error spikes
    const canarySpikes = this.detectSpikes(canaryErrors.timeline);
    if (canarySpikes.length > 0) {
      patterns.push({
        type: 'error_spike',
        severity: 'high',
        description: `${canarySpikes.length} error spikes detected in canary`,
        times: canarySpikes
      });
    }
    
    // Check for consistent increase
    if (canaryErrors.rate > baselineErrors.rate * 1.5) {
      patterns.push({
        type: 'consistent_increase',
        severity: 'medium',
        description: `Error rate ${canaryErrors.rate.toFixed(2)}% vs baseline ${baselineErrors.rate.toFixed(2)}%`
      });
    }
    
    return patterns;
  }
  
  private detectSpikes(timeline: any[]): any[] {
    if (timeline.length < 3) return [];
    
    const values = timeline.map(b => b.doc_count);
    const mean = this.calculateMean(values);
    const stdDev = this.calculateStdDev(values);
    const threshold = mean + (2 * stdDev);
    
    return timeline
      .filter(b => b.doc_count > threshold)
      .map(b => ({
        time: b.key_as_string,
        count: b.doc_count,
        severity: b.doc_count > mean + (3 * stdDev) ? 'high' : 'medium'
      }));
  }
  
  private calculateDeploymentScore(comparison: any, errorAnalysis: any): any {
    let score = 100;
    const breakdown: any[] = [];
    
    // Latency impact (-30 points max)
    if (comparison.latency.statistical?.significant) {
      const latencyImpact = Math.min(30, 
        Math.abs(comparison.latency.difference.percentage) * 0.5
      );
      score -= comparison.latency.difference.percentage > 0 ? latencyImpact : 0;
      breakdown.push({
        metric: 'latency',
        impact: -latencyImpact,
        reason: `${comparison.latency.difference.percentage.toFixed(1)}% change`
      });
    }
    
    // Error rate impact (-40 points max)
    if (comparison.errorRate.statistical?.significant) {
      const errorImpact = Math.min(40, 
        Math.abs(comparison.errorRate.difference.absolute) * 10
      );
      score -= comparison.errorRate.difference.absolute > 0 ? errorImpact : 0;
      breakdown.push({
        metric: 'errorRate',
        impact: -errorImpact,
        reason: `${comparison.errorRate.difference.absolute.toFixed(2)}% point change`
      });
    }
    
    // New errors impact (-20 points max)
    if (errorAnalysis.newErrors.length > 0) {
      const newErrorImpact = Math.min(20, errorAnalysis.newErrors.length * 10);
      score -= newErrorImpact;
      breakdown.push({
        metric: 'newErrors',
        impact: -newErrorImpact,
        reason: `${errorAnalysis.newErrors.length} new error types`
      });
    }
    
    // Throughput impact (-10 points max)
    if (comparison.throughput.statistical?.significant) {
      const throughputChange = comparison.throughput.difference.percentage;
      if (throughputChange < -10) {
        const throughputImpact = Math.min(10, Math.abs(throughputChange) * 0.2);
        score -= throughputImpact;
        breakdown.push({
          metric: 'throughput',
          impact: -throughputImpact,
          reason: `${throughputChange.toFixed(1)}% decrease`
        });
      }
    }
    
    // Ensure score is between 0 and 100
    score = Math.max(0, Math.min(100, score));
    
    return {
      score,
      grade: this.getDeploymentGrade(score),
      breakdown,
      interpretation: this.interpretDeploymentScore(score)
    };
  }
  
  private getDeploymentGrade(score: number): string {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'C+';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
  
  private interpretDeploymentScore(score: number): string {
    if (score >= 95) return 'Excellent - Canary performs as well or better than baseline';
    if (score >= 85) return 'Good - Minor regressions detected but acceptable';
    if (score >= 75) return 'Fair - Some concerns but may be acceptable';
    if (score >= 60) return 'Poor - Significant regressions detected';
    return 'Fail - Critical regressions, do not promote';
  }
  
  private generateDeploymentRecommendation(
    deploymentScore: any,
    comparison: any,
    errorAnalysis: any
  ): any {
    let decision: string;
    let confidence: string;
    const reasoning: string[] = [];
    const actions: string[] = [];
    
    // Determine decision
    if (deploymentScore.score >= 85) {
      decision = 'PROMOTE';
      confidence = deploymentScore.score >= 95 ? 'high' : 'medium';
      reasoning.push('Canary performance is acceptable');
      actions.push('Proceed with gradual rollout');
      actions.push('Monitor key metrics during rollout');
    } else if (deploymentScore.score >= 70) {
      decision = 'INVESTIGATE';
      confidence = 'low';
      reasoning.push('Some regressions detected that need investigation');
      actions.push('Review specific regression areas');
      actions.push('Consider limited rollout with close monitoring');
    } else {
      decision = 'ROLLBACK';
      confidence = 'high';
      reasoning.push('Significant regressions detected');
      actions.push('Rollback canary immediately');
      actions.push('Investigate root causes before retry');
    }
    
    // Add specific reasoning
    if (comparison.latency.statistical?.significant && 
        comparison.latency.difference.percentage > 10) {
      reasoning.push(`Latency increased by ${comparison.latency.difference.percentage.toFixed(1)}%`);
    }
    
    if (comparison.errorRate.statistical?.significant && 
        comparison.errorRate.difference.absolute > 0) {
      reasoning.push(`Error rate increased by ${comparison.errorRate.difference.absolute.toFixed(2)} percentage points`);
    }
    
    if (errorAnalysis.newErrors.length > 0) {
      reasoning.push(`${errorAnalysis.newErrors.length} new error types introduced`);
    }
    
    return {
      decision,
      confidence,
      reasoning,
      actions
    };
  }
  
  private identifyRiskFactors(comparison: any, errorAnalysis: any): any[] {
    const riskFactors: any[] = [];
    
    // Latency tail risk
    if (comparison.latency.canary?.p99 > comparison.latency.baseline?.p99 * 1.5) {
      riskFactors.push({
        type: 'latency_tail',
        severity: 'high',
        description: 'P99 latency significantly worse',
        impact: 'Users may experience timeouts',
        mitigation: 'Investigate slow requests and add timeouts'
      });
    }
    
    // Error cascade risk
    if (errorAnalysis.newErrors.some((e: any) => e.type.includes('timeout') || e.type.includes('circuit'))) {
      riskFactors.push({
        type: 'error_cascade',
        severity: 'high',
        description: 'Timeout or circuit breaker errors detected',
        impact: 'Could cause cascading failures',
        mitigation: 'Review timeout settings and circuit breaker thresholds'
      });
    }
    
    // Capacity risk
    if (comparison.throughput.difference.percentage < -20) {
      riskFactors.push({
        type: 'capacity_degradation',
        severity: 'medium',
        description: 'Significant throughput reduction',
        impact: 'May not handle expected load',
        mitigation: 'Review resource allocation and scaling policies'
      });
    }
    
    return riskFactors;
  }
  
  private generateCanaryInsights(
    comparison: any,
    errorAnalysis: any,
    deploymentScore: any
  ): any[] {
    const insights: any[] = [];
    
    // Overall performance insight
    insights.push({
      type: 'overall_performance',
      description: `Canary deployment scored ${deploymentScore.score}/100 (${deploymentScore.grade})`,
      severity: deploymentScore.score < 70 ? 'high' : deploymentScore.score < 85 ? 'medium' : 'info'
    });
    
    // Statistical significance insight
    if (comparison.significantMetrics.length > 0) {
      insights.push({
        type: 'statistical_changes',
        description: `${comparison.significantMetrics.length} metrics show statistically significant changes`,
        metrics: comparison.significantMetrics,
        severity: comparison.significantMetrics.length > 2 ? 'high' : 'medium'
      });
    }
    
    // Error pattern insights
    if (errorAnalysis.patterns.length > 0) {
      insights.push({
        type: 'error_patterns',
        description: 'Error patterns detected in canary',
        patterns: errorAnalysis.patterns,
        severity: 'medium'
      });
    }
    
    return insights;
  }
  
  private generateCanarySummary(deploymentScore: any, recommendation: any): string {
    const parts: string[] = [];
    
    parts.push(`Canary deployment score: ${deploymentScore.score}/100 (${deploymentScore.grade}).`);
    parts.push(`Recommendation: ${recommendation.decision}.`);
    
    if (recommendation.reasoning.length > 0) {
      parts.push(recommendation.reasoning[0]);
    }
    
    return parts.join(' ');
  }
  
  // Statistical helper methods
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  private calculateStdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = this.calculateMean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const variance = this.calculateMean(squaredDiffs);
    return Math.sqrt(variance);
  }
  
  private calculateErrorRate(buckets: any): number {
    if (!buckets) return 0;
    const errors = buckets.errors?.doc_count || 0;
    const success = buckets.success?.doc_count || 0;
    const total = errors + success;
    return total > 0 ? errors / total : 0;
  }
  
  private calculateWelchDF(s1: number, n1: number, s2: number, n2: number): number {
    const v1 = (s1 * s1) / n1;
    const v2 = (s2 * s2) / n2;
    const numerator = Math.pow(v1 + v2, 2);
    const denominator = (v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1);
    return numerator / denominator;
  }
  
  private calculatePValue(tStatistic: number, df: number): number {
    // Simplified p-value calculation
    // In production, use a proper statistics library
    if (Math.abs(tStatistic) > 3.0) return 0.001;
    if (Math.abs(tStatistic) > 2.5) return 0.01;
    if (Math.abs(tStatistic) > 2.0) return 0.05;
    if (Math.abs(tStatistic) > 1.5) return 0.1;
    return 0.5;
  }
  
  private normalCDF(z: number): number {
    // Simplified normal CDF
    // In production, use a proper statistics library
    if (z > 3) return 0.999;
    if (z > 2) return 0.977;
    if (z > 1) return 0.841;
    if (z > 0) return 0.5 + z * 0.341;
    return 1 - this.normalCDF(-z);
  }
  
  private interpretEffectSize(d: number): string {
    const absD = Math.abs(d);
    if (absD < 0.2) return 'Negligible';
    if (absD < 0.5) return 'Small';
    if (absD < 0.8) return 'Medium';
    return 'Large';
  }
}
import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const SloComplianceMonitorArgsSchema = {
  service: z.string().optional().describe('Specific service to monitor SLO compliance for'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  sloDefinitions: z.array(z.object({
    name: z.string().describe('SLO name'),
    target: z.number().describe('Target percentage (e.g., 99.9)'),
    indicator: z.enum(['availability', 'latency', 'error_rate', 'throughput']).describe('SLI type'),
    threshold: z.number().optional().describe('Threshold value for the indicator'),
    window: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Rolling window (default: daily)')
  })).optional().describe('Custom SLO definitions (uses defaults if not provided)'),
  includeErrorBudget: z.boolean().optional().describe('Calculate error budget burn rate (default: true)'),
  forecastWindow: z.number().optional().describe('Hours to forecast SLO compliance (default: 24)')
};

type SloComplianceMonitorArgs = MCPToolSchema<typeof SloComplianceMonitorArgsSchema>;

/**
 * Tool for monitoring SLO/SLI compliance and error budget management
 */
export class SloComplianceMonitorTool extends BaseTool<typeof SloComplianceMonitorArgsSchema> {
  // Static schema property
  static readonly schema = SloComplianceMonitorArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'monitorSloCompliance',
      category: ToolCategory.ANALYSIS,
      description: 'Monitor SLO compliance, track error budgets, and predict violations',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return SloComplianceMonitorArgsSchema;
  }
  
  protected async executeImpl(args: SloComplianceMonitorArgs): Promise<any> {
    const config = ConfigLoader.get();
    const includeErrorBudget = args.includeErrorBudget ?? true;
    const forecastWindow = args.forecastWindow || 24;
    const timeRange = { from: args.from, to: args.to };
    
    // Use default SLOs if not provided
    const sloDefinitions = args.sloDefinitions || this.getDefaultSLOs();
    
    // Get SLI metrics
    const sliMetrics = await this.calculateSLIMetrics(
      timeRange,
      args.service,
      sloDefinitions
    );
    
    if (!sliMetrics || sliMetrics.length === 0) {
      return this.formatJsonOutput({
        status: 'no_data',
        message: 'No SLI data available for analysis',
        service: args.service || 'all_services',
        timeRange: timeRange
      });
    }
    
    // Calculate SLO compliance
    const compliance = this.calculateSLOCompliance(
      sliMetrics,
      sloDefinitions,
      timeRange
    );
    
    // Calculate error budgets
    let errorBudgets = null;
    if (includeErrorBudget) {
      errorBudgets = this.calculateErrorBudgets(
        compliance,
        sloDefinitions,
        timeRange
      );
    }
    
    // Analyze compliance trends
    const trends = await this.analyzeComplianceTrends(
      timeRange,
      args.service,
      sloDefinitions
    );
    
    // Identify SLO violations
    const violations = await this.identifyViolations(
      compliance,
      sliMetrics,
      timeRange
    );
    
    // Forecast future compliance
    const forecast = await this.forecastCompliance(
      trends,
      compliance,
      forecastWindow
    );
    
    // Generate risk assessment
    const riskAssessment = this.assessComplianceRisk(
      compliance,
      errorBudgets,
      forecast,
      violations
    );
    
    // Generate remediation actions
    const remediationActions = this.generateRemediationActions(
      violations,
      riskAssessment,
      compliance
    );
    
    return this.formatJsonOutput({
      summary: {
        service: args.service || 'all_services',
        timeRange: timeRange,
        overallCompliance: this.calculateOverallCompliance(compliance),
        sloCount: sloDefinitions.length,
        violationCount: violations.length
      },
      sloCompliance: compliance.map(slo => ({
        name: slo.name,
        indicator: slo.indicator,
        target: slo.target,
        actual: slo.actual,
        compliant: slo.compliant,
        compliancePercentage: slo.compliancePercentage,
        measurements: {
          total: slo.measurements.total,
          successful: slo.measurements.successful,
          failed: slo.measurements.failed
        },
        window: slo.window
      })),
      errorBudget: errorBudgets ? {
        budgets: errorBudgets.budgets,
        burnRate: errorBudgets.burnRate,
        remainingBudget: errorBudgets.remainingBudget,
        projectedExhaustion: errorBudgets.projectedExhaustion
      } : null,
      violations: violations.map(v => ({
        sloName: v.sloName,
        severity: v.severity,
        startTime: v.startTime,
        duration: v.duration,
        impact: v.impact,
        affectedPercentage: v.affectedPercentage
      })),
      trends: {
        direction: trends.direction,
        improvingSlOs: trends.improving,
        degradingSlOs: trends.degrading,
        volatility: trends.volatility
      },
      forecast: {
        window: `${forecastWindow} hours`,
        predictions: forecast.predictions,
        atRiskSlOs: forecast.atRisk,
        confidence: forecast.confidence
      },
      riskAssessment: {
        overallRisk: riskAssessment.overall,
        riskBySlO: riskAssessment.bySlO,
        criticalSlOs: riskAssessment.critical,
        recommendations: riskAssessment.recommendations
      },
      remediationActions: {
        immediate: remediationActions.immediate,
        preventive: remediationActions.preventive,
        strategic: remediationActions.strategic
      },
      insights: this.generateComplianceInsights(
        compliance,
        errorBudgets,
        violations,
        trends
      ),
      alerts: this.generateComplianceAlerts(
        compliance,
        errorBudgets,
        violations,
        forecast
      ),
      complianceSummary: this.generateComplianceSummary(
        compliance,
        violations,
        riskAssessment
      )
    });
  }
  
  private getDefaultSLOs(): any[] {
    return [
      {
        name: 'API Availability',
        target: 99.9,
        indicator: 'availability',
        window: 'daily'
      },
      {
        name: 'Request Latency P95',
        target: 95,
        indicator: 'latency',
        threshold: 500, // 500ms
        window: 'daily'
      },
      {
        name: 'Error Rate',
        target: 99,
        indicator: 'error_rate',
        threshold: 1, // 1% error rate
        window: 'daily'
      },
      {
        name: 'Throughput',
        target: 95,
        indicator: 'throughput',
        threshold: 100, // 100 requests per second
        window: 'daily'
      }
    ];
  }
  
  private async calculateSLIMetrics(
    timeRange: any,
    service: string | undefined,
    sloDefinitions: any[]
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    const metrics: any[] = [];
    
    for (const slo of sloDefinitions) {
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
      
      let result;
      
      switch (slo.indicator) {
        case 'availability':
          result = await this.calculateAvailabilitySLI(query, config, slo);
          break;
        case 'latency':
          result = await this.calculateLatencySLI(query, config, slo);
          break;
        case 'error_rate':
          result = await this.calculateErrorRateSLI(query, config, slo);
          break;
        case 'throughput':
          result = await this.calculateThroughputSLI(query, config, slo);
          break;
        default:
          continue;
      }
      
      metrics.push({
        ...slo,
        ...result
      });
    }
    
    return metrics;
  }
  
  private async calculateAvailabilitySLI(query: any, config: any, slo: any): Promise<any> {
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          time_buckets: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: this.getIntervalForWindow(slo.window || 'daily')
            },
            aggs: {
              total_requests: {
                value_count: { field: config.telemetry.fields.traceId }
              },
              successful_requests: {
                filter: { term: { [config.telemetry.fields.status]: 'OK' } },
                aggs: {
                  count: { value_count: { field: config.telemetry.fields.traceId } }
                }
              }
            }
          },
          overall: {
            filters: {
              filters: {
                total: { match_all: {} },
                successful: { term: { [config.telemetry.fields.status]: 'OK' } }
              }
            },
            aggs: {
              count: { cardinality: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );
    
    const totalRequests = result.aggregations?.overall?.buckets?.total?.count?.value || 0;
    const successfulRequests = result.aggregations?.overall?.buckets?.successful?.count?.value || 0;
    const availability = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;
    
    const timeSeries = (result.aggregations?.time_buckets?.buckets || []).map((bucket: any) => ({
      time: bucket.key_as_string,
      total: bucket.total_requests?.value || 0,
      successful: bucket.successful_requests?.count?.value || 0,
      availability: bucket.total_requests?.value > 0 ? 
        (bucket.successful_requests?.count?.value / bucket.total_requests?.value) * 100 : 0
    }));
    
    return {
      value: availability,
      timeSeries,
      measurements: {
        total: totalRequests,
        successful: successfulRequests,
        failed: totalRequests - successfulRequests
      }
    };
  }
  
  private async calculateLatencySLI(query: any, config: any, slo: any): Promise<any> {
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          time_buckets: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: this.getIntervalForWindow(slo.window || 'daily')
            },
            aggs: {
              total_requests: {
                value_count: { field: config.telemetry.fields.traceId }
              },
              within_threshold: {
                filter: { range: { duration: { lte: slo.threshold || 500 } } },
                aggs: {
                  count: { value_count: { field: config.telemetry.fields.traceId } }
                }
              },
              latency_percentiles: {
                percentiles: { field: 'duration', percents: [50, 90, 95, 99] }
              }
            }
          },
          overall: {
            filters: {
              filters: {
                total: { match_all: {} },
                within_threshold: { range: { duration: { lte: slo.threshold || 500 } } }
              }
            },
            aggs: {
              count: { cardinality: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );
    
    const totalRequests = result.aggregations?.overall?.buckets?.total?.count?.value || 0;
    const withinThreshold = result.aggregations?.overall?.buckets?.within_threshold?.count?.value || 0;
    const successRate = totalRequests > 0 ? (withinThreshold / totalRequests) * 100 : 0;
    
    const timeSeries = (result.aggregations?.time_buckets?.buckets || []).map((bucket: any) => ({
      time: bucket.key_as_string,
      total: bucket.total_requests?.value || 0,
      withinThreshold: bucket.within_threshold?.count?.value || 0,
      successRate: bucket.total_requests?.value > 0 ? 
        (bucket.within_threshold?.count?.value / bucket.total_requests?.value) * 100 : 0,
      percentiles: bucket.latency_percentiles?.values || {}
    }));
    
    return {
      value: successRate,
      timeSeries,
      measurements: {
        total: totalRequests,
        successful: withinThreshold,
        failed: totalRequests - withinThreshold
      }
    };
  }
  
  private async calculateErrorRateSLI(query: any, config: any, slo: any): Promise<any> {
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          time_buckets: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: this.getIntervalForWindow(slo.window || 'daily')
            },
            aggs: {
              total_requests: {
                value_count: { field: config.telemetry.fields.traceId }
              },
              error_requests: {
                filter: { term: { [config.telemetry.fields.status]: 'ERROR' } },
                aggs: {
                  count: { value_count: { field: config.telemetry.fields.traceId } }
                }
              }
            }
          },
          overall: {
            filters: {
              filters: {
                total: { match_all: {} },
                errors: { term: { [config.telemetry.fields.status]: 'ERROR' } }
              }
            },
            aggs: {
              count: { cardinality: { field: config.telemetry.fields.traceId } }
            }
          }
        }
      }
    );
    
    const totalRequests = result.aggregations?.overall?.buckets?.total?.count?.value || 0;
    const errorRequests = result.aggregations?.overall?.buckets?.errors?.count?.value || 0;
    const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
    const successRate = 100 - errorRate;
    
    const timeSeries = (result.aggregations?.time_buckets?.buckets || []).map((bucket: any) => ({
      time: bucket.key_as_string,
      total: bucket.total_requests?.value || 0,
      errors: bucket.error_requests?.count?.value || 0,
      errorRate: bucket.total_requests?.value > 0 ? 
        (bucket.error_requests?.count?.value / bucket.total_requests?.value) * 100 : 0
    }));
    
    return {
      value: successRate, // SLI is success rate, not error rate
      timeSeries,
      measurements: {
        total: totalRequests,
        successful: totalRequests - errorRequests,
        failed: errorRequests
      }
    };
  }
  
  private async calculateThroughputSLI(query: any, config: any, slo: any): Promise<any> {
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          time_buckets: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1m' // 1-minute buckets for throughput
            },
            aggs: {
              request_rate: {
                value_count: { field: config.telemetry.fields.traceId }
              }
            }
          }
        }
      }
    );
    
    const buckets = result.aggregations?.time_buckets?.buckets || [];
    const throughputValues = buckets.map((b: any) => b.request_rate?.value || 0);
    
    // Calculate percentage of time meeting throughput threshold
    const threshold = slo.threshold || 100;
    const meetingThreshold = throughputValues.filter((v: number) => v >= threshold).length;
    const successRate = buckets.length > 0 ? (meetingThreshold / buckets.length) * 100 : 0;
    
    const timeSeries = buckets.map((bucket: any) => ({
      time: bucket.key_as_string,
      throughput: bucket.request_rate?.value || 0,
      meetsThreshold: (bucket.request_rate?.value || 0) >= threshold
    }));
    
    return {
      value: successRate,
      timeSeries,
      measurements: {
        total: buckets.length,
        successful: meetingThreshold,
        failed: buckets.length - meetingThreshold
      }
    };
  }
  
  private getIntervalForWindow(window: string): string {
    switch (window) {
      case 'monthly': return '1d';
      case 'weekly': return '6h';
      case 'daily': 
      default: return '1h';
    }
  }
  
  private calculateSLOCompliance(
    sliMetrics: any[],
    sloDefinitions: any[],
    timeRange: any
  ): any[] {
    return sliMetrics.map((metric, index) => {
      const slo = sloDefinitions[index];
      const compliant = metric.value >= slo.target;
      
      return {
        name: slo.name,
        indicator: slo.indicator,
        target: slo.target,
        actual: metric.value,
        compliant,
        compliancePercentage: Math.min(100, (metric.value / slo.target) * 100),
        measurements: metric.measurements,
        timeSeries: metric.timeSeries,
        window: slo.window || 'daily'
      };
    });
  }
  
  private calculateErrorBudgets(
    compliance: any[],
    sloDefinitions: any[],
    timeRange: any
  ): any {
    const budgets = compliance.map((comp, index) => {
      const slo = sloDefinitions[index];
      const allowedFailureRate = 100 - slo.target;
      const actualFailureRate = 100 - comp.actual;
      
      const totalBudget = comp.measurements.total * (allowedFailureRate / 100);
      const consumedBudget = comp.measurements.failed;
      const remainingBudget = Math.max(0, totalBudget - consumedBudget);
      const consumptionRate = totalBudget > 0 ? (consumedBudget / totalBudget) * 100 : 0;
      
      return {
        sloName: comp.name,
        totalBudget,
        consumedBudget,
        remainingBudget,
        consumptionRate,
        status: consumptionRate > 100 ? 'exhausted' : 
                consumptionRate > 80 ? 'critical' :
                consumptionRate > 60 ? 'warning' : 'healthy'
      };
    });
    
    // Calculate burn rate
    const timeRangeHours = this.calculateTimeRangeHours(timeRange);
    const avgConsumptionRate = budgets.reduce((sum, b) => sum + b.consumptionRate, 0) / budgets.length;
    const burnRate = avgConsumptionRate / timeRangeHours;
    
    // Project exhaustion
    const criticalBudgets = budgets.filter(b => b.status === 'critical' || b.status === 'exhausted');
    const projectedExhaustion = criticalBudgets.map(b => ({
      sloName: b.sloName,
      hoursUntilExhaustion: b.remainingBudget > 0 ? 
        b.remainingBudget / (b.consumedBudget / timeRangeHours) : 0
    }));
    
    return {
      budgets,
      burnRate,
      remainingBudget: {
        overall: budgets.reduce((sum, b) => sum + b.remainingBudget, 0),
        percentage: 100 - avgConsumptionRate
      },
      projectedExhaustion
    };
  }
  
  private calculateTimeRangeHours(timeRange: any): number {
    const from = new Date(timeRange.from).getTime();
    const to = new Date(timeRange.to).getTime();
    return (to - from) / (1000 * 60 * 60);
  }
  
  private async analyzeComplianceTrends(
    timeRange: any,
    service: string | undefined,
    sloDefinitions: any[]
  ): Promise<any> {
    // Simplified trend analysis
    const trends = {
      direction: 'stable' as string,
      improving: [] as string[],
      degrading: [] as string[],
      volatility: {} as any
    };
    
    // In a real implementation, this would analyze historical compliance data
    // For now, return mock trends
    return trends;
  }
  
  private async identifyViolations(
    compliance: any[],
    sliMetrics: any[],
    timeRange: any
  ): Promise<any[]> {
    const violations: any[] = [];
    
    compliance.forEach((comp, index) => {
      if (!comp.compliant) {
        const metric = sliMetrics[index];
        
        // Analyze time series to find violation periods
        const violationPeriods = this.findViolationPeriods(
          metric.timeSeries,
          comp.target,
          comp.indicator
        );
        
        violationPeriods.forEach(period => {
          violations.push({
            sloName: comp.name,
            severity: this.calculateViolationSeverity(comp, period),
            startTime: period.start,
            endTime: period.end,
            duration: period.duration,
            impact: {
              affectedRequests: period.affectedRequests,
              percentageOfTotal: period.percentageOfTotal
            },
            affectedPercentage: period.percentageOfTotal
          });
        });
      }
    });
    
    return violations;
  }
  
  private findViolationPeriods(timeSeries: any[], target: number, indicator: string): any[] {
    const periods: any[] = [];
    let currentPeriod: any = null;
    
    timeSeries.forEach((point, index) => {
      let value;
      switch (indicator) {
        case 'availability':
          value = point.availability;
          break;
        case 'latency':
          value = point.successRate;
          break;
        case 'error_rate':
          value = 100 - point.errorRate;
          break;
        case 'throughput':
          value = point.meetsThreshold ? 100 : 0;
          break;
        default:
          value = 0;
      }
      
      const isViolation = value < target;
      
      if (isViolation && !currentPeriod) {
        currentPeriod = {
          start: point.time,
          points: [point],
          affectedRequests: point.total - (point.successful || 0)
        };
      } else if (isViolation && currentPeriod) {
        currentPeriod.points.push(point);
        currentPeriod.affectedRequests += point.total - (point.successful || 0);
      } else if (!isViolation && currentPeriod) {
        currentPeriod.end = point.time;
        currentPeriod.duration = currentPeriod.points.length;
        currentPeriod.percentageOfTotal = 
          currentPeriod.affectedRequests / 
          currentPeriod.points.reduce((sum: number, p: any) => sum + p.total, 0) * 100;
        periods.push(currentPeriod);
        currentPeriod = null;
      }
    });
    
    // Handle ongoing violation
    if (currentPeriod) {
      currentPeriod.end = timeSeries[timeSeries.length - 1].time;
      currentPeriod.duration = currentPeriod.points.length;
      currentPeriod.percentageOfTotal = 
        currentPeriod.affectedRequests / 
        currentPeriod.points.reduce((sum: number, p: any) => sum + p.total, 0) * 100;
      periods.push(currentPeriod);
    }
    
    return periods;
  }
  
  private calculateViolationSeverity(compliance: any, period: any): string {
    const targetMissPercentage = ((compliance.target - compliance.actual) / compliance.target) * 100;
    
    if (targetMissPercentage > 10 || period.duration > 6) return 'critical';
    if (targetMissPercentage > 5 || period.duration > 3) return 'high';
    if (targetMissPercentage > 2 || period.duration > 1) return 'medium';
    return 'low';
  }
  
  private async forecastCompliance(
    trends: any,
    compliance: any[],
    forecastWindow: number
  ): Promise<any> {
    const predictions = compliance.map(comp => {
      // Simple linear projection based on current performance
      const currentRate = comp.actual;
      const targetRate = comp.target;
      
      // Assume slight degradation over time (simplified)
      const degradationRate = 0.1; // 0.1% per hour
      const projectedRate = currentRate - (degradationRate * forecastWindow);
      
      return {
        sloName: comp.name,
        currentCompliance: currentRate,
        projectedCompliance: Math.max(0, projectedRate),
        willViolate: projectedRate < targetRate,
        hoursUntilViolation: currentRate > targetRate ? 
          (currentRate - targetRate) / degradationRate : 0
      };
    });
    
    const atRisk = predictions.filter(p => p.willViolate || p.hoursUntilViolation < forecastWindow);
    
    return {
      predictions,
      atRisk,
      confidence: 'medium' // Simplified confidence level
    };
  }
  
  private assessComplianceRisk(
    compliance: any[],
    errorBudgets: any,
    forecast: any,
    violations: any[]
  ): any {
    const riskScores = compliance.map(comp => {
      let score = 0;
      
      // Non-compliance risk
      if (!comp.compliant) score += 30;
      
      // Near miss risk
      if (comp.compliancePercentage < 105) score += 20;
      
      // Error budget risk
      const budget = errorBudgets?.budgets.find((b: any) => b.sloName === comp.name);
      if (budget) {
        if (budget.status === 'exhausted') score += 40;
        else if (budget.status === 'critical') score += 30;
        else if (budget.status === 'warning') score += 20;
      }
      
      // Forecast risk
      const prediction = forecast.predictions.find((p: any) => p.sloName === comp.name);
      if (prediction?.willViolate) score += 25;
      
      // Violation history risk
      const sloViolations = violations.filter(v => v.sloName === comp.name);
      score += Math.min(30, sloViolations.length * 10);
      
      return {
        sloName: comp.name,
        riskScore: score,
        riskLevel: score > 70 ? 'critical' : score > 50 ? 'high' : score > 30 ? 'medium' : 'low',
        factors: this.identifyRiskFactors(comp, budget, prediction, sloViolations)
      };
    });
    
    const overallRisk = riskScores.reduce((sum, r) => sum + r.riskScore, 0) / riskScores.length;
    const criticalSlOs = riskScores.filter(r => r.riskLevel === 'critical');
    
    return {
      overall: overallRisk > 70 ? 'critical' : overallRisk > 50 ? 'high' : overallRisk > 30 ? 'medium' : 'low',
      overallScore: overallRisk,
      bySlO: riskScores,
      critical: criticalSlOs,
      recommendations: this.generateRiskRecommendations(riskScores, compliance)
    };
  }
  
  private identifyRiskFactors(comp: any, budget: any, prediction: any, violations: any[]): string[] {
    const factors: string[] = [];
    
    if (!comp.compliant) factors.push('Currently violating SLO');
    if (comp.compliancePercentage < 105) factors.push('Near SLO threshold');
    if (budget?.status === 'exhausted') factors.push('Error budget exhausted');
    if (budget?.status === 'critical') factors.push('Error budget critical');
    if (prediction?.willViolate) factors.push('Predicted to violate soon');
    if (violations.length > 0) factors.push(`${violations.length} recent violations`);
    
    return factors;
  }
  
  private generateRiskRecommendations(riskScores: any[], compliance: any[]): string[] {
    const recommendations: string[] = [];
    
    const criticalCount = riskScores.filter(r => r.riskLevel === 'critical').length;
    if (criticalCount > 0) {
      recommendations.push(`${criticalCount} SLOs at critical risk - immediate action required`);
    }
    
    const exhaustedBudgets = riskScores.filter(r => 
      r.factors.includes('Error budget exhausted')
    ).length;
    if (exhaustedBudgets > 0) {
      recommendations.push('Implement stricter change control for exhausted error budgets');
    }
    
    const nearMisses = compliance.filter(c => c.compliancePercentage < 105).length;
    if (nearMisses > 0) {
      recommendations.push(`${nearMisses} SLOs near threshold - increase monitoring frequency`);
    }
    
    return recommendations;
  }
  
  private generateRemediationActions(
    violations: any[],
    riskAssessment: any,
    compliance: any[]
  ): any {
    const immediate: any[] = [];
    const preventive: any[] = [];
    const strategic: any[] = [];
    
    // Immediate actions for critical SLOs
    riskAssessment.critical.forEach((slo: any) => {
      const comp = compliance.find(c => c.name === slo.sloName);
      if (comp) {
        immediate.push({
          sloName: slo.sloName,
          action: this.getImmediateAction(comp),
          priority: 'critical',
          expectedImpact: 'Stabilize SLO compliance',
          timeline: '0-4 hours'
        });
      }
    });
    
    // Preventive actions
    compliance.filter(c => c.compliancePercentage < 110).forEach(comp => {
      preventive.push({
        sloName: comp.name,
        action: this.getPreventiveAction(comp),
        priority: 'high',
        expectedImpact: 'Prevent future violations',
        timeline: '1-7 days'
      });
    });
    
    // Strategic improvements
    if (riskAssessment.overallScore > 50) {
      strategic.push({
        action: 'Review and adjust SLO targets',
        priority: 'medium',
        expectedImpact: 'Align SLOs with business needs',
        timeline: '1-3 months'
      });
      
      strategic.push({
        action: 'Implement proactive monitoring and alerting',
        priority: 'medium',
        expectedImpact: 'Early detection of SLO degradation',
        timeline: '2-4 weeks'
      });
    }
    
    return { immediate, preventive, strategic };
  }
  
  private getImmediateAction(compliance: any): string {
    switch (compliance.indicator) {
      case 'availability':
        return 'Scale up service instances and enable circuit breakers';
      case 'latency':
        return 'Enable caching and optimize database queries';
      case 'error_rate':
        return 'Deploy hotfix for identified errors and add retry logic';
      case 'throughput':
        return 'Increase resource allocation and optimize request routing';
      default:
        return 'Review service configuration and increase monitoring';
    }
  }
  
  private getPreventiveAction(compliance: any): string {
    switch (compliance.indicator) {
      case 'availability':
        return 'Implement redundancy and improve health checks';
      case 'latency':
        return 'Profile application performance and add performance tests';
      case 'error_rate':
        return 'Enhance error handling and add integration tests';
      case 'throughput':
        return 'Implement auto-scaling and load testing';
      default:
        return 'Establish baseline monitoring and alerting';
    }
  }
  
  private generateComplianceInsights(
    compliance: any[],
    errorBudgets: any,
    violations: any[],
    trends: any
  ): any[] {
    const insights: any[] = [];
    
    // Overall compliance insight
    const overallCompliance = this.calculateOverallCompliance(compliance);
    if (overallCompliance < 95) {
      insights.push({
        type: 'low_overall_compliance',
        severity: 'high',
        description: `Overall SLO compliance at ${overallCompliance.toFixed(1)}%`,
        recommendation: 'Focus on improving lowest performing SLOs'
      });
    }
    
    // Error budget insight
    if (errorBudgets) {
      const exhaustedCount = errorBudgets.budgets.filter((b: any) => b.status === 'exhausted').length;
      if (exhaustedCount > 0) {
        insights.push({
          type: 'error_budget_exhaustion',
          severity: 'critical',
          description: `${exhaustedCount} SLOs have exhausted error budgets`,
          recommendation: 'Freeze non-critical changes until budgets recover'
        });
      }
    }
    
    // Violation pattern insight
    const frequentViolations = violations.filter(v => v.duration > 3);
    if (frequentViolations.length > 0) {
      insights.push({
        type: 'persistent_violations',
        severity: 'high',
        description: `${frequentViolations.length} prolonged SLO violations detected`,
        recommendation: 'Investigate root causes of persistent violations'
      });
    }
    
    // Compliance distribution insight
    const compliantCount = compliance.filter(c => c.compliant).length;
    const complianceRate = (compliantCount / compliance.length) * 100;
    if (complianceRate < 75) {
      insights.push({
        type: 'widespread_non_compliance',
        severity: 'critical',
        description: `Only ${complianceRate.toFixed(0)}% of SLOs meeting targets`,
        recommendation: 'Initiate comprehensive reliability improvement program'
      });
    }
    
    return insights;
  }
  
  private generateComplianceAlerts(
    compliance: any[],
    errorBudgets: any,
    violations: any[],
    forecast: any
  ): any[] {
    const alerts: any[] = [];
    
    // Critical compliance alerts
    compliance.filter(c => !c.compliant && c.compliancePercentage < 90).forEach(comp => {
      alerts.push({
        severity: 'critical',
        type: 'slo_violation',
        sloName: comp.name,
        message: `${comp.name} at ${comp.actual.toFixed(2)}% (target: ${comp.target}%)`,
        action: 'Immediate investigation and remediation required'
      });
    });
    
    // Error budget alerts
    if (errorBudgets) {
      errorBudgets.budgets.filter((b: any) => b.status === 'exhausted').forEach((budget: any) => {
        alerts.push({
          severity: 'high',
          type: 'error_budget_exhausted',
          sloName: budget.sloName,
          message: `Error budget exhausted - ${budget.consumptionRate.toFixed(1)}% consumed`,
          action: 'Freeze non-critical deployments'
        });
      });
    }
    
    // Forecast alerts
    forecast.atRisk.forEach((risk: any) => {
      if (risk.hoursUntilViolation < 6) {
        alerts.push({
          severity: 'high',
          type: 'impending_violation',
          sloName: risk.sloName,
          message: `Predicted to violate SLO in ${risk.hoursUntilViolation.toFixed(1)} hours`,
          action: 'Proactive intervention recommended'
        });
      }
    });
    
    return alerts;
  }
  
  private calculateOverallCompliance(compliance: any[]): number {
    const totalWeight = compliance.reduce((sum, c) => sum + c.measurements.total, 0);
    const weightedCompliance = compliance.reduce((sum, c) => 
      sum + (c.actual * c.measurements.total), 0
    );
    
    return totalWeight > 0 ? weightedCompliance / totalWeight : 0;
  }
  
  private generateComplianceSummary(
    compliance: any[],
    violations: any[],
    riskAssessment: any
  ): string {
    const parts: string[] = [];
    
    const overallCompliance = this.calculateOverallCompliance(compliance);
    parts.push(`Overall SLO compliance: ${overallCompliance.toFixed(1)}%.`);
    
    const compliantCount = compliance.filter(c => c.compliant).length;
    parts.push(`${compliantCount}/${compliance.length} SLOs meeting targets.`);
    
    if (violations.length > 0) {
      parts.push(`${violations.length} active violations.`);
    }
    
    parts.push(`Risk level: ${riskAssessment.overall}.`);
    
    return parts.join(' ');
  }
}
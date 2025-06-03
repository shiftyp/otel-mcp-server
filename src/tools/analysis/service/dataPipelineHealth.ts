import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const DataPipelineHealthArgsSchema = {
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  pipeline: z.string().optional().describe('Specific pipeline name to analyze'),
  stages: z.array(z.string()).optional().describe('Pipeline stages to analyze'),
  slaThresholds: z.object({
    processingTime: z.number().optional().describe('Max processing time in ms (default: 5000)'),
    errorRate: z.number().optional().describe('Max error rate percentage (default: 1)'),
    throughput: z.number().optional().describe('Min throughput per minute (default: 100)')
  }).optional().describe('SLA thresholds for pipeline health'),
  includeDataQuality: z.boolean().optional().describe('Include data quality metrics (default: true)')
};

type DataPipelineHealthArgs = MCPToolSchema<typeof DataPipelineHealthArgsSchema>;

/**
 * Tool for monitoring and analyzing data pipeline health, including throughput, latency, and data quality
 */
export class DataPipelineHealthTool extends BaseTool<typeof DataPipelineHealthArgsSchema> {
  // Static schema property
  static readonly schema = DataPipelineHealthArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'monitorDataPipelineHealth',
      category: ToolCategory.ANALYSIS,
      description: 'Monitor data pipeline throughput, latency, error rates, and data quality',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return DataPipelineHealthArgsSchema;
  }
  
  protected async executeImpl(args: DataPipelineHealthArgs): Promise<any> {
    const config = ConfigLoader.get();
    const timeRange = { from: args.from, to: args.to };
    const slaThresholds = {
      processingTime: args.slaThresholds?.processingTime || 5000,
      errorRate: args.slaThresholds?.errorRate || 1,
      throughput: args.slaThresholds?.throughput || 100
    };
    const includeDataQuality = args.includeDataQuality ?? true;
    
    // Get pipeline metrics
    const pipelineMetrics = await this.getPipelineMetrics(
      timeRange,
      args.pipeline,
      args.stages
    );
    
    if (!pipelineMetrics || pipelineMetrics.totalRecords === 0) {
      return this.formatJsonOutput({
        status: 'no_data',
        message: 'No pipeline data found for the specified criteria',
        timeRange: timeRange,
        pipeline: args.pipeline
      });
    }
    
    // Analyze pipeline performance
    const performanceAnalysis = await this.analyzePipelinePerformance(
      pipelineMetrics,
      slaThresholds
    );
    
    // Analyze stage health
    const stageHealth = await this.analyzeStageHealth(
      timeRange,
      args.pipeline,
      args.stages
    );
    
    // Analyze data flow patterns
    const dataFlowAnalysis = await this.analyzeDataFlow(
      pipelineMetrics,
      timeRange
    );
    
    // Detect bottlenecks
    const bottlenecks = await this.detectPipelineBottlenecks(
      stageHealth,
      performanceAnalysis
    );
    
    // Data quality analysis
    let dataQualityMetrics = null;
    if (includeDataQuality) {
      dataQualityMetrics = await this.analyzeDataQuality(
        timeRange,
        args.pipeline
      );
    }
    
    // Calculate overall health score
    const healthScore = this.calculatePipelineHealthScore(
      performanceAnalysis,
      stageHealth,
      dataQualityMetrics,
      slaThresholds
    );
    
    // Generate recommendations
    const recommendations = this.generatePipelineRecommendations(
      healthScore,
      performanceAnalysis,
      bottlenecks,
      dataQualityMetrics
    );
    
    return this.formatJsonOutput({
      pipeline: {
        name: args.pipeline || 'all_pipelines',
        timeRange: timeRange,
        totalRecords: pipelineMetrics.totalRecords,
        stages: args.stages || stageHealth.stages.map((s: any) => s.name)
      },
      healthScore: {
        overall: healthScore.overall,
        grade: healthScore.grade,
        breakdown: healthScore.breakdown,
        trend: healthScore.trend
      },
      performance: {
        throughput: performanceAnalysis.throughput,
        latency: performanceAnalysis.latency,
        errorRate: performanceAnalysis.errorRate,
        slaCompliance: performanceAnalysis.slaCompliance
      },
      stageHealth: {
        stages: stageHealth.stages,
        worstPerforming: stageHealth.worstPerforming,
        bestPerforming: stageHealth.bestPerforming
      },
      dataFlow: {
        inputRate: dataFlowAnalysis.inputRate,
        outputRate: dataFlowAnalysis.outputRate,
        backpressure: dataFlowAnalysis.backpressure,
        patterns: dataFlowAnalysis.patterns
      },
      bottlenecks: {
        detected: bottlenecks.length > 0,
        locations: bottlenecks,
        impact: this.assessBottleneckImpact(bottlenecks)
      },
      dataQuality: dataQualityMetrics,
      alerts: this.generatePipelineAlerts(
        performanceAnalysis,
        healthScore,
        bottlenecks
      ),
      recommendations,
      insights: this.generatePipelineInsights(
        performanceAnalysis,
        stageHealth,
        dataFlowAnalysis,
        dataQualityMetrics
      ),
      summary: this.generatePipelineSummary(
        healthScore,
        performanceAnalysis,
        bottlenecks
      )
    });
  }
  
  private async getPipelineMetrics(
    timeRange: any,
    pipeline?: string,
    stages?: string[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        should: [
          { exists: { field: 'pipeline.name' } },
          { exists: { field: 'data.pipeline' } },
          { exists: { field: 'event.dataset' } }
        ],
        minimum_should_match: 1
      }
    };
    
    if (pipeline) {
      query.bool.must.push({
        bool: {
          should: [
            { term: { 'pipeline.name.keyword': pipeline } },
            { term: { 'data.pipeline.keyword': pipeline } },
            { term: { 'event.dataset.keyword': pipeline } }
          ]
        }
      });
    }
    
    if (stages && stages.length > 0) {
      query.bool.must.push({
        terms: { 'pipeline.stage.keyword': stages }
      });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.logs,
      query,
      {
        size: 0,
        aggregations: {
          total_records: {
            cardinality: { field: 'event.id' }
          },
          pipelines: {
            terms: {
              field: 'pipeline.name.keyword',
              size: 50
            },
            aggs: {
              stages: {
                terms: {
                  field: 'pipeline.stage.keyword',
                  size: 20
                },
                aggs: {
                  processing_time: {
                    stats: { field: 'pipeline.duration' }
                  },
                  error_count: {
                    filter: {
                      bool: {
                        should: [
                          { term: { 'event.outcome': 'failure' } },
                          { exists: { field: 'error.message' } }
                        ]
                      }
                    }
                  },
                  throughput_timeline: {
                    date_histogram: {
                      field: config.telemetry.fields.timestamp,
                      fixed_interval: '1m'
                    },
                    aggs: {
                      records_per_minute: {
                        value_count: { field: 'event.id' }
                      }
                    }
                  }
                }
              }
            }
          },
          processing_time_percentiles: {
            percentiles: {
              field: 'pipeline.duration',
              percents: [50, 75, 90, 95, 99]
            }
          },
          error_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              error_rate: {
                filters: {
                  filters: {
                    errors: {
                      bool: {
                        should: [
                          { term: { 'event.outcome': 'failure' } },
                          { exists: { field: 'error.message' } }
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
    
    return {
      totalRecords: result.aggregations?.total_records?.value || 0,
      pipelines: result.aggregations?.pipelines?.buckets || [],
      processingTimePercentiles: result.aggregations?.processing_time_percentiles?.values || {},
      errorTimeline: result.aggregations?.error_timeline?.buckets || []
    };
  }
  
  private async analyzePipelinePerformance(
    pipelineMetrics: any,
    slaThresholds: any
  ): Promise<any> {
    const pipelines = pipelineMetrics.pipelines;
    
    let totalProcessingTime = 0;
    let totalErrors = 0;
    let totalRecords = 0;
    let throughputSamples: number[] = [];
    
    pipelines.forEach((pipeline: any) => {
      pipeline.stages?.buckets?.forEach((stage: any) => {
        const stats = stage.processing_time;
        if (stats && stats.count > 0) {
          totalProcessingTime += stats.sum;
          totalRecords += stats.count;
        }
        totalErrors += stage.error_count?.doc_count || 0;
        
        // Collect throughput samples
        stage.throughput_timeline?.buckets?.forEach((bucket: any) => {
          throughputSamples.push(bucket.records_per_minute?.value || 0);
        });
      });
    });
    
    const avgProcessingTime = totalRecords > 0 ? totalProcessingTime / totalRecords : 0;
    const errorRate = totalRecords > 0 ? (totalErrors / totalRecords) * 100 : 0;
    const avgThroughput = this.calculateAverage(throughputSamples);
    
    // SLA compliance
    const slaCompliance = {
      processingTime: avgProcessingTime <= slaThresholds.processingTime,
      errorRate: errorRate <= slaThresholds.errorRate,
      throughput: avgThroughput >= slaThresholds.throughput,
      overall: true
    };
    
    slaCompliance.overall = slaCompliance.processingTime && 
                           slaCompliance.errorRate && 
                           slaCompliance.throughput;
    
    return {
      throughput: {
        current: avgThroughput,
        peak: Math.max(...throughputSamples),
        minimum: Math.min(...throughputSamples),
        trend: this.calculateTrend(throughputSamples)
      },
      latency: {
        avg: avgProcessingTime,
        p50: pipelineMetrics.processingTimePercentiles['50.0'],
        p95: pipelineMetrics.processingTimePercentiles['95.0'],
        p99: pipelineMetrics.processingTimePercentiles['99.0']
      },
      errorRate: {
        percentage: errorRate,
        count: totalErrors,
        trend: this.calculateErrorTrend(pipelineMetrics.errorTimeline)
      },
      slaCompliance
    };
  }
  
  private async analyzeStageHealth(
    timeRange: any,
    pipeline?: string,
    stages?: string[]
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { exists: { field: 'pipeline.stage' } }
        ]
      }
    };
    
    if (pipeline) {
      query.bool.must.push({ term: { 'pipeline.name.keyword': pipeline } });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.logs,
      query,
      {
        size: 0,
        aggregations: {
          stages: {
            terms: {
              field: 'pipeline.stage.keyword',
              size: 50
            },
            aggs: {
              performance: {
                stats: { field: 'pipeline.duration' }
              },
              success_rate: {
                filters: {
                  filters: {
                    success: { term: { 'event.outcome': 'success' } },
                    failure: { term: { 'event.outcome': 'failure' } }
                  }
                }
              },
              input_output_ratio: {
                stats: { field: 'pipeline.records_out' }
              },
              resource_usage: {
                stats: { field: 'pipeline.memory_mb' }
              }
            }
          }
        }
      }
    );
    
    const stageBuckets = result.aggregations?.stages?.buckets || [];
    const stageHealthMetrics = stageBuckets.map((stage: any) => {
      const successCount = stage.success_rate?.buckets?.success?.doc_count || 0;
      const failureCount = stage.success_rate?.buckets?.failure?.doc_count || 0;
      const totalCount = successCount + failureCount;
      
      return {
        name: stage.key,
        recordsProcessed: stage.doc_count,
        performance: {
          avgDuration: stage.performance?.avg || 0,
          maxDuration: stage.performance?.max || 0,
          throughput: totalCount > 0 ? totalCount / (stage.performance?.sum || 1) * 1000 : 0
        },
        successRate: totalCount > 0 ? (successCount / totalCount) * 100 : 0,
        resourceUsage: {
          avgMemory: stage.resource_usage?.avg || 0,
          maxMemory: stage.resource_usage?.max || 0
        },
        health: 'healthy' // Will be calculated below
      };
    });
    
    // Calculate health status for each stage
    stageHealthMetrics.forEach((stage: any) => {
      if (stage.successRate < 95) stage.health = 'unhealthy';
      else if (stage.successRate < 99) stage.health = 'degraded';
      else stage.health = 'healthy';
    });
    
    // Sort by performance
    const sortedByPerformance = [...stageHealthMetrics].sort(
      (a, b) => b.performance.avgDuration - a.performance.avgDuration
    );
    
    return {
      stages: stageHealthMetrics,
      worstPerforming: sortedByPerformance.slice(0, 3),
      bestPerforming: sortedByPerformance.slice(-3).reverse()
    };
  }
  
  private async analyzeDataFlow(
    pipelineMetrics: any,
    timeRange: any
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Analyze input/output rates
    const flowQuery = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { exists: { field: 'pipeline.records_in' } }
        ]
      }
    };
    
    const flowResult = await this.adapter.query(
      config.telemetry.indices.logs,
      flowQuery,
      {
        size: 0,
        aggregations: {
          input_output_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              input_rate: {
                sum: { field: 'pipeline.records_in' }
              },
              output_rate: {
                sum: { field: 'pipeline.records_out' }
              },
              queue_depth: {
                avg: { field: 'pipeline.queue_depth' }
              }
            }
          },
          backpressure_events: {
            filter: {
              bool: {
                should: [
                  { range: { 'pipeline.queue_depth': { gte: 1000 } } },
                  { term: { 'pipeline.backpressure': true } }
                ]
              }
            }
          }
        }
      }
    );
    
    const timeline = flowResult.aggregations?.input_output_timeline?.buckets || [];
    const backpressureCount = flowResult.aggregations?.backpressure_events?.doc_count || 0;
    
    // Calculate flow metrics
    const inputRates = timeline.map((b: any) => b.input_rate?.value || 0);
    const outputRates = timeline.map((b: any) => b.output_rate?.value || 0);
    const queueDepths = timeline.map((b: any) => b.queue_depth?.value || 0);
    
    // Detect patterns
    const patterns = this.detectDataFlowPatterns(timeline);
    
    return {
      inputRate: {
        current: inputRates.length > 0 ? inputRates[inputRates.length - 1] : 0,
        avg: this.calculateAverage(inputRates),
        peak: Math.max(...inputRates)
      },
      outputRate: {
        current: outputRates.length > 0 ? outputRates[outputRates.length - 1] : 0,
        avg: this.calculateAverage(outputRates),
        peak: Math.max(...outputRates)
      },
      backpressure: {
        detected: backpressureCount > 0,
        events: backpressureCount,
        avgQueueDepth: this.calculateAverage(queueDepths),
        maxQueueDepth: Math.max(...queueDepths)
      },
      patterns
    };
  }
  
  private detectDataFlowPatterns(timeline: any[]): any[] {
    const patterns: any[] = [];
    
    if (timeline.length < 3) return patterns;
    
    // Detect sustained backlog
    let backlogCount = 0;
    timeline.forEach((bucket: any) => {
      const inputRate = bucket.input_rate?.value || 0;
      const outputRate = bucket.output_rate?.value || 0;
      if (inputRate > outputRate * 1.2) {
        backlogCount++;
      }
    });
    
    if (backlogCount > timeline.length * 0.5) {
      patterns.push({
        type: 'sustained_backlog',
        severity: 'high',
        description: 'Input rate consistently exceeds output rate',
        recommendation: 'Scale pipeline processing capacity'
      });
    }
    
    // Detect burst patterns
    const inputRates = timeline.map((b: any) => b.input_rate?.value || 0);
    const avgRate = this.calculateAverage(inputRates);
    const burstThreshold = avgRate * 3;
    
    const bursts = inputRates.filter(rate => rate > burstThreshold).length;
    if (bursts > 0) {
      patterns.push({
        type: 'burst_traffic',
        severity: 'medium',
        description: `${bursts} traffic bursts detected`,
        recommendation: 'Implement burst handling and buffering'
      });
    }
    
    return patterns;
  }
  
  private async detectPipelineBottlenecks(
    stageHealth: any,
    performanceAnalysis: any
  ): Promise<any[]> {
    const bottlenecks: any[] = [];
    
    // Stage-level bottlenecks
    stageHealth.stages.forEach((stage: any) => {
      if (stage.performance.avgDuration > 1000) {
        bottlenecks.push({
          type: 'slow_stage',
          location: stage.name,
          severity: stage.performance.avgDuration > 5000 ? 'high' : 'medium',
          impact: `Average processing time: ${stage.performance.avgDuration.toFixed(0)}ms`,
          recommendation: `Optimize ${stage.name} stage processing logic`
        });
      }
      
      if (stage.successRate < 95) {
        bottlenecks.push({
          type: 'high_failure_rate',
          location: stage.name,
          severity: stage.successRate < 90 ? 'high' : 'medium',
          impact: `Success rate: ${stage.successRate.toFixed(1)}%`,
          recommendation: 'Investigate and fix error causes'
        });
      }
    });
    
    // Throughput bottlenecks
    if (performanceAnalysis.throughput.current < performanceAnalysis.throughput.peak * 0.5) {
      bottlenecks.push({
        type: 'throughput_degradation',
        location: 'pipeline',
        severity: 'high',
        impact: 'Current throughput at 50% of peak capacity',
        recommendation: 'Investigate resource constraints'
      });
    }
    
    return bottlenecks;
  }
  
  private async analyzeDataQuality(
    timeRange: any,
    pipeline?: string
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    const query: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } }
        ],
        should: [
          { exists: { field: 'data.validation' } },
          { exists: { field: 'data.quality' } }
        ]
      }
    };
    
    if (pipeline) {
      query.bool.must.push({ term: { 'pipeline.name.keyword': pipeline } });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.logs,
      query,
      {
        size: 0,
        aggregations: {
          validation_results: {
            filters: {
              filters: {
                valid: { term: { 'data.validation.result': 'valid' } },
                invalid: { term: { 'data.validation.result': 'invalid' } },
                warning: { term: { 'data.validation.result': 'warning' } }
              }
            }
          },
          quality_metrics: {
            stats: { field: 'data.quality.score' }
          },
          validation_errors: {
            terms: {
              field: 'data.validation.error_type.keyword',
              size: 10
            }
          },
          duplicate_rate: {
            cardinality: {
              field: 'data.record_id',
              precision_threshold: 10000
            }
          }
        }
      }
    );
    
    const validationBuckets = result.aggregations?.validation_results?.buckets || {};
    const totalValidation = (validationBuckets.valid?.doc_count || 0) +
                          (validationBuckets.invalid?.doc_count || 0) +
                          (validationBuckets.warning?.doc_count || 0);
    
    return {
      validationRate: totalValidation > 0 ? {
        valid: (validationBuckets.valid?.doc_count || 0) / totalValidation * 100,
        invalid: (validationBuckets.invalid?.doc_count || 0) / totalValidation * 100,
        warning: (validationBuckets.warning?.doc_count || 0) / totalValidation * 100
      } : null,
      qualityScore: {
        avg: result.aggregations?.quality_metrics?.avg || 0,
        min: result.aggregations?.quality_metrics?.min || 0,
        max: result.aggregations?.quality_metrics?.max || 100
      },
      commonErrors: (result.aggregations?.validation_errors?.buckets || []).map((b: any) => ({
        type: b.key,
        count: b.doc_count
      })),
      duplicateEstimate: {
        uniqueRecords: result.aggregations?.duplicate_rate?.value || 0,
        totalRecords: result.hits.total.value
      }
    };
  }
  
  private calculatePipelineHealthScore(
    performanceAnalysis: any,
    stageHealth: any,
    dataQualityMetrics: any,
    slaThresholds: any
  ): any {
    let score = 100;
    const breakdown: any[] = [];
    
    // Performance impact (40 points)
    if (!performanceAnalysis.slaCompliance.processingTime) {
      const penalty = Math.min(20, (performanceAnalysis.latency.avg / slaThresholds.processingTime - 1) * 20);
      score -= penalty;
      breakdown.push({
        category: 'processing_time',
        impact: -penalty,
        reason: 'Processing time exceeds SLA'
      });
    }
    
    if (!performanceAnalysis.slaCompliance.throughput) {
      const penalty = Math.min(20, (1 - performanceAnalysis.throughput.current / slaThresholds.throughput) * 20);
      score -= penalty;
      breakdown.push({
        category: 'throughput',
        impact: -penalty,
        reason: 'Throughput below SLA'
      });
    }
    
    // Error rate impact (30 points)
    if (!performanceAnalysis.slaCompliance.errorRate) {
      const penalty = Math.min(30, performanceAnalysis.errorRate.percentage * 3);
      score -= penalty;
      breakdown.push({
        category: 'error_rate',
        impact: -penalty,
        reason: `Error rate: ${performanceAnalysis.errorRate.percentage.toFixed(2)}%`
      });
    }
    
    // Stage health impact (20 points)
    const unhealthyStages = stageHealth.stages.filter((s: any) => s.health === 'unhealthy').length;
    if (unhealthyStages > 0) {
      const penalty = Math.min(20, unhealthyStages * 5);
      score -= penalty;
      breakdown.push({
        category: 'stage_health',
        impact: -penalty,
        reason: `${unhealthyStages} unhealthy stages`
      });
    }
    
    // Data quality impact (10 points)
    if (dataQualityMetrics && dataQualityMetrics.validationRate) {
      const invalidRate = dataQualityMetrics.validationRate.invalid;
      if (invalidRate > 5) {
        const penalty = Math.min(10, invalidRate);
        score -= penalty;
        breakdown.push({
          category: 'data_quality',
          impact: -penalty,
          reason: `Invalid data rate: ${invalidRate.toFixed(1)}%`
        });
      }
    }
    
    score = Math.max(0, Math.min(100, score));
    
    return {
      overall: score,
      grade: this.getHealthGrade(score),
      breakdown,
      trend: this.calculateHealthTrend(performanceAnalysis)
    };
  }
  
  private getHealthGrade(score: number): string {
    if (score >= 95) return 'A';
    if (score >= 85) return 'B';
    if (score >= 75) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
  
  private calculateHealthTrend(performanceAnalysis: any): string {
    const throughputTrend = performanceAnalysis.throughput.trend;
    const errorTrend = performanceAnalysis.errorRate.trend;
    
    if (throughputTrend === 'increasing' && errorTrend === 'decreasing') {
      return 'improving';
    } else if (throughputTrend === 'decreasing' || errorTrend === 'increasing') {
      return 'degrading';
    }
    return 'stable';
  }
  
  private assessBottleneckImpact(bottlenecks: any[]): any {
    const highSeverity = bottlenecks.filter(b => b.severity === 'high').length;
    const mediumSeverity = bottlenecks.filter(b => b.severity === 'medium').length;
    
    return {
      severity: highSeverity > 0 ? 'high' : mediumSeverity > 0 ? 'medium' : 'low',
      estimatedLatencyImpact: highSeverity * 2000 + mediumSeverity * 500,
      affectedStages: [...new Set(bottlenecks.map(b => b.location))]
    };
  }
  
  private generatePipelineAlerts(
    performanceAnalysis: any,
    healthScore: any,
    bottlenecks: any[]
  ): any[] {
    const alerts: any[] = [];
    
    // Critical health alert
    if (healthScore.overall < 60) {
      alerts.push({
        severity: 'critical',
        type: 'pipeline_health',
        message: `Pipeline health critical: ${healthScore.overall}/100`,
        action: 'Immediate investigation required'
      });
    }
    
    // SLA violation alerts
    if (!performanceAnalysis.slaCompliance.overall) {
      const violations = [];
      if (!performanceAnalysis.slaCompliance.processingTime) violations.push('processing time');
      if (!performanceAnalysis.slaCompliance.errorRate) violations.push('error rate');
      if (!performanceAnalysis.slaCompliance.throughput) violations.push('throughput');
      
      alerts.push({
        severity: 'high',
        type: 'sla_violation',
        message: `SLA violations: ${violations.join(', ')}`,
        action: 'Review and optimize pipeline configuration'
      });
    }
    
    // Bottleneck alerts
    const criticalBottlenecks = bottlenecks.filter(b => b.severity === 'high');
    if (criticalBottlenecks.length > 0) {
      alerts.push({
        severity: 'high',
        type: 'bottleneck',
        message: `${criticalBottlenecks.length} critical bottlenecks detected`,
        locations: criticalBottlenecks.map(b => b.location),
        action: 'Address bottlenecks to improve performance'
      });
    }
    
    return alerts;
  }
  
  private generatePipelineRecommendations(
    healthScore: any,
    performanceAnalysis: any,
    bottlenecks: any[],
    dataQualityMetrics: any
  ): any[] {
    const recommendations: any[] = [];
    
    // Performance recommendations
    if (performanceAnalysis.latency.p95 > 10000) {
      recommendations.push({
        priority: 'high',
        category: 'performance',
        action: 'Optimize slow processing stages',
        impact: 'Reduce P95 latency below 10 seconds',
        implementation: [
          'Profile slow stages to identify bottlenecks',
          'Implement parallel processing where possible',
          'Optimize data transformation logic',
          'Consider caching frequently accessed data'
        ]
      });
    }
    
    // Throughput recommendations
    if (performanceAnalysis.throughput.current < performanceAnalysis.throughput.peak * 0.7) {
      recommendations.push({
        priority: 'medium',
        category: 'scaling',
        action: 'Scale pipeline processing capacity',
        impact: 'Restore throughput to peak levels',
        implementation: [
          'Increase worker instances',
          'Optimize batch sizes',
          'Review resource allocation',
          'Implement auto-scaling policies'
        ]
      });
    }
    
    // Error handling recommendations
    if (performanceAnalysis.errorRate.percentage > 2) {
      recommendations.push({
        priority: 'high',
        category: 'reliability',
        action: 'Improve error handling and recovery',
        impact: 'Reduce error rate below 2%',
        implementation: [
          'Implement retry logic with backoff',
          'Add data validation at entry points',
          'Improve error logging and monitoring',
          'Create error recovery procedures'
        ]
      });
    }
    
    // Data quality recommendations
    if (dataQualityMetrics && dataQualityMetrics.validationRate?.invalid > 5) {
      recommendations.push({
        priority: 'medium',
        category: 'data_quality',
        action: 'Enhance data validation',
        impact: 'Reduce invalid data rate',
        implementation: [
          'Strengthen input validation rules',
          'Implement data profiling',
          'Add data quality checkpoints',
          'Create data quality dashboards'
        ]
      });
    }
    
    return recommendations;
  }
  
  private generatePipelineInsights(
    performanceAnalysis: any,
    stageHealth: any,
    dataFlowAnalysis: any,
    dataQualityMetrics: any
  ): any[] {
    const insights: any[] = [];
    
    // Performance insights
    if (performanceAnalysis.latency.p99 > performanceAnalysis.latency.p50 * 10) {
      insights.push({
        type: 'latency_variance',
        severity: 'medium',
        description: 'High latency variance detected',
        detail: `P99 latency is ${(performanceAnalysis.latency.p99 / performanceAnalysis.latency.p50).toFixed(1)}x P50`,
        recommendation: 'Investigate causes of outlier processing times'
      });
    }
    
    // Stage insights
    const stageEfficiency = stageHealth.stages.map((s: any) => ({
      stage: s.name,
      efficiency: s.successRate * (1000 / (s.performance.avgDuration + 1))
    })).sort((a: any, b: any) => a.efficiency - b.efficiency);
    
    if (stageEfficiency.length > 0) {
      insights.push({
        type: 'stage_efficiency',
        severity: 'info',
        description: `Least efficient stage: ${stageEfficiency[0].stage}`,
        detail: `Efficiency score: ${stageEfficiency[0].efficiency.toFixed(2)}`,
        recommendation: 'Focus optimization efforts on this stage'
      });
    }
    
    // Flow insights
    if (dataFlowAnalysis.backpressure.detected) {
      insights.push({
        type: 'backpressure',
        severity: 'high',
        description: 'Pipeline experiencing backpressure',
        detail: `${dataFlowAnalysis.backpressure.events} backpressure events detected`,
        recommendation: 'Increase processing capacity or optimize slow stages'
      });
    }
    
    return insights;
  }
  
  private generatePipelineSummary(
    healthScore: any,
    performanceAnalysis: any,
    bottlenecks: any[]
  ): string {
    const parts: string[] = [];
    
    parts.push(`Pipeline health: ${healthScore.overall}/100 (${healthScore.grade}).`);
    
    if (!performanceAnalysis.slaCompliance.overall) {
      parts.push('SLA violations detected.');
    }
    
    if (bottlenecks.length > 0) {
      parts.push(`${bottlenecks.length} bottlenecks identified.`);
    }
    
    parts.push(`Trend: ${healthScore.trend}.`);
    
    return parts.join(' ');
  }
  
  
  // Helper methods
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  private calculateTrend(values: number[]): string {
    if (values.length < 3) return 'stable';
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = this.calculateAverage(firstHalf);
    const secondAvg = this.calculateAverage(secondHalf);
    
    if (secondAvg > firstAvg * 1.1) return 'increasing';
    if (secondAvg < firstAvg * 0.9) return 'decreasing';
    return 'stable';
  }
  
  private calculateErrorTrend(errorTimeline: any[]): string {
    const errorRates = errorTimeline.map(bucket => {
      const errors = bucket.error_rate?.buckets?.errors?.doc_count || 0;
      const total = bucket.doc_count;
      return total > 0 ? errors / total : 0;
    });
    
    return this.calculateTrend(errorRates);
  }
}
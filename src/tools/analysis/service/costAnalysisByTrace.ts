import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const CostAnalysisByTraceArgsSchema = {
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  service: z.string().optional().describe('Specific service to analyze costs for'),
  operation: z.string().optional().describe('Specific operation to analyze'),
  costModel: z.object({
    cpuHourlyRate: z.number().optional().describe('Cost per CPU hour (default: $0.10)'),
    memoryGBHourlyRate: z.number().optional().describe('Cost per GB memory hour (default: $0.05)'),
    storageGBMonthlyRate: z.number().optional().describe('Cost per GB storage month (default: $0.10)'),
    networkGBRate: z.number().optional().describe('Cost per GB network transfer (default: $0.01)'),
    requestRate: z.number().optional().describe('Cost per 1M requests (default: $0.20)')
  }).optional().describe('Custom cost model configuration'),
  groupBy: z.enum(['service', 'operation', 'user', 'endpoint']).optional().describe('Group cost analysis by dimension (default: service)')
};

type CostAnalysisByTraceArgs = MCPToolSchema<typeof CostAnalysisByTraceArgsSchema>;

/**
 * Tool for analyzing operational costs based on distributed trace data
 */
export class CostAnalysisByTraceTool extends BaseTool<typeof CostAnalysisByTraceArgsSchema> {
  // Static schema property
  static readonly schema = CostAnalysisByTraceArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'analyzeOperationalCosts',
      category: ToolCategory.ANALYSIS,
      description: 'Analyze operational costs by service and identify optimization opportunities',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return CostAnalysisByTraceArgsSchema;
  }
  
  protected async executeImpl(args: CostAnalysisByTraceArgs): Promise<any> {
    const config = ConfigLoader.get();
    const timeRange = { from: args.from, to: args.to };
    const costModel = {
      cpuHourlyRate: args.costModel?.cpuHourlyRate || 0.10,
      memoryGBHourlyRate: args.costModel?.memoryGBHourlyRate || 0.05,
      storageGBMonthlyRate: args.costModel?.storageGBMonthlyRate || 0.10,
      networkGBRate: args.costModel?.networkGBRate || 0.01,
      requestRate: args.costModel?.requestRate || 0.20
    };
    const groupBy = args.groupBy || 'service';
    
    // Get trace-based resource usage
    const resourceUsage = await this.analyzeResourceUsageByTrace(
      timeRange,
      args.service,
      args.operation
    );
    
    if (!resourceUsage || resourceUsage.totalTraces === 0) {
      return this.formatJsonOutput({
        status: 'no_data',
        message: 'No trace data found for cost analysis',
        timeRange: timeRange,
        service: args.service
      });
    }
    
    // Calculate costs by dimension
    const costBreakdown = await this.calculateCostBreakdown(
      resourceUsage,
      costModel,
      groupBy
    );
    
    // Analyze cost patterns
    const costPatterns = await this.analyzeCostPatterns(
      timeRange,
      args.service,
      costModel
    );
    
    // Identify expensive operations
    const expensiveOperations = await this.identifyExpensiveOperations(
      timeRange,
      args.service,
      costModel
    );
    
    // Calculate cost efficiency metrics
    const efficiencyMetrics = this.calculateEfficiencyMetrics(
      resourceUsage,
      costBreakdown
    );
    
    // Generate optimization opportunities
    const optimizationOpportunities = this.identifyOptimizationOpportunities(
      costBreakdown,
      costPatterns,
      expensiveOperations,
      efficiencyMetrics
    );
    
    // Calculate projected savings
    const projectedSavings = this.calculateProjectedSavings(
      optimizationOpportunities,
      costBreakdown
    );
    
    // Generate cost trends
    const costTrends = await this.analyzeCostTrends(
      timeRange,
      costBreakdown,
      costModel
    );
    
    return this.formatJsonOutput({
      analysis: {
        timeRange: timeRange,
        service: args.service || 'all_services',
        totalTraces: resourceUsage.totalTraces,
        analysisDepth: groupBy,
        costModel: {
          cpuRate: `$${costModel.cpuHourlyRate}/CPU-hour`,
          memoryRate: `$${costModel.memoryGBHourlyRate}/GB-hour`,
          storageRate: `$${costModel.storageGBMonthlyRate}/GB-month`,
          networkRate: `$${costModel.networkGBRate}/GB`,
          requestRate: `$${costModel.requestRate}/1M requests`
        }
      },
      totalCosts: {
        total: costBreakdown.total,
        breakdown: {
          compute: costBreakdown.compute,
          memory: costBreakdown.memory,
          storage: costBreakdown.storage,
          network: costBreakdown.network,
          requests: costBreakdown.requests
        },
        hourlyRate: costBreakdown.hourlyRate,
        projectedMonthly: costBreakdown.projectedMonthly
      },
      costByDimension: costBreakdown.byDimension.map((item: any) => ({
        [groupBy]: item.name,
        totalCost: item.totalCost,
        percentageOfTotal: item.percentage,
        breakdown: item.breakdown,
        efficiency: item.efficiency
      })),
      expensiveOperations: expensiveOperations.map(op => ({
        operation: op.operation,
        service: op.service,
        avgCostPerTrace: op.avgCostPerTrace,
        totalCost: op.totalCost,
        traceCount: op.traceCount,
        costDrivers: op.costDrivers
      })),
      costPatterns: {
        peakHours: costPatterns.peakHours,
        costSpikes: costPatterns.spikes,
        periodicPatterns: costPatterns.periodicPatterns,
        anomalies: costPatterns.anomalies
      },
      efficiencyMetrics: {
        costPerRequest: efficiencyMetrics.costPerRequest,
        costPerSuccessfulRequest: efficiencyMetrics.costPerSuccessfulRequest,
        errorCostImpact: efficiencyMetrics.errorCostImpact,
        resourceUtilization: efficiencyMetrics.resourceUtilization,
        wastedResources: efficiencyMetrics.wastedResources
      },
      optimizationOpportunities: {
        immediate: optimizationOpportunities.immediate,
        shortTerm: optimizationOpportunities.shortTerm,
        longTerm: optimizationOpportunities.longTerm
      },
      projectedSavings: {
        total: projectedSavings.total,
        monthly: projectedSavings.monthly,
        byCategory: projectedSavings.byCategory,
        implementationEffort: projectedSavings.implementationEffort
      },
      trends: {
        direction: costTrends.direction,
        percentageChange: costTrends.percentageChange,
        forecast: costTrends.forecast,
        seasonality: costTrends.seasonality
      },
      insights: this.generateCostInsights(
        costBreakdown,
        expensiveOperations,
        efficiencyMetrics,
        optimizationOpportunities
      ),
      recommendations: this.generateCostRecommendations(
        optimizationOpportunities,
        projectedSavings,
        costPatterns
      ),
      summary: this.generateCostSummary(
        costBreakdown,
        projectedSavings,
        costTrends
      )
    });
  }
  
  private async analyzeResourceUsageByTrace(
    timeRange: any,
    service?: string,
    operation?: string
  ): Promise<any> {
    const config = ConfigLoader.get();
    
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
    
    if (operation) {
      query.bool.must.push({ term: { 'span.name.keyword': operation } });
    }
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          total_traces: {
            cardinality: { field: config.telemetry.fields.traceId }
          },
          services: {
            terms: { field: config.telemetry.fields.service, size: 100 },
            aggs: {
              operations: {
                terms: { field: 'span.name.keyword', size: 50 },
                aggs: {
                  trace_count: {
                    cardinality: { field: config.telemetry.fields.traceId }
                  },
                  total_duration: {
                    sum: { field: 'duration' }
                  },
                  avg_duration: {
                    avg: { field: 'duration' }
                  },
                  span_count: {
                    value_count: { field: 'span.id' }
                  },
                  resource_metrics: {
                    stats: { field: 'resource.cpu.usage' }
                  },
                  memory_metrics: {
                    stats: { field: 'resource.memory.usage_bytes' }
                  },
                  network_bytes: {
                    sum: { field: 'network.bytes_total' }
                  }
                }
              },
              service_totals: {
                sum_bucket: {
                  buckets_path: 'operations>total_duration'
                }
              }
            }
          },
          time_series: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1h'
            },
            aggs: {
              request_count: {
                cardinality: { field: config.telemetry.fields.traceId }
              },
              total_compute_time: {
                sum: { field: 'duration' }
              }
            }
          }
        }
      }
    );
    
    return {
      totalTraces: result.aggregations?.total_traces?.value || 0,
      services: result.aggregations?.services?.buckets || [],
      timeSeries: result.aggregations?.time_series?.buckets || []
    };
  }
  
  private async calculateCostBreakdown(
    resourceUsage: any,
    costModel: any,
    groupBy: string
  ): Promise<any> {
    const breakdown = {
      total: 0,
      compute: 0,
      memory: 0,
      storage: 0,
      network: 0,
      requests: 0,
      hourlyRate: 0,
      projectedMonthly: 0,
      byDimension: [] as any[]
    };
    
    // Calculate costs for each service
    resourceUsage.services.forEach((service: any) => {
      let serviceCosts = {
        compute: 0,
        memory: 0,
        storage: 0,
        network: 0,
        requests: 0
      };
      
      service.operations?.buckets?.forEach((op: any) => {
        // Compute cost (based on duration)
        const computeHours = (op.total_duration?.value || 0) / (1000 * 60 * 60); // ms to hours
        const computeCost = computeHours * costModel.cpuHourlyRate;
        serviceCosts.compute += computeCost;
        
        // Memory cost (estimated based on avg 2GB per service)
        const memoryGBHours = computeHours * 2; // Assume 2GB average
        const memoryCost = memoryGBHours * costModel.memoryGBHourlyRate;
        serviceCosts.memory += memoryCost;
        
        // Network cost
        const networkGB = (op.network_bytes?.value || 0) / (1024 * 1024 * 1024);
        const networkCost = networkGB * costModel.networkGBRate;
        serviceCosts.network += networkCost;
        
        // Request cost
        const requestCount = op.trace_count?.value || 0;
        const requestCost = (requestCount / 1000000) * costModel.requestRate;
        serviceCosts.requests += requestCost;
      });
      
      // Storage cost (estimated)
      const storageGB = 0.1; // Assume 100MB per service
      const storageCost = (storageGB * costModel.storageGBMonthlyRate) / 720; // Monthly to hourly
      serviceCosts.storage = storageCost;
      
      const totalServiceCost = Object.values(serviceCosts).reduce((sum, cost) => sum + cost, 0);
      
      breakdown.byDimension.push({
        name: service.key,
        totalCost: totalServiceCost,
        breakdown: serviceCosts,
        efficiency: this.calculateServiceEfficiency(service)
      });
      
      // Add to totals
      breakdown.compute += serviceCosts.compute;
      breakdown.memory += serviceCosts.memory;
      breakdown.storage += serviceCosts.storage;
      breakdown.network += serviceCosts.network;
      breakdown.requests += serviceCosts.requests;
    });
    
    breakdown.total = breakdown.compute + breakdown.memory + breakdown.storage + 
                     breakdown.network + breakdown.requests;
    
    // Calculate rates
    const timeRangeHours = this.calculateTimeRangeHours(resourceUsage.timeSeries);
    breakdown.hourlyRate = breakdown.total / timeRangeHours;
    breakdown.projectedMonthly = breakdown.hourlyRate * 720; // 30 days
    
    // Calculate percentages
    breakdown.byDimension.forEach(dim => {
      dim.percentage = (dim.totalCost / breakdown.total) * 100;
    });
    
    // Sort by cost
    breakdown.byDimension.sort((a, b) => b.totalCost - a.totalCost);
    
    return breakdown;
  }
  
  private calculateServiceEfficiency(service: any): any {
    let totalRequests = 0;
    let totalDuration = 0;
    let totalSpans = 0;
    
    service.operations?.buckets?.forEach((op: any) => {
      totalRequests += op.trace_count?.value || 0;
      totalDuration += op.total_duration?.value || 0;
      totalSpans += op.span_count?.value || 0;
    });
    
    return {
      avgDurationPerRequest: totalRequests > 0 ? totalDuration / totalRequests : 0,
      avgSpansPerRequest: totalRequests > 0 ? totalSpans / totalRequests : 0,
      throughput: totalDuration > 0 ? totalRequests / (totalDuration / 1000) : 0
    };
  }
  
  private calculateTimeRangeHours(timeSeries: any[]): number {
    if (timeSeries.length < 2) return 1;
    
    const firstBucket = new Date(timeSeries[0].key_as_string).getTime();
    const lastBucket = new Date(timeSeries[timeSeries.length - 1].key_as_string).getTime();
    
    return (lastBucket - firstBucket) / (1000 * 60 * 60) + 1; // +1 for the last bucket
  }
  
  private async analyzeCostPatterns(
    timeRange: any,
    service: string | undefined,
    costModel: any
  ): Promise<any> {
    const config = ConfigLoader.get();
    
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
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          hourly_costs: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1h'
            },
            aggs: {
              compute_time: {
                sum: { field: 'duration' }
              },
              request_count: {
                cardinality: { field: config.telemetry.fields.traceId }
              }
            }
          },
          hour_of_day: {
            terms: {
              script: {
                source: "doc['" + config.telemetry.fields.timestamp + "'].value.hourOfDay"
              },
              size: 24
            },
            aggs: {
              avg_compute: {
                avg: { field: 'duration' }
              }
            }
          },
          day_of_week: {
            terms: {
              script: {
                source: "doc['" + config.telemetry.fields.timestamp + "'].value.dayOfWeek"
              },
              size: 7
            },
            aggs: {
              avg_compute: {
                avg: { field: 'duration' }
              }
            }
          }
        }
      }
    );
    
    // Calculate hourly costs
    const hourlyCosts = (result.aggregations?.hourly_costs?.buckets || []).map((bucket: any) => {
      const computeHours = (bucket.compute_time?.value || 0) / (1000 * 60 * 60);
      const requestCount = bucket.request_count?.value || 0;
      
      return {
        time: bucket.key_as_string,
        cost: computeHours * costModel.cpuHourlyRate + 
              (requestCount / 1000000) * costModel.requestRate,
        computeTime: bucket.compute_time?.value || 0,
        requests: requestCount
      };
    });
    
    // Find peak hours
    const sortedByHour = [...hourlyCosts].sort((a, b) => b.cost - a.cost);
    const peakHours = sortedByHour.slice(0, 5).map(h => ({
      time: h.time,
      cost: h.cost,
      factor: sortedByHour.length > 0 ? h.cost / sortedByHour[sortedByHour.length - 1].cost : 1
    }));
    
    // Detect spikes
    const avgCost = hourlyCosts.reduce((sum: number, h: any) => sum + h.cost, 0) / (hourlyCosts.length || 1);
    const stdDev = Math.sqrt(
      hourlyCosts.reduce((sum: number, h: any) => sum + Math.pow(h.cost - avgCost, 2), 0) / (hourlyCosts.length || 1)
    );
    
    const spikes = hourlyCosts.filter((h: any) => h.cost > avgCost + 2 * stdDev).map((h: any) => ({
      time: h.time,
      cost: h.cost,
      severity: h.cost > avgCost + 3 * stdDev ? 'high' : 'medium',
      multiplier: h.cost / avgCost
    }));
    
    // Periodic patterns
    const hourOfDayBuckets = result.aggregations?.hour_of_day?.buckets || [];
    const dayOfWeekBuckets = result.aggregations?.day_of_week?.buckets || [];
    
    return {
      peakHours,
      spikes,
      periodicPatterns: {
        hourly: hourOfDayBuckets.map((b: any) => ({
          hour: b.key,
          avgCompute: b.avg_compute?.value || 0
        })),
        daily: dayOfWeekBuckets.map((b: any) => ({
          day: b.key,
          avgCompute: b.avg_compute?.value || 0
        }))
      },
      anomalies: spikes.filter((s: any) => s.severity === 'high')
    };
  }
  
  private async identifyExpensiveOperations(
    timeRange: any,
    service: string | undefined,
    costModel: any
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    
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
    
    const result = await this.adapter.query(
      config.telemetry.indices.traces,
      query,
      {
        size: 0,
        aggregations: {
          operations: {
            composite: {
              size: 100,
              sources: [
                { service: { terms: { field: config.telemetry.fields.service } } },
                { operation: { terms: { field: 'span.name.keyword' } } }
              ]
            },
            aggs: {
              trace_count: {
                cardinality: { field: config.telemetry.fields.traceId }
              },
              total_duration: {
                sum: { field: 'duration' }
              },
              avg_duration: {
                avg: { field: 'duration' }
              },
              p95_duration: {
                percentiles: {
                  field: 'duration',
                  percents: [95]
                }
              },
              span_count: {
                value_count: { field: 'span.id' }
              },
              error_count: {
                filter: { term: { [config.telemetry.fields.status]: 'ERROR' } }
              }
            }
          }
        }
      }
    );
    
    const operations = (result.aggregations?.operations?.buckets || []).map((bucket: any) => {
      const computeHours = (bucket.total_duration?.value || 0) / (1000 * 60 * 60);
      const traceCount = bucket.trace_count?.value || 0;
      const computeCost = computeHours * costModel.cpuHourlyRate;
      const requestCost = (traceCount / 1000000) * costModel.requestRate;
      const totalCost = computeCost + requestCost;
      
      return {
        service: bucket.key.service,
        operation: bucket.key.operation,
        traceCount,
        totalCost,
        avgCostPerTrace: traceCount > 0 ? totalCost / traceCount : 0,
        avgDuration: bucket.avg_duration?.value || 0,
        p95Duration: bucket.p95_duration?.values?.['95.0'] || 0,
        spanCount: bucket.span_count?.value || 0,
        errorRate: traceCount > 0 ? (bucket.error_count?.doc_count || 0) / traceCount : 0,
        costDrivers: this.identifyCostDrivers(bucket)
      };
    });
    
    // Sort by total cost and return top expensive operations
    return operations
      .sort((a: any, b: any) => b.totalCost - a.totalCost)
      .slice(0, 20);
  }
  
  private identifyCostDrivers(operation: any): string[] {
    const drivers: string[] = [];
    
    const avgDuration = operation.avg_duration?.value || 0;
    const p95Duration = operation.p95_duration?.values?.['95.0'] || 0;
    const spanCount = operation.span_count?.value || 0;
    const traceCount = operation.trace_count?.value || 0;
    
    if (avgDuration > 1000) {
      drivers.push(`High average duration: ${avgDuration.toFixed(0)}ms`);
    }
    
    if (p95Duration > avgDuration * 3) {
      drivers.push(`High latency variance (P95: ${p95Duration.toFixed(0)}ms)`);
    }
    
    if (spanCount / traceCount > 20) {
      drivers.push(`High span count: ${(spanCount / traceCount).toFixed(1)} spans/trace`);
    }
    
    if (operation.error_count?.doc_count > traceCount * 0.05) {
      drivers.push(`High error rate: ${((operation.error_count.doc_count / traceCount) * 100).toFixed(1)}%`);
    }
    
    return drivers;
  }
  
  private calculateEfficiencyMetrics(
    resourceUsage: any,
    costBreakdown: any
  ): any {
    const totalRequests = resourceUsage.totalTraces;
    const successfulRequests = totalRequests * 0.95; // Assume 95% success rate
    
    const costPerRequest = totalRequests > 0 ? costBreakdown.total / totalRequests : 0;
    const costPerSuccessfulRequest = successfulRequests > 0 ? 
      costBreakdown.total / successfulRequests : 0;
    
    const errorCostImpact = costPerSuccessfulRequest - costPerRequest;
    
    // Calculate resource utilization
    const utilizationByService = costBreakdown.byDimension.map((service: any) => ({
      service: service.name,
      utilizationScore: this.calculateUtilizationScore(service),
      efficiency: service.efficiency
    }));
    
    // Identify wasted resources
    const wastedResources = this.identifyWastedResources(
      costBreakdown,
      utilizationByService
    );
    
    return {
      costPerRequest,
      costPerSuccessfulRequest,
      errorCostImpact,
      resourceUtilization: utilizationByService,
      wastedResources
    };
  }
  
  private calculateUtilizationScore(service: any): number {
    // Simple utilization score based on efficiency metrics
    const efficiency = service.efficiency;
    if (!efficiency) return 0;
    
    const throughputScore = Math.min(1, efficiency.throughput / 100);
    const durationScore = 1 - Math.min(1, efficiency.avgDurationPerRequest / 1000);
    const spanScore = 1 - Math.min(1, efficiency.avgSpansPerRequest / 50);
    
    return (throughputScore + durationScore + spanScore) / 3;
  }
  
  private identifyWastedResources(
    costBreakdown: any,
    utilization: any[]
  ): any {
    const lowUtilizationServices = utilization
      .filter(u => u.utilizationScore < 0.5)
      .map(u => {
        const service = costBreakdown.byDimension.find((s: any) => s.name === u.service);
        return {
          service: u.service,
          wastedCost: service ? service.totalCost * (1 - u.utilizationScore) : 0,
          utilizationScore: u.utilizationScore
        };
      });
    
    const totalWasted = lowUtilizationServices.reduce((sum, s) => sum + s.wastedCost, 0);
    
    return {
      totalWasted,
      percentageOfTotal: (totalWasted / costBreakdown.total) * 100,
      services: lowUtilizationServices
    };
  }
  
  private identifyOptimizationOpportunities(
    costBreakdown: any,
    costPatterns: any,
    expensiveOperations: any[],
    efficiencyMetrics: any
  ): any {
    const immediate: any[] = [];
    const shortTerm: any[] = [];
    const longTerm: any[] = [];
    
    // Immediate: High-cost operations with quick wins
    expensiveOperations.slice(0, 5).forEach((op: any) => {
      if (op.avgDuration > 500 && op.costDrivers.length > 0) {
        immediate.push({
          type: 'operation_optimization',
          target: `${op.service}::${op.operation}`,
          currentCost: op.totalCost,
          potentialSaving: op.totalCost * 0.3,
          effort: 'low',
          actions: [
            'Add caching for expensive queries',
            'Optimize database indexes',
            'Implement request batching'
          ]
        });
      }
    });
    
    // Short-term: Resource waste reduction
    if (efficiencyMetrics.wastedResources.percentageOfTotal > 10) {
      shortTerm.push({
        type: 'resource_optimization',
        target: 'Low utilization services',
        currentCost: efficiencyMetrics.wastedResources.totalWasted,
        potentialSaving: efficiencyMetrics.wastedResources.totalWasted * 0.5,
        effort: 'medium',
        actions: [
          'Right-size service instances',
          'Implement auto-scaling',
          'Consolidate underutilized services'
        ]
      });
    }
    
    // Short-term: Peak hour optimization
    if (costPatterns.peakHours.length > 0 && costPatterns.peakHours[0].factor > 3) {
      shortTerm.push({
        type: 'load_balancing',
        target: 'Peak hour traffic',
        currentCost: costPatterns.peakHours[0].cost * 24, // Daily cost estimate
        potentialSaving: costPatterns.peakHours[0].cost * 24 * 0.2,
        effort: 'medium',
        actions: [
          'Implement request queueing',
          'Add CDN for static content',
          'Schedule batch jobs off-peak'
        ]
      });
    }
    
    // Long-term: Architectural improvements
    const highCostServices = costBreakdown.byDimension
      .filter((s: any) => s.percentage > 20)
      .slice(0, 3);
    
    highCostServices.forEach((service: any) => {
      longTerm.push({
        type: 'architecture_redesign',
        target: service.name,
        currentCost: service.totalCost,
        potentialSaving: service.totalCost * 0.4,
        effort: 'high',
        actions: [
          'Migrate to serverless architecture',
          'Implement microservices decomposition',
          'Add edge computing capabilities',
          'Optimize data pipeline architecture'
        ]
      });
    });
    
    return { immediate, shortTerm, longTerm };
  }
  
  private calculateProjectedSavings(
    opportunities: any,
    costBreakdown: any
  ): any {
    let totalSavings = 0;
    const savingsByCategory = {
      immediate: 0,
      shortTerm: 0,
      longTerm: 0
    };
    
    // Calculate savings for each category
    opportunities.immediate.forEach((opp: any) => {
      savingsByCategory.immediate += opp.potentialSaving;
    });
    
    opportunities.shortTerm.forEach((opp: any) => {
      savingsByCategory.shortTerm += opp.potentialSaving;
    });
    
    opportunities.longTerm.forEach((opp: any) => {
      savingsByCategory.longTerm += opp.potentialSaving;
    });
    
    totalSavings = savingsByCategory.immediate + 
                  savingsByCategory.shortTerm + 
                  savingsByCategory.longTerm;
    
    // Calculate implementation effort
    const effortScore = {
      immediate: opportunities.immediate.length * 1,
      shortTerm: opportunities.shortTerm.length * 3,
      longTerm: opportunities.longTerm.length * 5
    };
    
    const totalEffort = effortScore.immediate + effortScore.shortTerm + effortScore.longTerm;
    
    return {
      total: totalSavings,
      monthly: totalSavings * 720 / this.calculateTimeRangeHours([]), // Assume hourly savings
      percentageOfTotal: (totalSavings / costBreakdown.total) * 100,
      byCategory: savingsByCategory,
      implementationEffort: {
        score: totalEffort,
        level: totalEffort > 20 ? 'high' : totalEffort > 10 ? 'medium' : 'low',
        timeline: {
          immediate: '1-2 weeks',
          shortTerm: '1-3 months',
          longTerm: '3-6 months'
        }
      }
    };
  }
  
  private async analyzeCostTrends(
    timeRange: any,
    costBreakdown: any,
    costModel: any
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Get historical cost data
    const historicalQuery: any = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: { from: 'now-30d', to: 'now' } } }
        ]
      }
    };
    
    const historicalResult = await this.adapter.query(
      config.telemetry.indices.traces,
      historicalQuery,
      {
        size: 0,
        aggregations: {
          daily_costs: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '1d'
            },
            aggs: {
              compute_time: {
                sum: { field: 'duration' }
              },
              request_count: {
                cardinality: { field: config.telemetry.fields.traceId }
              }
            }
          }
        }
      }
    );
    
    const dailyCosts = (historicalResult.aggregations?.daily_costs?.buckets || []).map((bucket: any) => {
      const computeHours = (bucket.compute_time?.value || 0) / (1000 * 60 * 60);
      const requestCount = bucket.request_count?.value || 0;
      
      return {
        date: bucket.key_as_string,
        cost: computeHours * costModel.cpuHourlyRate + 
              (requestCount / 1000000) * costModel.requestRate
      };
    });
    
    // Calculate trend
    const recentCosts = dailyCosts.slice(-7);
    const previousCosts = dailyCosts.slice(-14, -7);
    
    const recentAvg = recentCosts.reduce((sum: number, d: any) => sum + d.cost, 0) / (recentCosts.length || 1);
    const previousAvg = previousCosts.reduce((sum: number, d: any) => sum + d.cost, 0) / (previousCosts.length || 1);
    
    const percentageChange = previousAvg > 0 ? 
      ((recentAvg - previousAvg) / previousAvg) * 100 : 0;
    
    // Simple forecast (linear projection)
    const trend = this.calculateTrend(dailyCosts.map((d: any) => d.cost));
    const lastCost = dailyCosts.length > 0 ? dailyCosts[dailyCosts.length - 1].cost : 0;
    const forecast30Days = lastCost + (trend * lastCost * 30);
    
    // Detect seasonality
    const dayOfWeekCosts = new Map<number, number[]>();
    dailyCosts.forEach((d: any) => {
      const dow = new Date(d.date).getDay();
      if (!dayOfWeekCosts.has(dow)) {
        dayOfWeekCosts.set(dow, []);
      }
      dayOfWeekCosts.get(dow)?.push(d.cost);
    });
    
    const seasonality = Array.from(dayOfWeekCosts.entries()).map(([day, costs]) => ({
      dayOfWeek: day,
      avgCost: costs.reduce((sum, c) => sum + c, 0) / costs.length
    }));
    
    return {
      direction: percentageChange > 5 ? 'increasing' : 
                 percentageChange < -5 ? 'decreasing' : 'stable',
      percentageChange,
      forecast: {
        next30Days: forecast30Days,
        confidence: Math.abs(trend) < 0.1 ? 'high' : 'medium'
      },
      seasonality
    };
  }
  
  private generateCostInsights(
    costBreakdown: any,
    expensiveOperations: any[],
    efficiencyMetrics: any,
    optimizationOpportunities: any
  ): any[] {
    const insights: any[] = [];
    
    // Cost concentration insight
    const topService = costBreakdown.byDimension[0];
    if (topService && topService.percentage > 40) {
      insights.push({
        type: 'cost_concentration',
        severity: 'high',
        description: `${topService.name} accounts for ${topService.percentage.toFixed(1)}% of total costs`,
        recommendation: 'Consider architectural changes to distribute load'
      });
    }
    
    // Efficiency insight
    if (efficiencyMetrics.wastedResources.percentageOfTotal > 20) {
      insights.push({
        type: 'resource_waste',
        severity: 'medium',
        description: `${efficiencyMetrics.wastedResources.percentageOfTotal.toFixed(1)}% of costs are from underutilized resources`,
        recommendation: 'Implement auto-scaling and right-sizing'
      });
    }
    
    // Operation cost insight
    if (expensiveOperations.length > 0 && expensiveOperations[0].avgCostPerTrace > 0.01) {
      insights.push({
        type: 'expensive_operation',
        severity: 'medium',
        description: `Top operation costs $${expensiveOperations[0].avgCostPerTrace.toFixed(4)} per trace`,
        operation: `${expensiveOperations[0].service}::${expensiveOperations[0].operation}`,
        recommendation: 'Optimize this operation for significant savings'
      });
    }
    
    // Optimization potential
    const totalPotentialSavings = 
      optimizationOpportunities.immediate.reduce((sum: number, o: any) => sum + o.potentialSaving, 0) +
      optimizationOpportunities.shortTerm.reduce((sum: number, o: any) => sum + o.potentialSaving, 0);
    
    if (totalPotentialSavings > costBreakdown.total * 0.2) {
      insights.push({
        type: 'high_savings_potential',
        severity: 'info',
        description: `Potential to save ${((totalPotentialSavings / costBreakdown.total) * 100).toFixed(1)}% with optimizations`,
        recommendation: 'Prioritize immediate and short-term optimization opportunities'
      });
    }
    
    return insights;
  }
  
  private generateCostRecommendations(
    optimizationOpportunities: any,
    projectedSavings: any,
    costPatterns: any
  ): any[] {
    const recommendations: any[] = [];
    
    // Top immediate opportunities
    if (optimizationOpportunities.immediate.length > 0) {
      const topImmediate = optimizationOpportunities.immediate[0];
      recommendations.push({
        priority: 'high',
        category: 'cost_reduction',
        action: `Optimize ${topImmediate.target}`,
        impact: `Save $${topImmediate.potentialSaving.toFixed(2)} with minimal effort`,
        implementation: topImmediate.actions,
        timeline: '1-2 weeks'
      });
    }
    
    // Resource optimization
    const resourceOpp = optimizationOpportunities.shortTerm.find((o: any) => o.type === 'resource_optimization');
    if (resourceOpp) {
      recommendations.push({
        priority: 'medium',
        category: 'efficiency',
        action: 'Implement resource right-sizing',
        impact: `Reduce waste by $${resourceOpp.potentialSaving.toFixed(2)}`,
        implementation: resourceOpp.actions,
        timeline: '1-3 months'
      });
    }
    
    // Peak load management
    if (costPatterns.peakHours.length > 0 && costPatterns.peakHours[0].factor > 2) {
      recommendations.push({
        priority: 'medium',
        category: 'load_management',
        action: 'Implement peak load optimization',
        impact: 'Reduce peak hour costs by 20-30%',
        implementation: [
          'Implement request prioritization',
          'Add caching layers',
          'Schedule batch jobs during off-peak hours',
          'Use spot instances for non-critical workloads'
        ],
        timeline: '2-4 weeks'
      });
    }
    
    // Long-term architecture
    if (projectedSavings.percentageOfTotal > 30) {
      recommendations.push({
        priority: 'low',
        category: 'architecture',
        action: 'Consider architectural modernization',
        impact: `Potential long-term savings of ${projectedSavings.percentageOfTotal.toFixed(1)}%`,
        implementation: [
          'Evaluate serverless migration',
          'Implement event-driven architecture',
          'Optimize data storage patterns',
          'Consider multi-region optimization'
        ],
        timeline: '3-6 months'
      });
    }
    
    return recommendations;
  }
  
  private generateCostSummary(
    costBreakdown: any,
    projectedSavings: any,
    costTrends: any
  ): string {
    const parts: string[] = [];
    
    parts.push(`Total cost: $${costBreakdown.total.toFixed(2)}.`);
    parts.push(`Projected monthly: $${costBreakdown.projectedMonthly.toFixed(2)}.`);
    
    if (projectedSavings.total > 0) {
      parts.push(`Potential savings: $${projectedSavings.total.toFixed(2)} (${projectedSavings.percentageOfTotal.toFixed(1)}%).`);
    }
    
    parts.push(`Trend: ${costTrends.direction} (${costTrends.percentageChange > 0 ? '+' : ''}${costTrends.percentageChange.toFixed(1)}%).`);
    
    return parts.join(' ');
  }
  
  // Helper method
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = values.reduce((sum, _, i) => sum + i, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
    const sumX2 = values.reduce((sum, _, i) => sum + i * i, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const avgY = sumY / n;
    
    return avgY > 0 ? slope / avgY : 0;
  }
}
import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { ConfigLoader } from '../../../config/index.js';
import { MCPToolSchema } from '../../../types.js';

// Define the Zod schema
const DependencyHealthMonitorArgsSchema = {
  service: z.string().describe('Service whose dependencies to monitor'),
  from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
  to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),
  depth: z.number().optional().describe('Dependency depth to analyze (default: 2)'),
  includeTransitive: z.boolean().optional().describe('Include transitive dependencies (default: true)'),
  healthThresholds: z.object({
    errorRate: z.number().optional().describe('Max acceptable error rate (default: 5%)'),
    latency: z.number().optional().describe('Max acceptable latency in ms (default: 1000)'),
    availability: z.number().optional().describe('Min required availability (default: 99%)')
  }).optional().describe('Health threshold configuration')
};

type DependencyHealthMonitorArgs = MCPToolSchema<typeof DependencyHealthMonitorArgsSchema>;

/**
 * Tool for monitoring the health of service dependencies and their impact
 */
export class DependencyHealthMonitorTool extends BaseTool<typeof DependencyHealthMonitorArgsSchema> {
  // Static schema property
  static readonly schema = DependencyHealthMonitorArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'monitorDependencyHealth',
      category: ToolCategory.ANALYSIS,
      description: 'Monitor health of service dependencies and assess cascade failure risks',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return DependencyHealthMonitorArgsSchema;
  }
  
  protected async executeImpl(args: DependencyHealthMonitorArgs): Promise<any> {
    const config = ConfigLoader.get();
    const depth = args.depth || 2;
    const includeTransitive = args.includeTransitive ?? true;
    const timeRange = { from: args.from, to: args.to };
    const healthThresholds = {
      errorRate: args.healthThresholds?.errorRate || 5,
      latency: args.healthThresholds?.latency || 1000,
      availability: args.healthThresholds?.availability || 99
    };
    
    // Get direct dependencies
    const directDependencies = await this.getServiceDependencies(
      args.service,
      timeRange,
      1
    );
    
    if (directDependencies.length === 0) {
      return this.formatJsonOutput({
        status: 'no_dependencies',
        message: `No dependencies found for service ${args.service}`,
        service: args.service,
        timeRange
      });
    }
    
    // Get transitive dependencies if requested
    let allDependencies = [...directDependencies];
    if (includeTransitive && depth > 1) {
      const transitiveDeps = await this.getTransitiveDependencies(
        directDependencies,
        timeRange,
        depth - 1
      );
      allDependencies = [...allDependencies, ...transitiveDeps];
    }
    
    // Analyze health of each dependency
    const dependencyHealth = await this.analyzeDependencyHealth(
      allDependencies,
      timeRange,
      healthThresholds
    );
    
    // Calculate dependency risk scores
    const riskAnalysis = this.calculateDependencyRisks(
      args.service,
      dependencyHealth,
      allDependencies
    );
    
    // Detect critical dependencies
    const criticalDependencies = this.identifyCriticalDependencies(
      dependencyHealth,
      riskAnalysis
    );
    
    // Analyze failure patterns
    const failurePatterns = await this.analyzeFailurePatterns(
      args.service,
      allDependencies,
      timeRange
    );
    
    // Generate dependency topology
    const topology = this.generateDependencyTopology(
      args.service,
      allDependencies,
      dependencyHealth
    );
    
    // Calculate overall dependency health score
    const healthScore = this.calculateOverallHealthScore(
      dependencyHealth,
      criticalDependencies
    );
    
    // Generate recommendations
    const recommendations = this.generateDependencyRecommendations(
      dependencyHealth,
      criticalDependencies,
      failurePatterns
    );
    
    return this.formatJsonOutput({
      service: args.service,
      analysis: {
        timeRange,
        dependencyDepth: depth,
        totalDependencies: allDependencies.length,
        directDependencies: directDependencies.length,
        transitiveDependencies: allDependencies.length - directDependencies.length
      },
      healthScore: {
        overall: healthScore.score,
        grade: healthScore.grade,
        breakdown: healthScore.breakdown,
        trend: healthScore.trend
      },
      dependencies: dependencyHealth.map((dep: any) => ({
        service: dep.service,
        type: dep.type,
        health: {
          status: dep.health.status,
          score: dep.health.score,
          errorRate: dep.metrics.errorRate,
          latency: dep.metrics.latency,
          availability: dep.metrics.availability
        },
        risk: {
          level: dep.risk.level,
          score: dep.risk.score,
          factors: dep.risk.factors
        }
      })),
      criticalDependencies: {
        count: criticalDependencies.length,
        services: criticalDependencies.map(cd => ({
          service: cd.service,
          criticality: cd.criticality,
          reason: cd.reason,
          impact: cd.impact
        }))
      },
      failurePatterns: {
        cascadeRisk: failurePatterns.cascadeRisk,
        correlatedFailures: failurePatterns.correlatedFailures,
        commonFailureModes: failurePatterns.commonFailureModes
      },
      topology: {
        visualization: topology.visualization,
        clusters: topology.clusters,
        singlePointsOfFailure: topology.singlePointsOfFailure
      },
      alerts: this.generateDependencyAlerts(
        dependencyHealth,
        criticalDependencies,
        failurePatterns
      ),
      recommendations,
      insights: this.generateDependencyInsights(
        dependencyHealth,
        criticalDependencies,
        topology
      ),
      summary: this.generateDependencySummary(
        healthScore,
        criticalDependencies,
        dependencyHealth
      )
    });
  }
  
  private async getServiceDependencies(
    service: string,
    timeRange: any,
    maxDepth: number
  ): Promise<any[]> {
    // Use the adapter's built-in service dependency method
    const dependencies = await this.adapter.getServiceDependencies(timeRange);
    
    // Filter dependencies where the source is our service
    const directDependencies = dependencies.dependencies
      .filter((dep: any) => dep.source === service)
      .map((dep: any) => ({
        source: dep.source,
        target: dep.target,
        type: 'direct',
        callCount: dep.callCount,
        errorRate: dep.errorRate || 0,
        avgDuration: dep.avgDuration || 0
      }));
    
    return directDependencies;
  }
  
  private async getTransitiveDependencies(
    directDependencies: any[],
    timeRange: any,
    remainingDepth: number
  ): Promise<any[]> {
    if (remainingDepth <= 0) return [];
    
    const transitiveDeps: any[] = [];
    const processedServices = new Set<string>();
    
    for (const dep of directDependencies) {
      if (!processedServices.has(dep.target)) {
        processedServices.add(dep.target);
        
        const nextLevelDeps = await this.getServiceDependencies(
          dep.target,
          timeRange,
          1
        );
        
        // Mark as transitive and update depth
        nextLevelDeps.forEach(nd => {
          nd.type = 'transitive';
          nd.depth = dep.depth + 1;
          nd.via = dep.target;
        });
        
        transitiveDeps.push(...nextLevelDeps);
        
        // Recursively get deeper dependencies
        if (remainingDepth > 1) {
          const deeperDeps = await this.getTransitiveDependencies(
            nextLevelDeps,
            timeRange,
            remainingDepth - 1
          );
          transitiveDeps.push(...deeperDeps);
        }
      }
    }
    
    return transitiveDeps;
  }
  
  private async analyzeDependencyHealth(
    dependencies: any[],
    timeRange: any,
    thresholds: any
  ): Promise<any[]> {
    const config = ConfigLoader.get();
    const healthAnalysis: any[] = [];
    
    for (const dep of dependencies) {
      // Get detailed metrics for each dependency
      const metricsQuery = {
        bool: {
          must: [
            { term: { [config.telemetry.fields.service]: dep.target } },
            { range: { [config.telemetry.fields.timestamp]: timeRange } }
          ]
        }
      };
      
      const metricsResult = await this.adapter.query(
        config.telemetry.indices.traces,
        metricsQuery,
        {
          size: 0,
          aggregations: {
            total_requests: {
              cardinality: { field: config.telemetry.fields.traceId }
            },
            error_requests: {
              filter: { term: { [config.telemetry.fields.status]: 'ERROR' } },
              aggs: {
                count: { cardinality: { field: config.telemetry.fields.traceId } }
              }
            },
            latency_percentiles: {
              percentiles: {
                field: 'duration',
                percents: [50, 90, 95, 99]
              }
            },
            availability_timeline: {
              date_histogram: {
                field: config.telemetry.fields.timestamp,
                fixed_interval: '5m'
              },
              aggs: {
                success_rate: {
                  filters: {
                    filters: {
                      success: { term: { [config.telemetry.fields.status]: 'OK' } },
                      total: { match_all: {} }
                    }
                  }
                }
              }
            }
          }
        }
      );
      
      const totalRequests = metricsResult.aggregations?.total_requests?.value || 0;
      const errorRequests = metricsResult.aggregations?.error_requests?.count?.value || 0;
      const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;
      
      const latencyP95 = metricsResult.aggregations?.latency_percentiles?.values?.['95.0'] || 0;
      
      // Calculate availability
      const availabilityBuckets = metricsResult.aggregations?.availability_timeline?.buckets || [];
      const availability = this.calculateAvailability(availabilityBuckets);
      
      // Determine health status
      const healthStatus = this.determineHealthStatus(
        errorRate,
        latencyP95,
        availability,
        thresholds
      );
      
      // Calculate risk factors
      const riskFactors = this.assessRiskFactors(dep, errorRate, latencyP95, availability);
      
      healthAnalysis.push({
        service: dep.target,
        type: dep.type,
        depth: dep.depth,
        via: dep.via,
        metrics: {
          errorRate,
          latency: {
            p50: metricsResult.aggregations?.latency_percentiles?.values?.['50.0'] || 0,
            p90: metricsResult.aggregations?.latency_percentiles?.values?.['90.0'] || 0,
            p95: latencyP95,
            p99: metricsResult.aggregations?.latency_percentiles?.values?.['99.0'] || 0
          },
          availability,
          requestVolume: totalRequests
        },
        health: {
          status: healthStatus.status,
          score: healthStatus.score,
          violations: healthStatus.violations
        },
        risk: {
          level: riskFactors.level,
          score: riskFactors.score,
          factors: riskFactors.factors
        },
        dependency: dep
      });
    }
    
    return healthAnalysis;
  }
  
  private calculateAvailability(timelineBuckets: any[]): number {
    if (timelineBuckets.length === 0) return 100;
    
    let totalPeriods = 0;
    let availablePeriods = 0;
    
    timelineBuckets.forEach(bucket => {
      const successCount = bucket.success_rate?.buckets?.success?.doc_count || 0;
      const totalCount = bucket.success_rate?.buckets?.total?.doc_count || 0;
      
      if (totalCount > 0) {
        totalPeriods++;
        const successRate = successCount / totalCount;
        if (successRate >= 0.95) { // Consider 95%+ success as "available"
          availablePeriods++;
        }
      }
    });
    
    return totalPeriods > 0 ? (availablePeriods / totalPeriods) * 100 : 100;
  }
  
  private determineHealthStatus(
    errorRate: number,
    latencyP95: number,
    availability: number,
    thresholds: any
  ): any {
    const violations: string[] = [];
    let score = 100;
    
    // Check error rate
    if (errorRate > thresholds.errorRate) {
      violations.push(`Error rate ${errorRate.toFixed(2)}% exceeds threshold ${thresholds.errorRate}%`);
      score -= Math.min(30, errorRate * 2);
    }
    
    // Check latency
    if (latencyP95 > thresholds.latency) {
      violations.push(`P95 latency ${latencyP95.toFixed(0)}ms exceeds threshold ${thresholds.latency}ms`);
      score -= Math.min(30, (latencyP95 / thresholds.latency - 1) * 20);
    }
    
    // Check availability
    if (availability < thresholds.availability) {
      violations.push(`Availability ${availability.toFixed(2)}% below threshold ${thresholds.availability}%`);
      score -= Math.min(40, (thresholds.availability - availability) * 4);
    }
    
    score = Math.max(0, Math.min(100, score));
    
    let status = 'healthy';
    if (score < 70) status = 'unhealthy';
    else if (score < 85) status = 'degraded';
    
    return { status, score, violations };
  }
  
  private assessRiskFactors(
    dependency: any,
    errorRate: number,
    latency: number,
    availability: number
  ): any {
    const factors: string[] = [];
    let riskScore = 0;
    
    // High error rate risk
    if (errorRate > 10) {
      factors.push('High error rate');
      riskScore += 30;
    } else if (errorRate > 5) {
      factors.push('Elevated error rate');
      riskScore += 15;
    }
    
    // Latency risk
    if (latency > 2000) {
      factors.push('High latency');
      riskScore += 20;
    } else if (latency > 1000) {
      factors.push('Moderate latency');
      riskScore += 10;
    }
    
    // Availability risk
    if (availability < 95) {
      factors.push('Low availability');
      riskScore += 30;
    } else if (availability < 99) {
      factors.push('Suboptimal availability');
      riskScore += 15;
    }
    
    // Dependency type risk
    if (dependency.type === 'direct' && dependency.callCount > 1000) {
      factors.push('High-volume direct dependency');
      riskScore += 10;
    }
    
    // Transitive dependency risk
    if (dependency.type === 'transitive' && dependency.depth > 2) {
      factors.push('Deep transitive dependency');
      riskScore += 15;
    }
    
    let level = 'low';
    if (riskScore > 50) level = 'high';
    else if (riskScore > 25) level = 'medium';
    
    return { level, score: riskScore, factors };
  }
  
  private calculateDependencyRisks(
    service: string,
    dependencyHealth: any[],
    allDependencies: any[]
  ): any {
    const riskAnalysis = {
      totalRisk: 0,
      riskDistribution: {
        high: 0,
        medium: 0,
        low: 0
      },
      riskByType: {
        direct: { count: 0, avgRisk: 0 },
        transitive: { count: 0, avgRisk: 0 }
      },
      topRisks: [] as any[]
    };
    
    dependencyHealth.forEach(dep => {
      riskAnalysis.totalRisk += dep.risk.score;
      riskAnalysis.riskDistribution[dep.risk.level as keyof typeof riskAnalysis.riskDistribution]++;
      
      const typeKey = dep.type as keyof typeof riskAnalysis.riskByType;
      riskAnalysis.riskByType[typeKey].count++;
      riskAnalysis.riskByType[typeKey].avgRisk += dep.risk.score;
    });
    
    // Calculate averages
    Object.keys(riskAnalysis.riskByType).forEach(type => {
      const typeData = riskAnalysis.riskByType[type as keyof typeof riskAnalysis.riskByType];
      if (typeData.count > 0) {
        typeData.avgRisk = typeData.avgRisk / typeData.count;
      }
    });
    
    // Get top risks
    riskAnalysis.topRisks = dependencyHealth
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, 5)
      .map(dep => ({
        service: dep.service,
        riskScore: dep.risk.score,
        level: dep.risk.level,
        factors: dep.risk.factors
      }));
    
    return riskAnalysis;
  }
  
  private identifyCriticalDependencies(
    dependencyHealth: any[],
    riskAnalysis: any
  ): any[] {
    const criticalDeps: any[] = [];
    
    dependencyHealth.forEach(dep => {
      let criticality = 'low';
      let reason = '';
      let impact = '';
      
      // High risk + high volume = critical
      if (dep.risk.level === 'high' && dep.dependency.callCount > 1000) {
        criticality = 'critical';
        reason = 'High risk with high call volume';
        impact = 'Service failure would cause major disruption';
      }
      // Single point of failure
      else if (dep.type === 'direct' && dep.metrics.requestVolume > 5000 && dep.health.score < 70) {
        criticality = 'critical';
        reason = 'Single point of failure with poor health';
        impact = 'Direct dependency failure would impact all operations';
      }
      // Unhealthy core dependency
      else if (dep.health.status === 'unhealthy' && dep.dependency.callCount > 500) {
        criticality = 'high';
        reason = 'Unhealthy dependency with significant traffic';
        impact = 'Ongoing issues affecting service reliability';
      }
      // Deep transitive with issues
      else if (dep.type === 'transitive' && dep.depth > 2 && dep.health.score < 80) {
        criticality = 'medium';
        reason = 'Deep transitive dependency with health issues';
        impact = 'Indirect failures difficult to diagnose';
      }
      
      if (criticality !== 'low') {
        criticalDeps.push({
          service: dep.service,
          criticality,
          reason,
          impact,
          health: dep.health,
          metrics: dep.metrics
        });
      }
    });
    
    // Sort by criticality
    const criticalityOrder = { critical: 0, high: 1, medium: 2 };
    return criticalDeps.sort((a, b) => 
      criticalityOrder[a.criticality as keyof typeof criticalityOrder] - 
      criticalityOrder[b.criticality as keyof typeof criticalityOrder]
    );
  }
  
  private async analyzeFailurePatterns(
    service: string,
    dependencies: any[],
    timeRange: any
  ): Promise<any> {
    const config = ConfigLoader.get();
    
    // Get failure correlation data
    const failureQuery = {
      bool: {
        must: [
          { range: { [config.telemetry.fields.timestamp]: timeRange } },
          { term: { [config.telemetry.fields.status]: 'ERROR' } },
          {
            bool: {
              should: [
                { term: { [config.telemetry.fields.service]: service } },
                ...dependencies.map(d => ({ term: { [config.telemetry.fields.service]: d.target } }))
              ]
            }
          }
        ]
      }
    };
    
    const failureResult = await this.adapter.query(
      config.telemetry.indices.traces,
      failureQuery,
      {
        size: 0,
        aggregations: {
          failure_timeline: {
            date_histogram: {
              field: config.telemetry.fields.timestamp,
              fixed_interval: '5m'
            },
            aggs: {
              failing_services: {
                terms: {
                  field: config.telemetry.fields.service,
                  size: 20
                }
              }
            }
          },
          error_types: {
            terms: {
              field: 'error.type.keyword',
              size: 10
            }
          }
        }
      }
    );
    
    // Analyze cascade patterns
    const cascadeRisk = this.analyzeCascadeRisk(
      failureResult.aggregations?.failure_timeline?.buckets || [],
      service,
      dependencies
    );
    
    // Find correlated failures
    const correlatedFailures = this.findCorrelatedFailures(
      failureResult.aggregations?.failure_timeline?.buckets || []
    );
    
    // Common failure modes
    const commonFailureModes = (failureResult.aggregations?.error_types?.buckets || [])
      .map((bucket: any) => ({
        type: bucket.key,
        count: bucket.doc_count,
        percentage: 0 // Will be calculated
      }));
    
    const totalFailures = commonFailureModes.reduce((sum: number, mode: any) => sum + mode.count, 0);
    commonFailureModes.forEach((mode: any) => {
      mode.percentage = totalFailures > 0 ? (mode.count / totalFailures) * 100 : 0;
    });
    
    return {
      cascadeRisk,
      correlatedFailures,
      commonFailureModes
    };
  }
  
  private analyzeCascadeRisk(
    failureTimeline: any[],
    service: string,
    dependencies: any[]
  ): any {
    let cascadeEvents = 0;
    let maxCascadeSize = 0;
    const cascadePatterns: any[] = [];
    
    failureTimeline.forEach(bucket => {
      const failingServices = bucket.failing_services?.buckets || [];
      const serviceSet = new Set(failingServices.map((s: any) => s.key));
      
      // Check if multiple related services failed together
      if (serviceSet.has(service) && serviceSet.size > 1) {
        cascadeEvents++;
        maxCascadeSize = Math.max(maxCascadeSize, serviceSet.size);
        
        // Identify cascade pattern
        const affectedDeps = dependencies
          .filter(d => serviceSet.has(d.target))
          .map(d => d.target);
        
        if (affectedDeps.length > 0) {
          cascadePatterns.push({
            time: bucket.key_as_string,
            affectedServices: Array.from(serviceSet),
            pattern: serviceSet.size > 3 ? 'widespread' : 'limited'
          });
        }
      }
    });
    
    return {
      risk: cascadeEvents > 5 ? 'high' : cascadeEvents > 2 ? 'medium' : 'low',
      cascadeEvents,
      maxCascadeSize,
      patterns: cascadePatterns.slice(0, 5) // Top 5 patterns
    };
  }
  
  private findCorrelatedFailures(failureTimeline: any[]): any[] {
    const correlations: any[] = [];
    const serviceFailures = new Map<string, number[]>();
    
    // Build failure timeline for each service
    failureTimeline.forEach((bucket, index) => {
      const services = bucket.failing_services?.buckets || [];
      services.forEach((service: any) => {
        if (!serviceFailures.has(service.key)) {
          serviceFailures.set(service.key, new Array(failureTimeline.length).fill(0));
        }
        serviceFailures.get(service.key)![index] = service.doc_count;
      });
    });
    
    // Calculate correlations between service pairs
    const services = Array.from(serviceFailures.keys());
    for (let i = 0; i < services.length; i++) {
      for (let j = i + 1; j < services.length; j++) {
        const service1 = services[i];
        const service2 = services[j];
        const correlation = this.calculateCorrelation(
          serviceFailures.get(service1)!,
          serviceFailures.get(service2)!
        );
        
        if (correlation > 0.7) {
          correlations.push({
            services: [service1, service2],
            correlation,
            strength: correlation > 0.9 ? 'strong' : 'moderate'
          });
        }
      }
    }
    
    return correlations.sort((a, b) => b.correlation - a.correlation).slice(0, 10);
  }
  
  private calculateCorrelation(series1: number[], series2: number[]): number {
    if (series1.length !== series2.length || series1.length === 0) return 0;
    
    const mean1 = series1.reduce((a, b) => a + b, 0) / series1.length;
    const mean2 = series2.reduce((a, b) => a + b, 0) / series2.length;
    
    let numerator = 0;
    let denominator1 = 0;
    let denominator2 = 0;
    
    for (let i = 0; i < series1.length; i++) {
      const diff1 = series1[i] - mean1;
      const diff2 = series2[i] - mean2;
      numerator += diff1 * diff2;
      denominator1 += diff1 * diff1;
      denominator2 += diff2 * diff2;
    }
    
    const denominator = Math.sqrt(denominator1 * denominator2);
    return denominator === 0 ? 0 : numerator / denominator;
  }
  
  private generateDependencyTopology(
    service: string,
    dependencies: any[],
    dependencyHealth: any[]
  ): any {
    // Create health lookup
    const healthLookup = new Map<string, any>();
    dependencyHealth.forEach(dh => {
      healthLookup.set(dh.service, dh);
    });
    
    // Build topology visualization
    const nodes = new Set<string>([service]);
    const edges: any[] = [];
    
    dependencies.forEach(dep => {
      nodes.add(dep.target);
      const health = healthLookup.get(dep.target);
      
      edges.push({
        source: dep.source || service,
        target: dep.target,
        type: dep.type,
        health: health?.health.status || 'unknown',
        callVolume: dep.callCount
      });
    });
    
    // Identify clusters
    const clusters = this.identifyServiceClusters(dependencies);
    
    // Find single points of failure
    const singlePointsOfFailure = this.findSinglePointsOfFailure(
      service,
      dependencies,
      dependencyHealth
    );
    
    return {
      visualization: {
        nodes: Array.from(nodes).map(node => ({
          id: node,
          type: node === service ? 'primary' : 'dependency',
          health: healthLookup.get(node)?.health.status || 'unknown'
        })),
        edges
      },
      clusters,
      singlePointsOfFailure
    };
  }
  
  private identifyServiceClusters(dependencies: any[]): any[] {
    const clusters: any[] = [];
    const serviceGroups = new Map<string, Set<string>>();
    
    // Group services by common dependencies
    dependencies.forEach(dep => {
      const key = dep.source || 'unknown';
      if (!serviceGroups.has(key)) {
        serviceGroups.set(key, new Set());
      }
      serviceGroups.get(key)!.add(dep.target);
    });
    
    // Identify clusters
    for (const [source, targets] of serviceGroups) {
      if (targets.size > 3) {
        clusters.push({
          hub: source,
          members: Array.from(targets),
          size: targets.size,
          type: targets.size > 10 ? 'large' : 'medium'
        });
      }
    }
    
    return clusters;
  }
  
  private findSinglePointsOfFailure(
    service: string,
    dependencies: any[],
    dependencyHealth: any[]
  ): any[] {
    const singlePoints: any[] = [];
    
    // Find dependencies that many others depend on
    const dependencyCounts = new Map<string, number>();
    dependencies.forEach(dep => {
      dependencyCounts.set(dep.target, (dependencyCounts.get(dep.target) || 0) + 1);
    });
    
    dependencyCounts.forEach((count, depService) => {
      if (count > 3) {
        const health = dependencyHealth.find(dh => dh.service === depService);
        singlePoints.push({
          service: depService,
          dependentCount: count,
          health: health?.health.status || 'unknown',
          risk: count > 5 ? 'high' : 'medium',
          impact: `Failure would affect ${count} dependent services`
        });
      }
    });
    
    return singlePoints.sort((a, b) => b.dependentCount - a.dependentCount);
  }
  
  private calculateOverallHealthScore(
    dependencyHealth: any[],
    criticalDependencies: any[]
  ): any {
    let score = 100;
    const breakdown: any[] = [];
    
    // Unhealthy dependencies impact
    const unhealthyCount = dependencyHealth.filter(d => d.health.status === 'unhealthy').length;
    const degradedCount = dependencyHealth.filter(d => d.health.status === 'degraded').length;
    
    if (unhealthyCount > 0) {
      const penalty = Math.min(40, unhealthyCount * 15);
      score -= penalty;
      breakdown.push({
        category: 'unhealthy_dependencies',
        impact: -penalty,
        reason: `${unhealthyCount} unhealthy dependencies`
      });
    }
    
    if (degradedCount > 0) {
      const penalty = Math.min(20, degradedCount * 5);
      score -= penalty;
      breakdown.push({
        category: 'degraded_dependencies',
        impact: -penalty,
        reason: `${degradedCount} degraded dependencies`
      });
    }
    
    // Critical dependencies impact
    const criticalCount = criticalDependencies.filter(cd => cd.criticality === 'critical').length;
    if (criticalCount > 0) {
      const penalty = Math.min(30, criticalCount * 15);
      score -= penalty;
      breakdown.push({
        category: 'critical_dependencies',
        impact: -penalty,
        reason: `${criticalCount} critical dependencies at risk`
      });
    }
    
    // Average dependency health
    const avgHealthScore = dependencyHealth.reduce((sum, d) => sum + d.health.score, 0) / 
                         (dependencyHealth.length || 1);
    if (avgHealthScore < 80) {
      const penalty = Math.min(10, (80 - avgHealthScore) / 2);
      score -= penalty;
      breakdown.push({
        category: 'average_health',
        impact: -penalty,
        reason: `Average dependency health: ${avgHealthScore.toFixed(1)}`
      });
    }
    
    score = Math.max(0, Math.min(100, score));
    
    return {
      score,
      grade: this.getHealthGrade(score),
      breakdown,
      trend: this.calculateHealthTrend(dependencyHealth)
    };
  }
  
  private getHealthGrade(score: number): string {
    if (score >= 95) return 'A';
    if (score >= 85) return 'B';
    if (score >= 75) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
  
  private calculateHealthTrend(dependencyHealth: any[]): string {
    // Simplified trend calculation
    const avgScore = dependencyHealth.reduce((sum, d) => sum + d.health.score, 0) / 
                    (dependencyHealth.length || 1);
    
    if (avgScore >= 85) return 'stable';
    if (avgScore >= 70) return 'concerning';
    return 'deteriorating';
  }
  
  private generateDependencyAlerts(
    dependencyHealth: any[],
    criticalDependencies: any[],
    failurePatterns: any
  ): any[] {
    const alerts: any[] = [];
    
    // Critical dependency alerts
    const criticalCount = criticalDependencies.filter(cd => cd.criticality === 'critical').length;
    if (criticalCount > 0) {
      alerts.push({
        severity: 'critical',
        type: 'critical_dependencies',
        message: `${criticalCount} critical dependencies identified`,
        dependencies: criticalDependencies
          .filter(cd => cd.criticality === 'critical')
          .map(cd => cd.service),
        action: 'Immediate review and mitigation required'
      });
    }
    
    // Cascade risk alerts
    if (failurePatterns.cascadeRisk.risk === 'high') {
      alerts.push({
        severity: 'high',
        type: 'cascade_risk',
        message: `High cascade failure risk detected`,
        detail: `${failurePatterns.cascadeRisk.cascadeEvents} cascade events observed`,
        action: 'Implement circuit breakers and fallback mechanisms'
      });
    }
    
    // Unhealthy dependency alerts
    const unhealthyDeps = dependencyHealth.filter(d => d.health.status === 'unhealthy');
    if (unhealthyDeps.length > 0) {
      alerts.push({
        severity: 'high',
        type: 'unhealthy_dependencies',
        message: `${unhealthyDeps.length} dependencies are unhealthy`,
        services: unhealthyDeps.map(d => d.service),
        action: 'Investigate and resolve dependency health issues'
      });
    }
    
    return alerts;
  }
  
  private generateDependencyRecommendations(
    dependencyHealth: any[],
    criticalDependencies: any[],
    failurePatterns: any
  ): any[] {
    const recommendations: any[] = [];
    
    // Critical dependency recommendations
    if (criticalDependencies.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'resilience',
        action: 'Implement redundancy for critical dependencies',
        impact: 'Reduce single points of failure',
        implementation: [
          'Add fallback services for critical dependencies',
          'Implement caching for frequently accessed data',
          'Use circuit breakers to prevent cascade failures',
          'Consider service mesh for advanced traffic management'
        ]
      });
    }
    
    // High error rate dependencies
    const highErrorDeps = dependencyHealth.filter(d => d.metrics.errorRate > 5);
    if (highErrorDeps.length > 0) {
      recommendations.push({
        priority: 'high',
        category: 'reliability',
        action: 'Address high error rate dependencies',
        impact: 'Improve overall system reliability',
        services: highErrorDeps.map(d => d.service),
        implementation: [
          'Review error logs and fix root causes',
          'Implement retry logic with exponential backoff',
          'Add comprehensive error handling',
          'Consider timeout adjustments'
        ]
      });
    }
    
    // Cascade prevention
    if (failurePatterns.cascadeRisk.risk !== 'low') {
      recommendations.push({
        priority: 'medium',
        category: 'architecture',
        action: 'Implement cascade failure prevention',
        impact: 'Prevent widespread outages',
        implementation: [
          'Add bulkheads between service groups',
          'Implement rate limiting',
          'Use asynchronous communication where possible',
          'Create service isolation boundaries'
        ]
      });
    }
    
    // Performance optimization
    const slowDeps = dependencyHealth.filter(d => d.metrics.latency.p95 > 1000);
    if (slowDeps.length > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'performance',
        action: 'Optimize slow dependencies',
        impact: 'Reduce overall latency',
        services: slowDeps.map(d => d.service),
        implementation: [
          'Profile and optimize slow operations',
          'Implement request coalescing',
          'Add appropriate caching layers',
          'Consider parallel processing'
        ]
      });
    }
    
    return recommendations;
  }
  
  private generateDependencyInsights(
    dependencyHealth: any[],
    criticalDependencies: any[],
    topology: any
  ): any[] {
    const insights: any[] = [];
    
    // Dependency depth insight
    const avgDepth = dependencyHealth.reduce((sum, d) => sum + (d.depth || 1), 0) / 
                    (dependencyHealth.length || 1);
    if (avgDepth > 2) {
      insights.push({
        type: 'deep_dependencies',
        severity: 'medium',
        description: `Average dependency depth is ${avgDepth.toFixed(1)} levels`,
        recommendation: 'Consider flattening dependency hierarchy'
      });
    }
    
    // Cluster insight
    if (topology.clusters.length > 0) {
      const largestCluster = topology.clusters[0];
      insights.push({
        type: 'service_clusters',
        severity: 'info',
        description: `Largest dependency cluster has ${largestCluster.size} members`,
        detail: `Hub service: ${largestCluster.hub}`,
        recommendation: 'Monitor cluster health closely'
      });
    }
    
    // Health distribution insight
    const healthDist = {
      healthy: dependencyHealth.filter(d => d.health.status === 'healthy').length,
      degraded: dependencyHealth.filter(d => d.health.status === 'degraded').length,
      unhealthy: dependencyHealth.filter(d => d.health.status === 'unhealthy').length
    };
    
    if (healthDist.unhealthy > healthDist.healthy) {
      insights.push({
        type: 'poor_dependency_health',
        severity: 'high',
        description: 'More unhealthy dependencies than healthy ones',
        detail: `${healthDist.unhealthy} unhealthy vs ${healthDist.healthy} healthy`,
        recommendation: 'Urgent dependency health review required'
      });
    }
    
    return insights;
  }
  
  private generateDependencySummary(
    healthScore: any,
    criticalDependencies: any[],
    dependencyHealth: any[]
  ): string {
    const parts: string[] = [];
    
    parts.push(`Dependency health score: ${healthScore.score}/100 (${healthScore.grade}).`);
    
    if (criticalDependencies.length > 0) {
      parts.push(`${criticalDependencies.length} critical dependencies identified.`);
    }
    
    const unhealthyCount = dependencyHealth.filter(d => d.health.status === 'unhealthy').length;
    if (unhealthyCount > 0) {
      parts.push(`${unhealthyCount} unhealthy dependencies.`);
    }
    
    parts.push(`Status: ${healthScore.trend}.`);
    
    return parts.join(' ');
  }
}
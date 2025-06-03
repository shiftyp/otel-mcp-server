import { z } from 'zod';
import { BaseTool, ToolCategory } from '../../base/tool.js';
import { BaseSearchAdapter } from '../../../adapters/base/searchAdapter.js';
import { MCPToolSchema } from '../../../types.js';
import { logger } from '../../../utils/logger.js';

// Define the Zod schema
const ServiceTopologyVisualizationArgsSchema = {
  from: z.string().optional().describe('Start time (e.g., "now-1h" or ISO timestamp), defaults to "now-1h"'),
  to: z.string().optional().describe('End time (e.g., "now" or ISO timestamp), defaults to "now"'),
  service: z.string().optional().describe('Filter to show dependencies for a specific service'),
  layout: z.enum(['force-directed', 'hierarchical', 'circular']).optional().describe('Layout preference for visualization (defaults to "force-directed")'),
  metricFocus: z.enum(['latency', 'errors', 'throughput']).optional().describe('Metric to emphasize in visualization (defaults to "latency")')
};

type ServiceTopologyVisualizationArgs = MCPToolSchema<typeof ServiceTopologyVisualizationArgsSchema>;

/**
 * Service node for visualization
 */
interface VisualizationNode {
  id: string;
  label: string;
  type: 'service' | 'database' | 'cache' | 'external' | 'hub';
  metrics: {
    callVolume: number;
    avgLatency: number;
    errorRate: number;
    throughput: number;
  };
  visualization: {
    size: number;
    color: string;
    shape: string;
    borderWidth: number;
    borderColor: string;
    font: {
      size: number;
      color: string;
      bold: boolean;
    };
  };
  layout?: {
    level?: number;
    x?: number;
    y?: number;
  };
}

/**
 * Service edge for visualization
 */
interface VisualizationEdge {
  id: string;
  source: string;
  target: string;
  metrics: {
    callCount: number;
    avgLatency: number;
    errorRate: number;
    throughput: number;
  };
  visualization: {
    width: number;
    color: string;
    style: 'solid' | 'dashed' | 'dotted';
    animated: boolean;
    label: string;
    arrows: {
      to: {
        enabled: boolean;
        scaleFactor: number;
      };
    };
  };
}

/**
 * Critical path information
 */
interface CriticalPath {
  path: string[];
  totalLatency: number;
  errorRate: number;
  callCount: number;
  bottlenecks: string[];
}

/**
 * Tool for visualizing service topology and dependencies
 */
export class ServiceTopologyVisualizationTool extends BaseTool<typeof ServiceTopologyVisualizationArgsSchema> {
  // Static schema property
  static readonly schema = ServiceTopologyVisualizationArgsSchema;
  
  constructor(adapter: BaseSearchAdapter) {
    super(adapter, {
      name: 'visualizeServiceTopology',
      category: ToolCategory.ANALYSIS,
      description: 'Generate service topology visualization with enhanced metrics and layout hints',
      requiredCapabilities: []
    });
  }
  
  protected getSchema() {
    return ServiceTopologyVisualizationArgsSchema;
  }
  
  protected async executeImpl(args: ServiceTopologyVisualizationArgs): Promise<any> {
    const timeRange = {
      from: args.from || 'now-1h',
      to: args.to || 'now'
    };
    
    const layout = args.layout || 'force-directed';
    const metricFocus = args.metricFocus || 'latency';
    
    logger.info('[ServiceTopologyVisualization] Generating service topology', { 
      timeRange, 
      service: args.service,
      layout,
      metricFocus 
    });
    
    // Get service dependencies with enhanced metrics
    const dependencyData = await this.adapter.getServiceDependencies(timeRange);
    
    if (!dependencyData || (!dependencyData.dependencies && !dependencyData.services)) {
      return this.formatJsonOutput({
        nodes: [],
        edges: [],
        criticalPaths: [],
        insights: {
          summary: 'No service dependencies found in the specified time range',
          bottlenecks: [],
          recommendations: []
        },
        visualization: {
          layout,
          metricFocus
        }
      });
    }
    
    // Filter dependencies if service is specified
    let dependencies = dependencyData.dependencies || [];
    let services = dependencyData.services || [];
    
    if (args.service) {
      dependencies = dependencies.filter((dep: any) => 
        dep.source === args.service || dep.target === args.service
      );
      
      // Include only relevant services
      const relevantServices = new Set<string>([args.service]);
      dependencies.forEach((dep: any) => {
        relevantServices.add(dep.source);
        relevantServices.add(dep.target);
      });
      
      services = services.filter((svc: any) => relevantServices.has(svc.name));
    }
    
    // Create visualization nodes
    const nodes = this.createVisualizationNodes(services, dependencies, metricFocus);
    
    // Create visualization edges
    const edges = this.createVisualizationEdges(dependencies, metricFocus);
    
    // Apply layout hints
    this.applyLayoutHints(nodes, edges, layout);
    
    // Find critical paths
    const criticalPaths = this.findCriticalPaths(nodes, edges);
    
    // Generate insights
    const insights = this.generateInsights(nodes, edges, criticalPaths, dependencyData.metadata);
    
    return this.formatJsonOutput({
      nodes,
      edges,
      criticalPaths,
      insights,
      visualization: {
        layout,
        metricFocus,
        options: this.getVisualizationOptions(layout, metricFocus),
        timeRange,
        filteredByService: args.service
      },
      metadata: {
        totalServices: nodes.length,
        totalDependencies: edges.length,
        ...dependencyData.metadata
      }
    });
  }
  
  private createVisualizationNodes(
    services: any[], 
    dependencies: any[], 
    metricFocus: string
  ): VisualizationNode[] {
    const nodes: VisualizationNode[] = [];
    
    // Create a map of service metrics from dependencies
    const serviceMetricsMap = new Map<string, any>();
    
    dependencies.forEach((dep: any) => {
      // Update source metrics
      if (!serviceMetricsMap.has(dep.source)) {
        serviceMetricsMap.set(dep.source, {
          outgoingCalls: 0,
          incomingCalls: 0,
          totalLatency: 0,
          totalErrors: 0,
          dependencies: new Set(),
          dependents: new Set()
        });
      }
      const sourceMetrics = serviceMetricsMap.get(dep.source);
      sourceMetrics.outgoingCalls += dep.callCount;
      sourceMetrics.totalLatency += dep.latencyStats?.avg || 0;
      sourceMetrics.totalErrors += dep.errorCount || 0;
      sourceMetrics.dependencies.add(dep.target);
      
      // Update target metrics
      if (!serviceMetricsMap.has(dep.target)) {
        serviceMetricsMap.set(dep.target, {
          outgoingCalls: 0,
          incomingCalls: 0,
          totalLatency: 0,
          totalErrors: 0,
          dependencies: new Set(),
          dependents: new Set()
        });
      }
      const targetMetrics = serviceMetricsMap.get(dep.target);
      targetMetrics.incomingCalls += dep.callCount;
      targetMetrics.dependents.add(dep.source);
    });
    
    // Create nodes from services
    services.forEach((service: any) => {
      const metrics = serviceMetricsMap.get(service.name) || {
        outgoingCalls: 0,
        incomingCalls: 0,
        totalLatency: 0,
        totalErrors: 0,
        dependencies: new Set(),
        dependents: new Set()
      };
      
      const totalCalls = metrics.incomingCalls + metrics.outgoingCalls;
      const avgLatency = service.avgIncomingLatency || service.avgOutgoingLatency || 0;
      const errorRate = totalCalls > 0 ? (metrics.totalErrors / totalCalls) * 100 : 0;
      const throughput = service.throughput || (totalCalls / 60); // calls per minute
      
      // Determine node type
      let nodeType: VisualizationNode['type'] = 'service';
      if (metrics.dependencies.size > 5 || metrics.dependents.size > 5) {
        nodeType = 'hub';
      }
      
      // Calculate node size based on call volume
      const baseSize = 30;
      const sizeMultiplier = this.getSizeMultiplier(totalCalls, metricFocus);
      const nodeSize = baseSize + sizeMultiplier;
      
      // Determine color based on metric focus
      const nodeColor = this.getNodeColor(avgLatency, errorRate, throughput, metricFocus);
      
      // Determine if this is a critical node
      const isCritical = this.isNodeCritical(avgLatency, errorRate, metrics);
      
      nodes.push({
        id: service.name,
        label: service.name,
        type: nodeType,
        metrics: {
          callVolume: totalCalls,
          avgLatency,
          errorRate,
          throughput
        },
        visualization: {
          size: nodeSize,
          color: nodeColor,
          shape: nodeType === 'hub' ? 'diamond' : 'circle',
          borderWidth: isCritical ? 3 : 1,
          borderColor: isCritical ? '#ff0000' : '#333333',
          font: {
            size: 12 + Math.min(sizeMultiplier / 10, 6),
            color: '#333333',
            bold: isCritical
          }
        }
      });
    });
    
    return nodes;
  }
  
  private createVisualizationEdges(
    dependencies: any[], 
    metricFocus: string
  ): VisualizationEdge[] {
    return dependencies.map((dep: any) => {
      const callCount = dep.callCount || 0;
      const avgLatency = dep.latencyStats?.avg || dep.avgDuration || 0;
      const errorRate = dep.errorRate || 0;
      const throughput = dep.throughput || 0;
      
      // Calculate edge width based on call count
      const edgeWidth = Math.min(1 + Math.log10(callCount + 1) * 2, 10);
      
      // Determine color based on metric focus
      const edgeColor = this.getEdgeColor(avgLatency, errorRate, throughput, metricFocus);
      
      // Determine style based on health
      let edgeStyle: VisualizationEdge['visualization']['style'] = 'solid';
      if (errorRate > 50) {
        edgeStyle = 'dotted';
      } else if (errorRate > 20) {
        edgeStyle = 'dashed';
      }
      
      // Animate critical edges
      const animated = errorRate > 20 || avgLatency > 1000;
      
      // Create label with key metrics
      const label = this.createEdgeLabel(callCount, avgLatency, errorRate, metricFocus);
      
      return {
        id: `${dep.source}-${dep.target}`,
        source: dep.source,
        target: dep.target,
        metrics: {
          callCount,
          avgLatency,
          errorRate,
          throughput
        },
        visualization: {
          width: edgeWidth,
          color: edgeColor,
          style: edgeStyle,
          animated,
          label,
          arrows: {
            to: {
              enabled: true,
              scaleFactor: 1 + Math.min(edgeWidth / 10, 0.5)
            }
          }
        }
      };
    });
  }
  
  private applyLayoutHints(
    nodes: VisualizationNode[], 
    edges: VisualizationEdge[], 
    layout: string
  ): void {
    if (layout === 'hierarchical') {
      // Calculate node levels for hierarchical layout
      const levels = this.calculateHierarchicalLevels(nodes, edges);
      nodes.forEach(node => {
        node.layout = { level: levels.get(node.id) || 0 };
      });
    } else if (layout === 'circular') {
      // Arrange nodes in a circle, with hubs in the center
      const hubs = nodes.filter(n => n.type === 'hub');
      const regular = nodes.filter(n => n.type !== 'hub');
      
      // Place hubs in inner circle
      hubs.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / hubs.length;
        node.layout = {
          x: Math.cos(angle) * 100,
          y: Math.sin(angle) * 100
        };
      });
      
      // Place regular nodes in outer circle
      regular.forEach((node, i) => {
        const angle = (2 * Math.PI * i) / regular.length;
        node.layout = {
          x: Math.cos(angle) * 200,
          y: Math.sin(angle) * 200
        };
      });
    }
    // For force-directed, we don't need to set positions
  }
  
  private findCriticalPaths(
    nodes: VisualizationNode[], 
    edges: VisualizationEdge[]
  ): CriticalPath[] {
    const criticalPaths: CriticalPath[] = [];
    
    // Build adjacency list
    const graph = new Map<string, string[]>();
    edges.forEach(edge => {
      if (!graph.has(edge.source)) {
        graph.set(edge.source, []);
      }
      graph.get(edge.source)!.push(edge.target);
    });
    
    // Find entry points (nodes with no incoming edges)
    const entryPoints = nodes.filter(node => 
      !edges.some(edge => edge.target === node.id)
    );
    
    // DFS to find paths from entry points
    for (const entryPoint of entryPoints) {
      const paths = this.findPathsFromNode(entryPoint.id, graph, nodes, edges);
      
      // Filter and rank paths
      const significantPaths = paths
        .filter(path => path.path.length >= 3)
        .map(path => {
          // Calculate total metrics for the path
          let totalLatency = 0;
          let totalErrors = 0;
          let totalCalls = 0;
          const bottlenecks: string[] = [];
          
          for (let i = 0; i < path.path.length - 1; i++) {
            const edge = edges.find(e => 
              e.source === path.path[i] && e.target === path.path[i + 1]
            );
            
            if (edge) {
              totalLatency += edge.metrics.avgLatency;
              totalErrors += edge.metrics.errorRate * edge.metrics.callCount;
              totalCalls += edge.metrics.callCount;
              
              // Identify bottlenecks
              if (edge.metrics.avgLatency > 500 || edge.metrics.errorRate > 10) {
                bottlenecks.push(`${edge.source} → ${edge.target}`);
              }
            }
          }
          
          return {
            path: path.path,
            totalLatency,
            errorRate: totalCalls > 0 ? (totalErrors / totalCalls) : 0,
            callCount: totalCalls,
            bottlenecks
          };
        })
        .sort((a, b) => b.totalLatency - a.totalLatency);
      
      criticalPaths.push(...significantPaths.slice(0, 3));
    }
    
    return criticalPaths.slice(0, 10);
  }
  
  private generateInsights(
    nodes: VisualizationNode[], 
    edges: VisualizationEdge[], 
    criticalPaths: CriticalPath[],
    metadata: any
  ): any {
    const bottlenecks: any[] = [];
    const recommendations: string[] = [];
    
    // Identify service bottlenecks
    nodes.forEach(node => {
      if (node.metrics.avgLatency > 1000) {
        bottlenecks.push({
          service: node.id,
          type: 'high_latency',
          severity: 'high',
          metrics: {
            avgLatency: node.metrics.avgLatency,
            callVolume: node.metrics.callVolume
          },
          impact: `Service ${node.id} has high latency (${node.metrics.avgLatency.toFixed(0)}ms)`
        });
        recommendations.push(`Optimize ${node.id} service - consider caching, query optimization, or scaling`);
      }
      
      if (node.metrics.errorRate > 10) {
        bottlenecks.push({
          service: node.id,
          type: 'high_error_rate',
          severity: 'critical',
          metrics: {
            errorRate: node.metrics.errorRate,
            callVolume: node.metrics.callVolume
          },
          impact: `Service ${node.id} has high error rate (${node.metrics.errorRate.toFixed(1)}%)`
        });
        recommendations.push(`Investigate and fix errors in ${node.id} service`);
      }
    });
    
    // Identify edge bottlenecks
    edges.forEach(edge => {
      if (edge.metrics.avgLatency > 500 && edge.metrics.callCount > 100) {
        bottlenecks.push({
          service: `${edge.source} → ${edge.target}`,
          type: 'slow_dependency',
          severity: 'medium',
          metrics: {
            avgLatency: edge.metrics.avgLatency,
            callCount: edge.metrics.callCount
          },
          impact: `Slow communication between ${edge.source} and ${edge.target}`
        });
        recommendations.push(`Consider caching or batching calls between ${edge.source} and ${edge.target}`);
      }
    });
    
    // Summary based on overall health
    const avgErrorRate = edges.length > 0 
      ? edges.reduce((sum, e) => sum + e.metrics.errorRate, 0) / edges.length 
      : 0;
    
    const avgLatency = nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.metrics.avgLatency, 0) / nodes.length
      : 0;
    
    let summary = `Analyzed ${nodes.length} services with ${edges.length} dependencies. `;
    
    if (avgErrorRate > 5) {
      summary += `System shows elevated error rates (avg ${avgErrorRate.toFixed(1)}%). `;
    }
    
    if (avgLatency > 500) {
      summary += `Overall latency is high (avg ${avgLatency.toFixed(0)}ms). `;
    }
    
    if (criticalPaths.length > 0) {
      summary += `Found ${criticalPaths.length} critical paths requiring attention.`;
    }
    
    // Add metadata insights
    if (metadata?.topBottlenecks && metadata.topBottlenecks.length > 0) {
      recommendations.push(`Focus on top bottlenecks: ${metadata.topBottlenecks.map((b: any) => b.path).join(', ')}`);
    }
    
    return {
      summary,
      bottlenecks: bottlenecks.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity as keyof typeof severityOrder] - 
               severityOrder[b.severity as keyof typeof severityOrder];
      }),
      recommendations: [...new Set(recommendations)], // Remove duplicates
      healthScore: this.calculateHealthScore(avgErrorRate, avgLatency, bottlenecks.length)
    };
  }
  
  // Helper methods
  
  private getSizeMultiplier(callVolume: number, metricFocus: string): number {
    if (metricFocus === 'throughput') {
      return Math.min(Math.log10(callVolume + 1) * 15, 60);
    }
    return Math.min(Math.log10(callVolume + 1) * 10, 40);
  }
  
  private getNodeColor(latency: number, errorRate: number, throughput: number, metricFocus: string): string {
    if (metricFocus === 'latency') {
      if (latency > 1000) return '#ff4444';
      if (latency > 500) return '#ff9800';
      if (latency > 200) return '#ffc107';
      return '#4caf50';
    } else if (metricFocus === 'errors') {
      if (errorRate > 10) return '#ff4444';
      if (errorRate > 5) return '#ff9800';
      if (errorRate > 1) return '#ffc107';
      return '#4caf50';
    } else { // throughput
      if (throughput < 10) return '#ff9800';
      if (throughput < 100) return '#ffc107';
      return '#4caf50';
    }
  }
  
  private getEdgeColor(latency: number, errorRate: number, throughput: number, metricFocus: string): string {
    if (metricFocus === 'latency') {
      if (latency > 1000) return '#ff4444';
      if (latency > 500) return '#ff9800';
      return '#4caf50';
    } else if (metricFocus === 'errors') {
      if (errorRate > 10) return '#ff4444';
      if (errorRate > 5) return '#ff9800';
      return '#4caf50';
    } else { // throughput
      if (throughput < 1) return '#ff9800';
      return '#4caf50';
    }
  }
  
  private isNodeCritical(latency: number, errorRate: number, metrics: any): boolean {
    return latency > 1000 || 
           errorRate > 10 || 
           (metrics.dependents.size > 3 && latency > 500);
  }
  
  private createEdgeLabel(callCount: number, latency: number, errorRate: number, metricFocus: string): string {
    if (metricFocus === 'latency') {
      return `${latency.toFixed(0)}ms`;
    } else if (metricFocus === 'errors') {
      return `${errorRate.toFixed(1)}%`;
    } else {
      return `${callCount}`;
    }
  }
  
  private calculateHierarchicalLevels(nodes: VisualizationNode[], edges: VisualizationEdge[]): Map<string, number> {
    const levels = new Map<string, number>();
    const inDegree = new Map<string, number>();
    
    // Initialize in-degree for all nodes
    nodes.forEach(node => {
      inDegree.set(node.id, 0);
    });
    
    // Calculate in-degree
    edges.forEach(edge => {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });
    
    // BFS to assign levels
    const queue: string[] = [];
    nodes.forEach(node => {
      if (inDegree.get(node.id) === 0) {
        queue.push(node.id);
        levels.set(node.id, 0);
      }
    });
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) || 0;
      
      edges
        .filter(edge => edge.source === current)
        .forEach(edge => {
          if (!levels.has(edge.target)) {
            levels.set(edge.target, currentLevel + 1);
            queue.push(edge.target);
          }
        });
    }
    
    return levels;
  }
  
  private findPathsFromNode(
    nodeId: string, 
    graph: Map<string, string[]>, 
    nodes: VisualizationNode[], 
    edges: VisualizationEdge[]
  ): Array<{ path: string[] }> {
    const paths: Array<{ path: string[] }> = [];
    const visited = new Set<string>();
    
    const dfs = (current: string, path: string[]) => {
      if (visited.has(current)) return;
      
      visited.add(current);
      path.push(current);
      
      const neighbors = graph.get(current) || [];
      if (neighbors.length === 0 || path.length >= 6) {
        paths.push({ path: [...path] });
      } else {
        for (const neighbor of neighbors) {
          dfs(neighbor, path);
        }
      }
      
      path.pop();
      visited.delete(current);
    };
    
    dfs(nodeId, []);
    return paths;
  }
  
  private calculateHealthScore(avgErrorRate: number, avgLatency: number, bottleneckCount: number): number {
    let score = 100;
    
    // Deduct for error rate
    score -= Math.min(avgErrorRate * 2, 40);
    
    // Deduct for latency
    if (avgLatency > 1000) score -= 30;
    else if (avgLatency > 500) score -= 20;
    else if (avgLatency > 200) score -= 10;
    
    // Deduct for bottlenecks
    score -= Math.min(bottleneckCount * 5, 30);
    
    return Math.max(0, Math.round(score));
  }
  
  private getVisualizationOptions(layout: string, metricFocus: string): any {
    const baseOptions = {
      physics: {
        enabled: layout === 'force-directed',
        barnesHut: {
          gravitationalConstant: -2000,
          centralGravity: 0.3,
          springLength: 100,
          springConstant: 0.05,
          damping: 0.95
        }
      },
      layout: layout === 'hierarchical' ? {
        hierarchical: {
          direction: 'UD',
          sortMethod: 'directed',
          levelSeparation: 150,
          nodeSpacing: 100
        }
      } : undefined,
      interaction: {
        hover: true,
        tooltipDelay: 100,
        hideEdgesOnDrag: true
      },
      edges: {
        smooth: {
          type: 'continuous',
          roundness: 0.5
        }
      }
    };
    
    // Add metric-specific options
    if (metricFocus === 'errors') {
      baseOptions.edges.smooth.roundness = 0.2; // Straighter lines for error visualization
    }
    
    return baseOptions;
  }
}
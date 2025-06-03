// This is a template file showing the standardized schema patterns for all tools
// Each tool should follow these patterns for consistency

// Standard time range parameters (flattened):
// from: z.string().describe('Start time for analysis (ISO 8601 format or relative like "now-1h")'),
// to: z.string().describe('End time for analysis (ISO 8601 format or relative like "now")'),

// Standard service parameter:
// service: z.string().optional().describe('Service name to analyze (analyzes all services if not specified)'),

// Standard threshold parameters should be clear about units:
// errorRateThreshold: z.number().optional().describe('Maximum acceptable error rate as percentage (default: 5)'),
// latencyThresholdMs: z.number().optional().describe('Maximum acceptable latency in milliseconds (default: 1000)'),

// Boolean parameters should explain what happens when true/false:
// includeDetails: z.boolean().optional().describe('Include detailed analysis in results (default: true)'),

// Enum parameters should list all options in description:
// analysisType: z.enum(['basic', 'detailed', 'comprehensive']).optional().describe('Level of analysis depth: basic (fast), detailed (balanced), comprehensive (thorough). Default: detailed'),

// Array parameters should explain expected format:
// services: z.array(z.string()).optional().describe('List of service names to analyze (e.g., ["api", "database", "cache"])'),

// Tool naming conventions:
// - Use clear action verbs: analyze, detect, monitor, compare, calculate
// - Be specific about what the tool does
// - Avoid abbreviations

// Description conventions:
// - Start with an action verb
// - Explain what the tool analyzes and what insights it provides
// - Mention key metrics or patterns it looks for
// - Keep under 100 characters for tool description, be more detailed in parameter descriptions

export const schemaPatterns = {
  timeRange: {
    from: 'Start time for analysis (ISO 8601 format or relative like "now-1h")',
    to: 'End time for analysis (ISO 8601 format or relative like "now")'
  },
  service: {
    required: 'Service name to analyze',
    optional: 'Service name to analyze (analyzes all services if not specified)'
  },
  thresholds: {
    percentage: 'threshold as percentage (0-100)',
    milliseconds: 'threshold in milliseconds',
    count: 'threshold as count',
    rate: 'threshold as rate per unit'
  }
};
/**
 * OpenTelemetry Data Types
 */

// Trace types
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'SPAN_KIND_SERVER' | 'SPAN_KIND_CLIENT' | 'SPAN_KIND_PRODUCER' | 'SPAN_KIND_CONSUMER' | 'SPAN_KIND_INTERNAL';
  startTime: string;
  endTime: string;
  duration: number;
  status: {
    code: 'OK' | 'ERROR' | 'UNSET';
    message?: string;
  };
  attributes: Record<string, string | number | boolean>;
  events?: SpanEvent[];
  links?: SpanLink[];
}

export interface SpanEvent {
  time: string;
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface Trace {
  traceId: string;
  spans: Span[];
  service: string;
  duration: number;
  spanCount: number;
  errorCount: number;
  rootSpan?: Span;
}

// Log types
export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  service: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, string | number | boolean>;
  resource?: Record<string, string | number | boolean>;
}

// Metric types
export interface MetricPoint {
  timestamp: string;
  value: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface Metric {
  name: string;
  type: 'gauge' | 'counter' | 'histogram' | 'summary';
  unit?: string;
  description?: string;
  service: string;
  points: MetricPoint[];
}

// Service types
export interface ServiceDependency {
  source: string;
  target: string;
  callCount: number;
  errorCount: number;
  avgLatency: number;
  maxLatency: number;
}

export interface ServiceMetadata {
  name: string;
  language?: string;
  version?: string;
  environment?: string;
  instanceCount?: number;
  dependencies?: string[];
  operations?: string[];
}

// Field info types
export interface FieldInfo {
  name: string;
  type: string;
  count: number;
  cardinality: number;
  examples: unknown[];
  isIndexed: boolean;
  isStored: boolean;
  coOccurringFields?: string[];
}

// Analysis result types
export interface AnomalyResult {
  timestamp: string;
  type: 'spike' | 'dip' | 'pattern' | 'outlier';
  severity: 'low' | 'medium' | 'high' | 'critical';
  value: number;
  expected?: number;
  deviation?: number;
  confidence: number;
  context?: Record<string, unknown>;
}

export interface ClusterResult {
  clusterId: string;
  size: number;
  centroid: Record<string, number>;
  members: string[];
  characteristics: Record<string, unknown>;
}

export interface ForecastResult {
  timestamp: string;
  predicted: number;
  upperBound: number;
  lowerBound: number;
  confidence: number;
}

// Error types
export interface ErrorInfo {
  type: string;
  message: string;
  stackTrace?: string;
  service: string;
  timestamp: string;
  traceId?: string;
  spanId?: string;
  count?: number;
}
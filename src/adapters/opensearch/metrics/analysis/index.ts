/**
 * Metrics analysis modules
 * Clean, modular implementations without code duplication
 */

export { HistogramAnalyzer } from './histogramAnalyzer.js';
export type { 
  HistogramConfig, 
  HistogramData, 
  HistogramStats 
} from './histogramAnalyzer.js';

export { HistogramComparator } from './histogramComparator.js';
export type { 
  HistogramComparisonResult, 
  ComparisonOptions 
} from './histogramComparator.js';

export { MetricAnomalyDetector } from './anomalyDetector.js';
export type { 
  AnomalyDetectionConfig, 
  Anomaly, 
  AnomalyDetectionResult 
} from './anomalyDetector.js';

export { TimeSeriesAnalyzer } from './timeSeriesAnalyzer.js';
export type { 
  TimeSeriesConfig, 
  TrendInfo, 
  SeasonalityInfo, 
  ForecastPoint, 
  TimeSeriesAnalysisResult 
} from './timeSeriesAnalyzer.js';
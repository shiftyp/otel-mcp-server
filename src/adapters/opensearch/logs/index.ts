// Main logs adapter
export { LogsAdapter } from './adapter.js';

// Core types and functionality
export { 
  LogsCoreAdapter,
  ILogsAdapter,
  LogQueryOptions,
  LogAggregationOptions,
  LogSearchResponse,
  LogField
} from './core/index.js';

// Re-export specific types to avoid conflicts
export type { LogEntry, LogStats } from './core/index.js';

// Search functionality
export { LogSearcher, LogFieldAnalyzer, FieldStats, FieldAnalysisOptions } from './search/index.js';

// Pattern analysis
export { 
  LogPatternMiner,
  FrequentPattern,
  AssociationRule,
  PatternMiningOptions
} from './patterns/index.js';

// Re-export pattern types with disambiguated names
export type { 
  LogPattern,
  PatternExtractionOptions,
  PatternChange
} from './patterns/index.js';

// ML and NLP
export { 
  SemanticLogSearcher,
  LogNLPAnalyzer,
  EmbeddingProvider,
  EmbeddingProviderFactory,
  SimpleEmbeddingProvider,
  OpenSearchEmbeddingProvider,
  NLPAnalysisOptions,
  LogEntity,
  SentimentResult,
  KeyPhrase
} from './ml/index.js';

// Re-export ML types with disambiguated names
export type {
  SemanticSearchOptions,
  SemanticSearchResult
} from './ml/index.js';

// Analysis modules
export {
  LogAnalyzer,
  LogAnomalyDetector,
  LogPatternExtractor,
  LogSemanticSearcher as AnalysisSemanticSearcher,
  LogTimeSeriesAnalyzer,
  AnomalyDetectionOptions,
  LogAnomaly,
  TimeSeriesOptions,
  TimeSeriesPoint,
  TimeSeriesAnalysis
} from './analysis/index.js';
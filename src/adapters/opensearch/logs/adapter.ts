import { LogsCoreAdapter } from './core/adapter.js';
import { LogSearcher, LogFieldAnalyzer } from './search/index.js';
import { LogPatternExtractor, LogPatternMiner } from './patterns/index.js';
import { SemanticLogSearcher, LogNLPAnalyzer, EmbeddingProviderFactory } from './ml/index.js';
import { LogAnalyzer, LogAnomalyDetector, LogTimeSeriesAnalyzer } from './analysis/index.js';

/**
 * Main OpenSearch Logs Adapter
 * Provides comprehensive log analysis capabilities
 */
export class LogsAdapter {
  private readonly core: LogsCoreAdapter;
  private readonly searcher: LogSearcher;
  private readonly fieldAnalyzer: LogFieldAnalyzer;
  private readonly patternExtractor: LogPatternExtractor;
  private readonly patternMiner: LogPatternMiner;
  private readonly semanticSearcher: SemanticLogSearcher;
  private readonly nlpAnalyzer: LogNLPAnalyzer;
  private readonly analyzer: LogAnalyzer;
  private readonly anomalyDetector: LogAnomalyDetector;
  private readonly timeSeriesAnalyzer: LogTimeSeriesAnalyzer;

  constructor(options: any) {
    // Initialize core adapter
    this.core = new LogsCoreAdapter(options);
    
    // Initialize search modules
    this.searcher = new LogSearcher(this.core);
    this.fieldAnalyzer = new LogFieldAnalyzer(this.core);
    
    // Initialize pattern modules
    this.patternExtractor = new LogPatternExtractor(this.core);
    this.patternMiner = new LogPatternMiner(this.core);
    
    // Initialize ML modules
    const embeddingProvider = EmbeddingProviderFactory.create(
      options.embeddingProvider || 'simple',
      options.embeddingOptions
    );
    this.semanticSearcher = new SemanticLogSearcher(this.core, embeddingProvider);
    this.nlpAnalyzer = new LogNLPAnalyzer(this.core);
    
    // Initialize analysis modules
    this.analyzer = new LogAnalyzer();
    this.anomalyDetector = new LogAnomalyDetector(this.core, this.analyzer);
    this.timeSeriesAnalyzer = new LogTimeSeriesAnalyzer(this.core, this.analyzer);
  }

  /**
   * Core functionality
   */
  public get coreAdapter() {
    return this.core;
  }

  /**
   * Search functionality
   */
  public get search() {
    return this.searcher;
  }

  public get fields() {
    return this.fieldAnalyzer;
  }

  /**
   * Pattern analysis
   */
  public get patterns() {
    return {
      extract: this.patternExtractor.extractPatterns.bind(this.patternExtractor),
      compare: this.patternExtractor.comparePatterns.bind(this.patternExtractor),
      findRare: this.patternExtractor.findRarePatterns.bind(this.patternExtractor),
      group: this.patternExtractor.groupSimilarPatterns.bind(this.patternExtractor),
      mine: {
        frequentPatterns: this.patternMiner.mineFrequentPatterns.bind(this.patternMiner),
        associationRules: this.patternMiner.mineAssociationRules.bind(this.patternMiner),
        sequentialPatterns: this.patternMiner.mineSequentialPatterns.bind(this.patternMiner),
        detectAnomalous: this.patternMiner.detectAnomalousPatterns.bind(this.patternMiner)
      }
    };
  }

  /**
   * ML and semantic capabilities
   */
  public get ml() {
    return {
      semantic: {
        search: this.semanticSearcher.search.bind(this.semanticSearcher),
        findSimilar: this.semanticSearcher.findSimilar.bind(this.semanticSearcher),
        nlpSearch: this.semanticSearcher.nlpSearch.bind(this.semanticSearcher),
        cluster: this.semanticSearcher.clusterLogs.bind(this.semanticSearcher)
      },
      nlp: {
        analyze: this.nlpAnalyzer.analyze.bind(this.nlpAnalyzer),
        extractEntities: this.nlpAnalyzer.extractEntities.bind(this.nlpAnalyzer),
        analyzeSentiment: this.nlpAnalyzer.analyzeSentiment.bind(this.nlpAnalyzer),
        extractKeyPhrases: this.nlpAnalyzer.extractKeyPhrases.bind(this.nlpAnalyzer),
        detectLanguage: this.nlpAnalyzer.detectLanguage.bind(this.nlpAnalyzer)
      }
    };
  }

  /**
   * Analysis capabilities
   */
  public get analysis() {
    return {
      detectAnomalies: this.anomalyDetector.detectAnomalies.bind(this.anomalyDetector),
      detectRealTimeAnomalies: this.anomalyDetector.detectRealTimeAnomalies.bind(this.anomalyDetector),
      analyzeTimeSeries: this.timeSeriesAnalyzer.analyze.bind(this.timeSeriesAnalyzer),
      forecast: this.timeSeriesAnalyzer.forecast.bind(this.timeSeriesAnalyzer),
      compareTimeWindows: this.timeSeriesAnalyzer.compare.bind(this.timeSeriesAnalyzer)
    };
  }

  /**
   * Direct access to underlying services (for backwards compatibility)
   */
  public async searchLogs(query: any) {
    return this.core.searchLogs(query);
  }

  public async queryLogs(query: any) {
    return this.core.queryLogs(query);
  }

  public async getLogFields() {
    return this.core.getLogFields();
  }

  public async getServices(timeRange?: { from: string; to: string }) {
    return this.core.getServices(timeRange);
  }

  public async getLogLevelStats(
    timeRange?: { from: string; to: string },
    service?: string
  ) {
    return this.core.getLogLevelStats(timeRange, service);
  }
}
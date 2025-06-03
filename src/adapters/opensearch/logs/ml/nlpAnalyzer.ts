import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogEntry } from '../core/types.js';

/**
 * NLP analysis options
 */
export interface NLPAnalysisOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  extractEntities?: boolean;
  extractSentiment?: boolean;
  extractKeyPhrases?: boolean;
  limit?: number;
}

/**
 * Entity extracted from logs
 */
export interface LogEntity {
  text: string;
  type: 'IP' | 'URL' | 'EMAIL' | 'ERROR_CODE' | 'FILE_PATH' | 'USER' | 'SERVICE' | 'OTHER';
  count: number;
  examples: string[];
}

/**
 * Sentiment analysis result
 */
export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  distribution: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

/**
 * Key phrase
 */
export interface KeyPhrase {
  phrase: string;
  count: number;
  relevanceScore: number;
  contexts: string[];
}

/**
 * NLP analyzer for logs
 */
export class LogNLPAnalyzer {
  constructor(private readonly adapter: LogsCoreAdapter) {}

  /**
   * Perform comprehensive NLP analysis
   */
  public async analyze(
    options: NLPAnalysisOptions = {}
  ): Promise<{
    entities: LogEntity[];
    sentiment: SentimentResult;
    keyPhrases: KeyPhrase[];
    summary: string;
  }> {
    logger.info('[LogNLPAnalyzer] Performing NLP analysis', { options });

    const logs = await this.fetchLogs(options);
    
    if (logs.length === 0) {
      return {
        entities: [],
        sentiment: {
          sentiment: 'neutral',
          score: 0,
          distribution: { positive: 0, negative: 0, neutral: 0 }
        },
        keyPhrases: [],
        summary: 'No logs found for analysis'
      };
    }

    // Perform analyses in parallel
    const [entities, sentiment, keyPhrases] = await Promise.all([
      options.extractEntities !== false ? this.extractEntities(logs) : [],
      options.extractSentiment !== false ? this.analyzeSentiment(logs) : null,
      options.extractKeyPhrases !== false ? this.extractKeyPhrases(logs) : []
    ]);

    const summary = this.generateSummary(logs, entities, sentiment, keyPhrases);

    return {
      entities,
      sentiment: sentiment || {
        sentiment: 'neutral',
        score: 0,
        distribution: { positive: 0, negative: 0, neutral: 0 }
      },
      keyPhrases,
      summary
    };
  }

  /**
   * Extract named entities from logs
   */
  public async extractEntities(logs: LogEntry[]): Promise<LogEntity[]> {
    logger.debug('[LogNLPAnalyzer] Extracting entities');

    const entityMap = new Map<string, {
      type: LogEntity['type'];
      examples: Set<string>;
    }>();

    const patterns = [
      { 
        regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 
        type: 'IP' as const 
      },
      { 
        regex: /https?:\/\/[^\s]+/g, 
        type: 'URL' as const 
      },
      { 
        regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 
        type: 'EMAIL' as const 
      },
      { 
        regex: /\b(?:ERROR|ERR|WARN)[-_]?\d+\b/gi, 
        type: 'ERROR_CODE' as const 
      },
      { 
        regex: /(?:\/[\w.-]+)+(?:\.\w+)?/g, 
        type: 'FILE_PATH' as const 
      },
      { 
        regex: /\b(?:user|uid|username)[:=]\s*(\w+)/gi, 
        type: 'USER' as const,
        captureGroup: 1 
      }
    ];

    for (const log of logs) {
      const text = log.message;
      
      for (const { regex, type, captureGroup } of patterns) {
        let match;
        while ((match = regex.exec(text)) !== null) {
          const entity = captureGroup ? match[captureGroup] : match[0];
          const key = `${entity}:${type}`;
          
          if (!entityMap.has(key)) {
            entityMap.set(key, {
              type,
              examples: new Set()
            });
          }
          
          const data = entityMap.get(key)!;
          if (data.examples.size < 3) {
            data.examples.add(text);
          }
        }
      }

      // Extract service names from log attributes
      if (log.service) {
        const key = `${log.service}:SERVICE`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            type: 'SERVICE',
            examples: new Set()
          });
        }
      }
    }

    // Convert to array and calculate counts
    const entities: LogEntity[] = [];
    for (const [key, data] of entityMap) {
      const [text, type] = key.split(':');
      entities.push({
        text,
        type: type as LogEntity['type'],
        count: 1, // Would need to track actual count
        examples: Array.from(data.examples)
      });
    }

    return entities.sort((a, b) => b.count - a.count);
  }

  /**
   * Analyze sentiment of logs
   */
  public async analyzeSentiment(logs: LogEntry[]): Promise<SentimentResult> {
    logger.debug('[LogNLPAnalyzer] Analyzing sentiment');

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    const negativeKeywords = [
      'error', 'fail', 'crash', 'exception', 'critical', 
      'fatal', 'abort', 'panic', 'timeout', 'refused',
      'denied', 'unauthorized', 'forbidden', 'invalid'
    ];

    const positiveKeywords = [
      'success', 'complete', 'ok', 'ready', 'connected',
      'started', 'initialized', 'accepted', 'created',
      'enabled', 'healthy', 'active'
    ];

    for (const log of logs) {
      const text = log.message.toLowerCase();
      let score = 0;

      // Check negative keywords
      for (const keyword of negativeKeywords) {
        if (text.includes(keyword)) {
          score -= 1;
        }
      }

      // Check positive keywords
      for (const keyword of positiveKeywords) {
        if (text.includes(keyword)) {
          score += 1;
        }
      }

      // Also consider log level
      if (log.level === 'error' || log.level === 'fatal') {
        score -= 2;
      } else if (log.level === 'warn') {
        score -= 1;
      }

      // Classify
      if (score < -1) {
        negative++;
      } else if (score > 1) {
        positive++;
      } else {
        neutral++;
      }
    }

    const total = logs.length;
    const overallScore = (positive - negative) / total;
    
    let sentiment: 'positive' | 'negative' | 'neutral';
    if (overallScore > 0.2) {
      sentiment = 'positive';
    } else if (overallScore < -0.2) {
      sentiment = 'negative';
    } else {
      sentiment = 'neutral';
    }

    return {
      sentiment,
      score: overallScore,
      distribution: {
        positive: positive / total,
        negative: negative / total,
        neutral: neutral / total
      }
    };
  }

  /**
   * Extract key phrases from logs
   */
  public async extractKeyPhrases(logs: LogEntry[]): Promise<KeyPhrase[]> {
    logger.debug('[LogNLPAnalyzer] Extracting key phrases');

    const phraseMap = new Map<string, {
      count: number;
      contexts: Set<string>;
    }>();

    // Simple n-gram extraction
    for (const log of logs) {
      const words = log.message
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);

      // Extract bigrams and trigrams
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const phrase = words.slice(i, i + n).join(' ');
          
          // Skip if contains common words
          if (this.containsOnlyCommonWords(phrase)) {
            continue;
          }

          if (!phraseMap.has(phrase)) {
            phraseMap.set(phrase, {
              count: 0,
              contexts: new Set()
            });
          }

          const data = phraseMap.get(phrase)!;
          data.count++;
          
          if (data.contexts.size < 3) {
            data.contexts.add(log.message);
          }
        }
      }
    }

    // Calculate relevance scores and convert to array
    const totalLogs = logs.length;
    const phrases: KeyPhrase[] = [];

    for (const [phrase, data] of phraseMap) {
      if (data.count >= 3) { // Minimum frequency
        const tf = data.count / totalLogs;
        const wordCount = phrase.split(' ').length;
        const relevanceScore = tf * Math.log(wordCount + 1);

        phrases.push({
          phrase,
          count: data.count,
          relevanceScore,
          contexts: Array.from(data.contexts)
        });
      }
    }

    return phrases
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 20);
  }

  /**
   * Detect language of logs
   */
  public async detectLanguage(
    logs: LogEntry[]
  ): Promise<{
    primaryLanguage: string;
    distribution: Record<string, number>;
  }> {
    logger.debug('[LogNLPAnalyzer] Detecting language');

    // Simple language detection based on common words
    const languageIndicators = {
      english: ['the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that'],
      spanish: ['el', 'la', 'de', 'que', 'y', 'en', 'un', 'por', 'con', 'para'],
      french: ['le', 'de', 'un', 'être', 'et', 'à', 'il', 'avoir', 'ne', 'je'],
      german: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich']
    };

    const languageCounts: Record<string, number> = {};

    for (const log of logs) {
      const words = log.message.toLowerCase().split(/\s+/);
      
      for (const [language, indicators] of Object.entries(languageIndicators)) {
        const count = words.filter(word => indicators.includes(word)).length;
        languageCounts[language] = (languageCounts[language] || 0) + count;
      }
    }

    // Find primary language
    let primaryLanguage = 'english';
    let maxCount = 0;

    for (const [language, count] of Object.entries(languageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryLanguage = language;
      }
    }

    // Calculate distribution
    const total = Object.values(languageCounts).reduce((a, b) => a + b, 0);
    const distribution: Record<string, number> = {};

    for (const [language, count] of Object.entries(languageCounts)) {
      distribution[language] = total > 0 ? count / total : 0;
    }

    return {
      primaryLanguage,
      distribution
    };
  }

  // Private helper methods

  private async fetchLogs(options: NLPAnalysisOptions): Promise<LogEntry[]> {
    const query: any = {
      size: options.limit || 1000,
      query: { bool: { must: [], filter: [] } }
    };

    if (options.timeRange) {
      query.query.bool.filter.push({
        range: {
          '@timestamp': {
            gte: options.timeRange.from,
            lte: options.timeRange.to
          }
        }
      });
    }

    if (options.service) {
      const services = Array.isArray(options.service) ? options.service : [options.service];
      query.query.bool.filter.push({
        terms: { 'service.name': services }
      });
    }

    const response = await this.adapter.searchLogs(query);
    
    return (response.hits?.hits || []).map((hit: any) => ({
      timestamp: hit._source['@timestamp'] || hit._source.timestamp,
      level: hit._source.level || hit._source.SeverityText || 'info',
      message: hit._source.message || hit._source.Body || '',
      service: hit._source.service?.name || hit._source.resource?.service?.name,
      traceId: hit._source.traceId || hit._source.trace_id,
      spanId: hit._source.spanId || hit._source.span_id,
      attributes: hit._source.attributes || {}
    }));
  }

  private containsOnlyCommonWords(phrase: string): boolean {
    const commonWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that',
      'it', 'for', 'as', 'with', 'was', 'but', 'be', 'have', 'from',
      'or', 'by', 'not', 'this', 'are', 'can', 'will', 'your', 'all'
    ]);

    const words = phrase.split(' ');
    return words.every(word => commonWords.has(word));
  }

  private generateSummary(
    logs: LogEntry[],
    entities: LogEntity[],
    sentiment: SentimentResult | null,
    keyPhrases: KeyPhrase[]
  ): string {
    const parts = [];

    parts.push(`Analyzed ${logs.length} logs.`);

    if (sentiment) {
      parts.push(
        `Overall sentiment: ${sentiment.sentiment} ` +
        `(${(sentiment.distribution.negative * 100).toFixed(0)}% negative).`
      );
    }

    if (entities.length > 0) {
      const topEntities = entities.slice(0, 3).map(e => e.text);
      parts.push(`Key entities: ${topEntities.join(', ')}.`);
    }

    if (keyPhrases.length > 0) {
      const topPhrases = keyPhrases.slice(0, 3).map(p => p.phrase);
      parts.push(`Common phrases: ${topPhrases.join(', ')}.`);
    }

    return parts.join(' ');
  }
}
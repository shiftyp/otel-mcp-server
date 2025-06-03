import { logger } from '../../../../utils/logger.js';
import { LogsCoreAdapter } from '../core/adapter.js';
import { LogEntry } from '../core/types.js';

/**
 * Frequent pattern
 */
export interface FrequentPattern {
  items: string[];
  support: number;
  confidence: number;
  examples: LogEntry[];
}

/**
 * Association rule
 */
export interface AssociationRule {
  antecedent: string[];
  consequent: string[];
  support: number;
  confidence: number;
  lift: number;
}

/**
 * Pattern mining options
 */
export interface PatternMiningOptions {
  timeRange?: { from: string; to: string };
  service?: string | string[];
  minSupport?: number;
  minConfidence?: number;
  maxItemsetSize?: number;
  attributes?: string[];
}

/**
 * Log pattern miner using frequent pattern mining algorithms
 */
export class LogPatternMiner {
  constructor(private readonly adapter: LogsCoreAdapter) {}

  /**
   * Mine frequent patterns from logs
   */
  public async mineFrequentPatterns(
    options: PatternMiningOptions = {}
  ): Promise<FrequentPattern[]> {
    logger.info('[LogPatternMiner] Mining frequent patterns', { options });

    const logs = await this.fetchLogs(options);
    if (logs.length === 0) {
      return [];
    }

    // Convert logs to transactions
    const transactions = this.logsToTransactions(logs, options.attributes);
    
    // Mine frequent itemsets
    const minSupport = options.minSupport || 0.01;
    const frequentItemsets = this.apriori(
      transactions,
      minSupport,
      options.maxItemsetSize || 5
    );

    // Convert to patterns with examples
    const patterns: FrequentPattern[] = [];
    
    for (const itemset of frequentItemsets) {
      const examples = this.findExamples(logs, itemset.items, 3);
      
      patterns.push({
        items: itemset.items,
        support: itemset.support,
        confidence: 1.0, // All items always appear together
        examples
      });
    }

    return patterns.sort((a, b) => b.support - a.support);
  }

  /**
   * Mine association rules
   */
  public async mineAssociationRules(
    options: PatternMiningOptions = {}
  ): Promise<AssociationRule[]> {
    logger.info('[LogPatternMiner] Mining association rules', { options });

    const logs = await this.fetchLogs(options);
    if (logs.length === 0) {
      return [];
    }

    const transactions = this.logsToTransactions(logs, options.attributes);
    const minSupport = options.minSupport || 0.01;
    const minConfidence = options.minConfidence || 0.5;

    // First, find frequent itemsets
    const frequentItemsets = this.apriori(transactions, minSupport, 5);
    
    // Generate association rules
    const rules: AssociationRule[] = [];
    
    for (const itemset of frequentItemsets) {
      if (itemset.items.length >= 2) {
        const itemsetRules = this.generateRules(
          itemset,
          frequentItemsets,
          transactions,
          minConfidence
        );
        rules.push(...itemsetRules);
      }
    }

    // Sort by lift (interestingness)
    return rules.sort((a, b) => b.lift - a.lift);
  }

  /**
   * Find sequential patterns
   */
  public async mineSequentialPatterns(
    options: PatternMiningOptions = {}
  ): Promise<Array<{
    sequence: string[];
    support: number;
    avgTimeDiff: number;
    examples: Array<{ logs: LogEntry[]; timeDiffs: number[] }>;
  }>> {
    logger.info('[LogPatternMiner] Mining sequential patterns', { options });

    const logs = await this.fetchLogs(options);
    if (logs.length === 0) {
      return [];
    }

    // Group logs by session (using traceId or time windows)
    const sequences = this.groupIntoSequences(logs);
    const minSupport = options.minSupport || 0.01;

    // Mine sequential patterns
    const patterns = this.prefixSpan(sequences, minSupport);

    // Calculate time differences and get examples
    const enrichedPatterns = patterns.map(pattern => {
      const examples = this.findSequenceExamples(sequences, pattern.sequence, 3);
      const timeDiffs = examples.flatMap(ex => ex.timeDiffs);
      const avgTimeDiff = timeDiffs.length > 0 
        ? timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length 
        : 0;

      return {
        sequence: pattern.sequence,
        support: pattern.support,
        avgTimeDiff,
        examples
      };
    });

    return enrichedPatterns.sort((a, b) => b.support - a.support);
  }

  /**
   * Detect anomalous patterns
   */
  public async detectAnomalousPatterns(
    baselineTimeRange: { from: string; to: string },
    currentTimeRange: { from: string; to: string },
    options: Omit<PatternMiningOptions, 'timeRange'> = {}
  ): Promise<Array<{
    pattern: string[];
    anomalyScore: number;
    baselineSupport: number;
    currentSupport: number;
    type: 'new' | 'missing' | 'frequency_change';
  }>> {
    logger.info('[LogPatternMiner] Detecting anomalous patterns');

    // Mine patterns for both periods
    const [baselinePatterns, currentPatterns] = await Promise.all([
      this.mineFrequentPatterns({ ...options, timeRange: baselineTimeRange }),
      this.mineFrequentPatterns({ ...options, timeRange: currentTimeRange })
    ]);

    const anomalies: Array<any> = [];
    
    // Build maps for comparison
    const baselineMap = new Map(
      baselinePatterns.map(p => [p.items.join('|'), p])
    );
    const currentMap = new Map(
      currentPatterns.map(p => [p.items.join('|'), p])
    );

    // Find new patterns
    for (const [key, pattern] of currentMap) {
      if (!baselineMap.has(key)) {
        anomalies.push({
          pattern: pattern.items,
          anomalyScore: pattern.support, // Higher support = more anomalous
          baselineSupport: 0,
          currentSupport: pattern.support,
          type: 'new' as const
        });
      }
    }

    // Find missing and changed patterns
    for (const [key, basePattern] of baselineMap) {
      const currentPattern = currentMap.get(key);
      
      if (!currentPattern) {
        anomalies.push({
          pattern: basePattern.items,
          anomalyScore: basePattern.support,
          baselineSupport: basePattern.support,
          currentSupport: 0,
          type: 'missing' as const
        });
      } else {
        const supportChange = Math.abs(currentPattern.support - basePattern.support);
        if (supportChange > 0.1) { // Significant change
          anomalies.push({
            pattern: basePattern.items,
            anomalyScore: supportChange,
            baselineSupport: basePattern.support,
            currentSupport: currentPattern.support,
            type: 'frequency_change' as const
          });
        }
      }
    }

    return anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
  }

  // Private helper methods

  private async fetchLogs(options: PatternMiningOptions): Promise<LogEntry[]> {
    const query: any = {
      size: 10000,
      query: { bool: { must: [], filter: [] } },
      sort: [{ '@timestamp': { order: 'asc' } }] // Chronological order for sequences
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

  private logsToTransactions(logs: LogEntry[], attributes?: string[]): string[][] {
    return logs.map(log => {
      const items: string[] = [];
      
      // Add level
      items.push(`level:${log.level}`);
      
      // Add service if present
      if (log.service) {
        items.push(`service:${log.service}`);
      }
      
      // Extract keywords from message
      const keywords = this.extractKeywords(log.message);
      items.push(...keywords);
      
      // Add selected attributes
      if (attributes && log.attributes) {
        for (const attr of attributes) {
          if (log.attributes[attr]) {
            items.push(`${attr}:${log.attributes[attr]}`);
          }
        }
      }
      
      return [...new Set(items)]; // Remove duplicates
    });
  }

  private extractKeywords(message: string): string[] {
    const keywords: string[] = [];
    
    // Extract error-related keywords
    if (/error|exception|fail|crash/i.test(message)) {
      keywords.push('keyword:error');
    }
    
    // Extract operation keywords
    const operations = message.match(/\b(start|stop|create|delete|update|read|write)\b/gi);
    if (operations) {
      operations.forEach(op => keywords.push(`op:${op.toLowerCase()}`));
    }
    
    // Extract HTTP status codes
    const statusCodes = message.match(/\b[1-5]\d{2}\b/g);
    if (statusCodes) {
      statusCodes.forEach(code => keywords.push(`status:${code}`));
    }
    
    return keywords;
  }

  private apriori(
    transactions: string[][],
    minSupport: number,
    maxSize: number
  ): Array<{ items: string[]; support: number }> {
    const frequentItemsets: Array<{ items: string[]; support: number }> = [];
    const totalTransactions = transactions.length;
    
    // Find frequent 1-itemsets
    const itemCounts = new Map<string, number>();
    for (const transaction of transactions) {
      for (const item of transaction) {
        itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
      }
    }
    
    const frequentItems: string[] = [];
    for (const [item, count] of itemCounts) {
      const support = count / totalTransactions;
      if (support >= minSupport) {
        frequentItems.push(item);
        frequentItemsets.push({ items: [item], support });
      }
    }
    
    // Generate larger itemsets
    let currentItemsets = frequentItems.map(item => [item]);
    
    for (let k = 2; k <= maxSize && currentItemsets.length > 0; k++) {
      const candidates = this.generateCandidates(currentItemsets);
      const newFrequentItemsets: string[][] = [];
      
      for (const candidate of candidates) {
        const count = transactions.filter(t => 
          candidate.every(item => t.includes(item))
        ).length;
        
        const support = count / totalTransactions;
        if (support >= minSupport) {
          newFrequentItemsets.push(candidate);
          frequentItemsets.push({ items: candidate, support });
        }
      }
      
      currentItemsets = newFrequentItemsets;
    }
    
    return frequentItemsets;
  }

  private generateCandidates(itemsets: string[][]): string[][] {
    const candidates: string[][] = [];
    
    for (let i = 0; i < itemsets.length; i++) {
      for (let j = i + 1; j < itemsets.length; j++) {
        const set1 = itemsets[i];
        const set2 = itemsets[j];
        
        // Check if they share k-1 items
        const shared = set1.slice(0, -1).every((item, idx) => item === set2[idx]);
        
        if (shared) {
          const candidate = [...set1, set2[set2.length - 1]].sort();
          
          // Check if not already added
          const exists = candidates.some(c => 
            c.length === candidate.length && 
            c.every((item, idx) => item === candidate[idx])
          );
          
          if (!exists) {
            candidates.push(candidate);
          }
        }
      }
    }
    
    return candidates;
  }

  private generateRules(
    itemset: { items: string[]; support: number },
    allItemsets: Array<{ items: string[]; support: number }>,
    transactions: string[][],
    minConfidence: number
  ): AssociationRule[] {
    const rules: AssociationRule[] = [];
    const itemsetSupport = itemset.support;
    
    // Generate all non-empty subsets
    const subsets = this.generateSubsets(itemset.items);
    
    for (const subset of subsets) {
      if (subset.length > 0 && subset.length < itemset.items.length) {
        const antecedent = subset;
        const consequent = itemset.items.filter(item => !subset.includes(item));
        
        // Find support of antecedent
        const antecedentItemset = allItemsets.find(i => 
          i.items.length === antecedent.length &&
          i.items.every(item => antecedent.includes(item))
        );
        
        if (antecedentItemset) {
          const confidence = itemsetSupport / antecedentItemset.support;
          
          if (confidence >= minConfidence) {
            // Calculate lift
            const consequentItemset = allItemsets.find(i => 
              i.items.length === consequent.length &&
              i.items.every(item => consequent.includes(item))
            );
            
            const lift = consequentItemset 
              ? confidence / consequentItemset.support 
              : confidence;
            
            rules.push({
              antecedent,
              consequent,
              support: itemsetSupport,
              confidence,
              lift
            });
          }
        }
      }
    }
    
    return rules;
  }

  private generateSubsets(items: string[]): string[][] {
    const subsets: string[][] = [];
    const n = items.length;
    
    for (let i = 1; i < Math.pow(2, n) - 1; i++) {
      const subset: string[] = [];
      for (let j = 0; j < n; j++) {
        if ((i >> j) & 1) {
          subset.push(items[j]);
        }
      }
      subsets.push(subset);
    }
    
    return subsets;
  }

  private groupIntoSequences(logs: LogEntry[]): Array<{
    id: string;
    events: Array<{ item: string; timestamp: number }>;
  }> {
    const sequences = new Map<string, Array<{ item: string; timestamp: number }>>();
    
    for (const log of logs) {
      // Use traceId as sequence ID, or create time-based windows
      const sequenceId = log.traceId || this.getTimeWindow(log.timestamp, 300000); // 5 min windows
      
      if (!sequences.has(sequenceId)) {
        sequences.set(sequenceId, []);
      }
      
      // Create item from log
      const item = `${log.level}:${this.extractKeywords(log.message).join(',')}`;
      const timestamp = new Date(log.timestamp).getTime();
      
      sequences.get(sequenceId)!.push({ item, timestamp });
    }
    
    // Convert to array and sort events
    return Array.from(sequences.entries()).map(([id, events]) => ({
      id,
      events: events.sort((a, b) => a.timestamp - b.timestamp)
    }));
  }

  private getTimeWindow(timestamp: string, windowSize: number): string {
    const time = new Date(timestamp).getTime();
    const window = Math.floor(time / windowSize) * windowSize;
    return new Date(window).toISOString();
  }

  private prefixSpan(
    sequences: Array<{ id: string; events: Array<{ item: string; timestamp: number }> }>,
    minSupport: number
  ): Array<{ sequence: string[]; support: number }> {
    // Simplified PrefixSpan implementation
    const patterns: Array<{ sequence: string[]; support: number }> = [];
    const totalSequences = sequences.length;
    
    // Find frequent 1-sequences
    const itemCounts = new Map<string, number>();
    for (const seq of sequences) {
      const seenItems = new Set<string>();
      for (const event of seq.events) {
        seenItems.add(event.item);
      }
      for (const item of seenItems) {
        itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
      }
    }
    
    // Get frequent items
    const frequentItems: string[] = [];
    for (const [item, count] of itemCounts) {
      const support = count / totalSequences;
      if (support >= minSupport) {
        frequentItems.push(item);
        patterns.push({ sequence: [item], support });
      }
    }
    
    // Find frequent 2-sequences (simplified)
    for (const item1 of frequentItems) {
      for (const item2 of frequentItems) {
        let count = 0;
        
        for (const seq of sequences) {
          let foundFirst = false;
          let foundSecond = false;
          
          for (const event of seq.events) {
            if (!foundFirst && event.item === item1) {
              foundFirst = true;
            } else if (foundFirst && !foundSecond && event.item === item2) {
              foundSecond = true;
              break;
            }
          }
          
          if (foundFirst && foundSecond) {
            count++;
          }
        }
        
        const support = count / totalSequences;
        if (support >= minSupport) {
          patterns.push({ sequence: [item1, item2], support });
        }
      }
    }
    
    return patterns;
  }

  private findExamples(logs: LogEntry[], items: string[], limit: number): LogEntry[] {
    const examples: LogEntry[] = [];
    
    for (const log of logs) {
      const transaction = this.logsToTransactions([log])[0];
      
      if (items.every(item => transaction.includes(item))) {
        examples.push(log);
        if (examples.length >= limit) {
          break;
        }
      }
    }
    
    return examples;
  }

  private findSequenceExamples(
    sequences: Array<{ id: string; events: Array<{ item: string; timestamp: number }> }>,
    pattern: string[],
    limit: number
  ): Array<{ logs: LogEntry[]; timeDiffs: number[] }> {
    const examples: Array<{ logs: LogEntry[]; timeDiffs: number[] }> = [];
    
    for (const seq of sequences) {
      let patternIndex = 0;
      const matchedEvents: Array<{ item: string; timestamp: number }> = [];
      
      for (const event of seq.events) {
        if (patternIndex < pattern.length && event.item === pattern[patternIndex]) {
          matchedEvents.push(event);
          patternIndex++;
        }
      }
      
      if (patternIndex === pattern.length) {
        const timeDiffs: number[] = [];
        for (let i = 1; i < matchedEvents.length; i++) {
          timeDiffs.push(matchedEvents[i].timestamp - matchedEvents[i - 1].timestamp);
        }
        
        // For this example, we don't have the original logs
        // In a real implementation, we'd store log references
        examples.push({
          logs: [],
          timeDiffs
        });
        
        if (examples.length >= limit) {
          break;
        }
      }
    }
    
    return examples;
  }
}
import { logger } from '../../../utils/logger.js';

/**
 * Options for improved sampling
 */
export interface ImprovedSamplingOptions {
  /** Enable sampling to reduce the number of items */
  enableSampling?: boolean;
  /** Percentage of data to sample (1-100) */
  samplingPercent?: number;
  /** Maximum number of samples to process */
  maxSamples?: number;
  /** Enable pagination for large datasets */
  enablePagination?: boolean;
  /** Page size for pagination */
  pageSize?: number;
  /** Current page number (0-based) */
  page?: number;
}

/**
 * Result of paginated sampling
 */
export interface PaginatedSamplingResult<T> {
  /** Sampled items for the current page */
  items: T[];
  /** Total number of items across all pages */
  totalItems: number;
  /** Total number of pages */
  totalPages: number;
  /** Current page number (0-based) */
  currentPage: number;
  /** Whether there are more pages */
  hasNextPage: boolean;
  /** Whether sampling was applied */
  samplingApplied: boolean;
}

/**
 * Apply improved sampling to a collection of items
 * This uses stratified sampling to ensure a diverse set of items
 * @param items Items to sample
 * @param options Sampling options
 * @param contextPrefix Prefix for logging context
 * @returns Sampled items or paginated sampling result
 */
export function applyImprovedSampling<T>(
  items: T[],
  options: ImprovedSamplingOptions,
  contextPrefix: string
): T[] | PaginatedSamplingResult<T> {
  // Check if we need to handle pagination
  const enablePagination = options.enablePagination || false;
  const pageSize = options.pageSize || 50;
  const currentPage = options.page || 0;
  
  // If sampling is not enabled or we have too few items, return all items or paginated result
  if (!options.enableSampling || items.length <= 3) {
    if (enablePagination) {
      const totalPages = Math.ceil(items.length / pageSize);
      const startIdx = currentPage * pageSize;
      const endIdx = Math.min(startIdx + pageSize, items.length);
      const pageItems = items.slice(startIdx, endIdx);
      
      return {
        items: pageItems,
        totalItems: items.length,
        totalPages,
        currentPage,
        hasNextPage: currentPage < totalPages - 1,
        samplingApplied: false
      };
    }
    return items;
  }
  
  const samplingPercent = options.samplingPercent || 20; // Increased default to 20%
  const maxSamples = options.maxSamples || 200; // Increased default to 200 samples max
  
  // Calculate how many items to sample
  const sampleCount = Math.min(
    Math.ceil(items.length * (samplingPercent / 100)),
    maxSamples
  );
  
  // If we're sampling all items, return them all or paginated result
  if (sampleCount >= items.length) {
    if (enablePagination) {
      const totalPages = Math.ceil(items.length / pageSize);
      const startIdx = currentPage * pageSize;
      const endIdx = Math.min(startIdx + pageSize, items.length);
      const pageItems = items.slice(startIdx, endIdx);
      
      return {
        items: pageItems,
        totalItems: items.length,
        totalPages,
        currentPage,
        hasNextPage: currentPage < totalPages - 1,
        samplingApplied: false
      };
    }
    return items;
  }
  
  logger.info(`${contextPrefix} Sampling ${sampleCount} items from ${items.length} total items using improved strategy`);
  
  // Use stratified sampling to ensure we get a diverse set of items
  // First, try to group items by type or content if possible
  const itemGroups: Record<string, T[]> = {};
  
  // Group items by their type or content characteristics
  items.forEach(item => {
    let groupKey = 'default';
    
    // Try to extract a meaningful group key
    try {
      if (typeof item === 'object' && item !== null) {
        // For objects, use a property that might indicate type
        if ('type' in item) {
          groupKey = String((item as any).type);
        } else if ('level' in item) {
          groupKey = String((item as any).level);
        } else if ('severity' in item) {
          groupKey = String((item as any).severity);
        } else if ('service' in item) {
          groupKey = String((item as any).service);
        }
      } else if (typeof item === 'string') {
        // For strings, use the first word or character type
        const firstWord = item.trim().split(/\s+/)[0];
        groupKey = firstWord || 'string';
      }
    } catch (e) {
      // If grouping fails, use default
      groupKey = 'default';
    }
    
    // Initialize group if it doesn't exist
    if (!itemGroups[groupKey]) {
      itemGroups[groupKey] = [];
    }
    
    // Add item to its group
    itemGroups[groupKey].push(item);
  });
  
  // Calculate how many items to take from each group
  const groups = Object.keys(itemGroups);
  const sampledItems: T[] = [];
  
  if (groups.length > 1) {
    // If we have multiple groups, sample from each proportionally
    const totalItems = items.length;
    
    groups.forEach(groupKey => {
      const groupItems = itemGroups[groupKey];
      const groupProportion = groupItems.length / totalItems;
      let groupSampleCount = Math.ceil(sampleCount * groupProportion);
      
      // Ensure at least one item from each group if possible
      groupSampleCount = Math.max(1, groupSampleCount);
      groupSampleCount = Math.min(groupItems.length, groupSampleCount);
      
      // Randomly sample from this group
      const shuffled = [...groupItems].sort(() => 0.5 - Math.random());
      sampledItems.push(...shuffled.slice(0, groupSampleCount));
    });
    
    // If we have too many items, trim randomly
    if (sampledItems.length > sampleCount) {
      sampledItems.sort(() => 0.5 - Math.random());
      sampledItems.length = sampleCount;
    }
    
    // If we have too few items, add more randomly
    if (sampledItems.length < sampleCount && items.length > sampledItems.length) {
      const remaining = items.filter(item => !sampledItems.includes(item));
      const shuffled = [...remaining].sort(() => 0.5 - Math.random());
      sampledItems.push(...shuffled.slice(0, sampleCount - sampledItems.length));
    }
  } else {
    // If we only have one group, use simple random sampling
    const shuffled = [...items].sort(() => 0.5 - Math.random());
    sampledItems.push(...shuffled.slice(0, sampleCount));
  }
  
  // If pagination is enabled, return a paginated result
  if (enablePagination) {
    const totalPages = Math.ceil(sampledItems.length / pageSize);
    const startIdx = currentPage * pageSize;
    const endIdx = Math.min(startIdx + pageSize, sampledItems.length);
    const pageItems = sampledItems.slice(startIdx, endIdx);
    
    return {
      items: pageItems,
      totalItems: sampledItems.length,
      totalPages,
      currentPage,
      hasNextPage: currentPage < totalPages - 1,
      samplingApplied: true
    };
  }
  
  return sampledItems;
}

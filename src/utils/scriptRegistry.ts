import { logger } from './logger.js';

/**
 * Script metadata interface
 */
export interface ScriptMetadata {
  name: string;
  description: string;
  version: string;
  domain: 'logs' | 'traces' | 'metrics' | 'common';
  parameters?: string[];
}

/**
 * Script registry entry
 */
export interface ScriptRegistryEntry {
  source: string;
  metadata: ScriptMetadata;
}

/**
 * Central registry for Elasticsearch Painless scripts
 */
export class ScriptRegistry {
  private static instance: ScriptRegistry;
  private scripts: Map<string, ScriptRegistryEntry> = new Map();
  
  /**
   * Get the singleton instance of the script registry
   */
  public static getInstance(): ScriptRegistry {
    if (!ScriptRegistry.instance) {
      ScriptRegistry.instance = new ScriptRegistry();
    }
    return ScriptRegistry.instance;
  }
  
  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {}
  
  /**
   * Register a script with the registry
   * @param key Unique key for the script
   * @param source Script source code
   * @param metadata Script metadata
   */
  public registerScript(key: string, source: string, metadata: ScriptMetadata): void {
    if (this.scripts.has(key)) {
      logger.warn(`Overwriting existing script with key: ${key}`);
    }
    
    this.scripts.set(key, { source, metadata });
    logger.debug(`Registered script: ${key} (${metadata.domain}/${metadata.name} v${metadata.version})`);
  }
  
  /**
   * Get a script by its key
   * @param key Script key
   * @returns Script entry or undefined if not found
   */
  public getScript(key: string): ScriptRegistryEntry | undefined {
    return this.scripts.get(key);
  }
  
  /**
   * Get script source by key
   * @param key Script key
   * @returns Script source or undefined if not found
   */
  public getScriptSource(key: string): string | undefined {
    const entry = this.scripts.get(key);
    return entry?.source;
  }
  
  /**
   * Check if a script exists
   * @param key Script key
   * @returns True if the script exists
   */
  public hasScript(key: string): boolean {
    return this.scripts.has(key);
  }
  
  /**
   * Get all scripts in the registry
   * @returns Map of all scripts
   */
  public getAllScripts(): Map<string, ScriptRegistryEntry> {
    return new Map(this.scripts);
  }
  
  /**
   * Get scripts by domain
   * @param domain Script domain
   * @returns Array of script entries for the domain
   */
  public getScriptsByDomain(domain: string): ScriptRegistryEntry[] {
    const result: ScriptRegistryEntry[] = [];
    
    this.scripts.forEach((entry) => {
      if (entry.metadata.domain === domain) {
        result.push(entry);
      }
    });
    
    return result;
  }
  
  /**
   * Clear all scripts from the registry
   */
  public clearScripts(): void {
    this.scripts.clear();
    logger.debug('Cleared all scripts from registry');
  }
}

/**
 * Convenience function to get the script registry instance
 * @returns Script registry instance
 */
export function getScriptRegistry(): ScriptRegistry {
  return ScriptRegistry.getInstance();
}

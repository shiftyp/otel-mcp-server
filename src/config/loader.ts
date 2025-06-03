import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Config, ConfigOverrides } from './types.js';
import { defaultConfig } from './defaults.js';
import { validateConfig, validateOverrides, ValidationErrors } from './validators.js';
import { logger } from '../utils/logger.js';

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] !== undefined) {
      if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {} as any, source[key] as any) as T[Extract<keyof T, string>];
      } else {
        result[key] = source[key] as T[Extract<keyof T, string>];
      }
    }
  }
  
  return result;
}

/**
 * Load configuration from environment variables
 */
function loadFromEnv(): ConfigOverrides {
  const overrides: ConfigOverrides = {};
  
  // Backend type
  if (process.env.BACKEND_TYPE) {
    overrides.backend = process.env.BACKEND_TYPE as 'opensearch' | 'auto';
  }
  
  // Connection settings
  if (process.env.ELASTICSEARCH_URL || process.env.OPENSEARCH_URL) {
    overrides.connection = {
      baseURL: process.env.ELASTICSEARCH_URL || process.env.OPENSEARCH_URL
    };
  }
  
  if (process.env.API_KEY) {
    overrides.connection = { ...overrides.connection, apiKey: process.env.API_KEY };
  }
  
  if (process.env.USERNAME && process.env.PASSWORD) {
    overrides.connection = {
      ...overrides.connection,
      username: process.env.USERNAME,
      password: process.env.PASSWORD
    };
  }
  
  // Feature flags
  if (process.env.ENABLE_ML_TOOLS !== undefined) {
    overrides.features = {
      ...overrides.features,
      enableMLTools: process.env.ENABLE_ML_TOOLS === 'true'
    };
  }
  
  // ML embedding settings
  if (process.env.OPENAI_API_KEY) {
    overrides.ml = {
      ...overrides.ml,
      embedding: {
        ...overrides.ml?.embedding,
        apiKey: process.env.OPENAI_API_KEY
      }
    };
  }
  
  // Telemetry indices
  if (process.env.TRACES_INDEX) {
    overrides.telemetry = {
      ...overrides.telemetry,
      indices: {
        ...overrides.telemetry?.indices,
        traces: process.env.TRACES_INDEX
      }
    };
  }
  
  if (process.env.METRICS_INDEX) {
    overrides.telemetry = {
      ...overrides.telemetry,
      indices: {
        ...overrides.telemetry?.indices,
        metrics: process.env.METRICS_INDEX
      }
    };
  }
  
  if (process.env.LOGS_INDEX) {
    overrides.telemetry = {
      ...overrides.telemetry,
      indices: {
        ...overrides.telemetry?.indices,
        logs: process.env.LOGS_INDEX
      }
    };
  }
  
  return overrides;
}

/**
 * Load configuration from a JSON file
 */
function loadFromFile(filePath: string): ConfigOverrides {
  try {
    if (!existsSync(filePath)) {
      return {};
    }
    
    const content = readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content);
    
    logger.info('Loaded configuration from file', { filePath });
    return config;
  } catch (error) {
    logger.error('Failed to load configuration file', { filePath, error });
    return {};
  }
}

/**
 * Configuration loader class
 */
export class ConfigLoader {
  private static instance: Config | null = null;
  private static configPaths = [
    'otel-mcp-server.config.json',
    '.otel-mcp-server.json',
    join(process.cwd(), 'config.json'),
    join(process.env.HOME || '', '.otel-mcp-server', 'config.json')
  ];
  
  /**
   * Load configuration from all sources
   */
  static load(overrides?: ConfigOverrides): Config {
    // Start with defaults
    let config = { ...defaultConfig };
    
    // Load from files (in order of precedence)
    for (const path of this.configPaths) {
      const fileConfig = loadFromFile(path);
      if (Object.keys(fileConfig).length > 0) {
        config = deepMerge(config, fileConfig as any);
      }
    }
    
    // Load from environment variables
    const envConfig = loadFromEnv();
    config = deepMerge(config, envConfig as any);
    
    // Apply runtime overrides
    if (overrides) {
      const overrideErrors = validateOverrides(overrides);
      if (overrideErrors.hasErrors()) {
        throw new Error(`Invalid configuration overrides: ${overrideErrors.toString()}`);
      }
      config = deepMerge(config, overrides as any);
    }
    
    // Validate final configuration
    const errors = validateConfig(config);
    if (errors.hasErrors()) {
      throw new Error(`Invalid configuration: ${errors.toString()}`);
    }
    
    logger.info('Configuration loaded successfully', {
      backend: config.backend,
      featuresEnabled: Object.entries(config.features)
        .filter(([_, enabled]) => enabled)
        .map(([feature]) => feature)
    });
    
    this.instance = config;
    return config;
  }
  
  /**
   * Get the current configuration instance
   */
  static get(): Config {
    if (!this.instance) {
      this.instance = this.load();
    }
    return this.instance;
  }
  
  /**
   * Reload configuration
   */
  static reload(overrides?: ConfigOverrides): Config {
    this.instance = null;
    return this.load(overrides);
  }
  
  /**
   * Set a configuration value at runtime
   */
  static set(path: string, value: any): void {
    if (!this.instance) {
      this.instance = this.load();
    }
    
    const parts = path.split('.');
    let current: any = this.instance;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
    
    // Re-validate
    const errors = validateConfig(this.instance);
    if (errors.hasErrors()) {
      throw new Error(`Invalid configuration after update: ${errors.toString()}`);
    }
  }
  
  /**
   * Get a configuration value by path
   */
  static getValue(path: string): any {
    if (!this.instance) {
      this.instance = this.load();
    }
    
    const parts = path.split('.');
    let current: any = this.instance;
    
    for (const part of parts) {
      if (current[part] === undefined) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }
}
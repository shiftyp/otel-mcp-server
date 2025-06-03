import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import { getScriptRegistry, ScriptMetadata } from './scriptRegistry.js';

/**
 * Script file information
 */
interface ScriptFile {
  key: string;
  filePath: string;
  domain: 'logs' | 'traces' | 'metrics' | 'common';
}

/**
 * Loads a script from a file and registers it with the script registry
 * @param filePath Path to the script file
 * @param key Script key for registry
 * @param metadata Script metadata
 * @returns True if the script was loaded successfully
 */
export function loadScriptFromFile(
  filePath: string,
  key: string,
  metadata: ScriptMetadata
): boolean {
  try {
    const source = fs.readFileSync(filePath, 'utf8');
    getScriptRegistry().registerScript(key, source, metadata);
    return true;
  } catch (error) {
    logger.error(`Failed to load script from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Scans a directory for script files and loads them into the registry
 * @param baseDir Base directory to scan
 * @param domain Script domain (logs, traces, metrics, common)
 * @param fileExtension File extension to look for
 * @returns Number of scripts loaded
 */
export function loadScriptsFromDirectory(
  baseDir: string,
  domain: 'logs' | 'traces' | 'metrics' | 'common',
  fileExtension: string = '.painless'
): number {
  try {
    if (!fs.existsSync(baseDir)) {
      logger.warn(`Script directory does not exist: ${baseDir}`);
      return 0;
    }

    const files = fs.readdirSync(baseDir);
    let loadedCount = 0;

    for (const file of files) {
      const filePath = path.join(baseDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // Recursively load scripts from subdirectories
        loadedCount += loadScriptsFromDirectory(filePath, domain, fileExtension);
      } else if (file.endsWith(fileExtension)) {
        const scriptName = path.basename(file, fileExtension);
        const key = `${domain}.${scriptName}`;
        
        // Extract version from filename if it follows the pattern name_v1.0.painless
        let version = '1.0';
        const versionMatch = scriptName.match(/_v(\d+\.\d+)$/);
        if (versionMatch) {
          version = versionMatch[1];
        }
        
        const metadata: ScriptMetadata = {
          name: scriptName,
          description: `${domain} script: ${scriptName}`,
          version,
          domain,
          parameters: []
        };
        
        if (loadScriptFromFile(filePath, key, metadata)) {
          loadedCount++;
        }
      }
    }

    logger.info(`Loaded ${loadedCount} ${domain} scripts from ${baseDir}`);
    return loadedCount;
  } catch (error) {
    logger.error(`Error loading scripts from ${baseDir}: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/**
 * Loads all scripts from the standard script directories
 * @param basePath Base path to the scripts directory
 * @returns Total number of scripts loaded
 */
export function loadAllScripts(basePath: string): number {
  const domains: Array<'logs' | 'traces' | 'metrics' | 'common'> = ['logs', 'traces', 'metrics', 'common'];
  let totalLoaded = 0;
  
  for (const domain of domains) {
    const domainPath = path.join(basePath, domain);
    totalLoaded += loadScriptsFromDirectory(domainPath, domain);
  }
  
  logger.info(`Loaded ${totalLoaded} scripts in total`);
  return totalLoaded;
}

/**
 * Converts a script from an inline string to a file
 * @param scriptSource Script source code
 * @param outputPath Output file path
 * @param metadata Script metadata
 * @returns True if the script was saved successfully
 */
export function saveScriptToFile(
  scriptSource: string,
  outputPath: string,
  metadata: ScriptMetadata
): boolean {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Add metadata as comments at the top of the file
    const metadataComment = [
      '/*',
      ` * Script: ${metadata.name}`,
      ` * Version: ${metadata.version}`,
      ` * Domain: ${metadata.domain}`,
      ` * Description: ${metadata.description}`,
      metadata.parameters && metadata.parameters.length > 0 
        ? ` * Parameters: ${metadata.parameters.join(', ')}` 
        : ' * Parameters: none',
      ' */',
      ''
    ].join('\n');
    
    const content = metadataComment + scriptSource;
    
    fs.writeFileSync(outputPath, content, 'utf8');
    logger.info(`Saved script to ${outputPath}`);
    return true;
  } catch (error) {
    logger.error(`Failed to save script to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

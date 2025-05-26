/**
 * Utility functions for escaping special characters in Mermaid diagrams
 */

/**
 * Escapes a string for safe use in Mermaid diagrams
 * Handles special characters, emojis, and other non-ASCII characters
 * 
 * @param input The string to escape
 * @param isAxisLabel Whether this is an axis label (requires more strict escaping)
 * @returns The escaped string safe for use in Mermaid
 */
export function escapeMermaidString(input: string | null | undefined, isAxisLabel: boolean = false): string {
  if (input === null || input === undefined || input === '') return '';
  
  // Ensure input is a string
  let escaped = String(input);
  
  // Replace newlines and carriage returns
  escaped = escaped.replace(/\r/g, '').replace(/\n/g, ' ');
  
  // Always escape these characters that cause issues in Mermaid
  escaped = escaped
    .replace(/:/g, '#58;')   // colon
    .replace(/</g, '#60;')   // less than
    .replace(/>/g, '#62;')   // greater than
    .replace(/\|/g, '#124;'); // pipe
    
  // For axis labels and other sensitive contexts, do more aggressive escaping
  if (isAxisLabel) {
    escaped = escaped
      .replace(/\//g, '#47;')     // forward slash
      .replace(/\\/g, '#92;')     // backslash
      .replace(/\(/g, '#40;')     // opening parenthesis
      .replace(/\)/g, '#41;')     // closing parenthesis
      .replace(/\[/g, '#91;')     // opening bracket
      .replace(/\]/g, '#93;')     // closing bracket
      .replace(/\{/g, '#123;')    // opening brace
      .replace(/\}/g, '#125;')    // closing brace
      .replace(/&/g, '#38;')      // ampersand
      .replace(/"/g, '#34;')      // double quote
      .replace(/'/g, '#39;')      // single quote
      .replace(/`/g, '#96;')      // backtick
      .replace(/;/g, '#59;')      // semicolon
      .replace(/=/g, '#61;')      // equals
      .replace(/\+/g, '#43;')     // plus
      .replace(/,/g, '#44;');      // comma
  }
  
  // Replace all emojis and other non-ASCII characters with their Unicode code points
  escaped = escaped.replace(/[^\x00-\x7F]/g, (match: string) => {
    const codePoint = match.codePointAt(0);
    return codePoint ? `#${codePoint};` : '';
  });
  
  return escaped;
}

/**
 * Escapes an array of strings for use as axis labels in Mermaid charts
 * 
 * @param labels Array of label strings
 * @returns Escaped labels joined in Mermaid format
 */
export function escapeMermaidAxisLabels(labels: string[]): string {
  return labels.map(label => escapeMermaidString(label, true)).join(',');
}

/**
 * Truncates and escapes a string for Mermaid diagrams
 * 
 * @param input The string to process
 * @param maxLength Maximum length before truncation
 * @param isAxisLabel Whether this is an axis label
 * @returns The processed string
 */
export function truncateAndEscapeMermaid(input: string, maxLength: number = 100, isAxisLabel: boolean = false): string {
  if (!input) return '';
  
  // Truncate if necessary
  const truncated = input.length > maxLength 
    ? input.substring(0, maxLength - 3) + '...' 
    : input;
    
  // Escape the truncated string
  return escapeMermaidString(truncated, isAxisLabel);
}

import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private logFile: string;
  private logStream: fs.WriteStream;
  private debugLogStream: fs.WriteStream;
  private level: LogLevel;
  private enableConsole: boolean;

  constructor(logFile: string, level: LogLevel = LogLevel.INFO, enableConsole: boolean = false) {
    this.logFile = logFile;
    this.level = level;
    this.enableConsole = enableConsole;
    
    // Ensure the directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Create or open the log file for appending
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Create a separate debug log file
    const debugLogFile = logFile.replace('.log', '-debug.log');
    this.debugLogStream = fs.createWriteStream(debugLogFile, { flags: 'a' });
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public enableConsoleOutput(enable: boolean): void {
    this.enableConsole = enable;
  }

  public debug(message: string, data?: unknown): void {
    if (this.level <= LogLevel.DEBUG) {
      this.writeLog('DEBUG', message, data, this.debugLogStream);
    }
  }

  public info(message: string, data?: unknown): void {
    if (this.level <= LogLevel.INFO) {
      this.writeLog('INFO', message, data);
    }
  }

  public warn(message: string, data?: unknown): void {
    if (this.level <= LogLevel.WARN) {
      this.writeLog('WARN', message, data);
    }
  }

  public error(message: string, data?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      this.writeLog('ERROR', message, data);
    }
  }

  public log(message: string, data?: unknown): void {
    this.info(message, data);
  }

  private writeLog(level: string, message: string, data?: unknown, stream?: fs.WriteStream): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };
    
    const logString = JSON.stringify(logEntry) + '\n';
    
    // Write to the appropriate stream
    (stream || this.logStream).write(logString);
    
    // Also write to debug log for all levels
    if (!stream) {
      this.debugLogStream.write(logString);
    }
    
    // Optionally write to console
    if (this.enableConsole) {
      const consoleData = data ? ` ${JSON.stringify(data)}` : '';
      console.log(`[${timestamp}] [${level}] ${message}${consoleData}`);
    }
  }

  public close(): void {
    this.logStream.end();
    this.debugLogStream.end();
  }
}

// Logging configuration via environment variables
// LOGLEVEL: OFF | ERROR | WARN | INFO | DEBUG (default: OFF)
// LOGFILE: path to log file (default: logs/mcp-requests.log)

const LOGLEVEL = process.env.LOGLEVEL?.toUpperCase() || 'OFF';
const LOGFILE = process.env.LOGFILE || path.resolve(process.cwd(), 'logs', 'mcp-requests.log');

let logger: Logger;

function logLevelFromString(level: string): LogLevel | number {
  switch (level) {
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    case 'OFF': default: return -1;
  }
}

const level = logLevelFromString(LOGLEVEL);
if (level === -1) {
  // Logging disabled
  logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    close: () => {},
    setLevel: () => {},
    enableConsoleOutput: () => {},
  } as unknown as Logger;
} else {
  logger = new Logger(LOGFILE, level, true);
}

export { logger };

// Handle process exit to ensure logs are flushed
process.on('exit', () => {
  logger.close();
});

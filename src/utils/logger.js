"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.Logger = exports.LogLevel = void 0;
var fs = require("fs");
var path = require("path");
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
var Logger = /** @class */ (function () {
    function Logger(logFile, level, enableConsole) {
        if (level === void 0) { level = LogLevel.INFO; }
        if (enableConsole === void 0) { enableConsole = false; }
        this.logFile = logFile;
        this.level = level;
        this.enableConsole = enableConsole;
        // Ensure the directory exists
        var logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        // Create or open the log file for appending
        this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
        // Create a separate debug log file
        var debugLogFile = logFile.replace('.log', '-debug.log');
        this.debugLogStream = fs.createWriteStream(debugLogFile, { flags: 'a' });
    }
    Logger.prototype.setLevel = function (level) {
        this.level = level;
    };
    Logger.prototype.enableConsoleOutput = function (enable) {
        this.enableConsole = enable;
    };
    Logger.prototype.debug = function (message, data) {
        if (this.level <= LogLevel.DEBUG) {
            this.writeLog('DEBUG', message, data, this.debugLogStream);
        }
    };
    Logger.prototype.info = function (message, data) {
        if (this.level <= LogLevel.INFO) {
            this.writeLog('INFO', message, data);
        }
    };
    Logger.prototype.warn = function (message, data) {
        if (this.level <= LogLevel.WARN) {
            this.writeLog('WARN', message, data);
        }
    };
    Logger.prototype.error = function (message, data) {
        if (this.level <= LogLevel.ERROR) {
            this.writeLog('ERROR', message, data);
        }
    };
    Logger.prototype.log = function (message, data) {
        this.info(message, data);
    };
    Logger.prototype.writeLog = function (level, message, data, stream) {
        var timestamp = new Date().toISOString();
        var logEntry = {
            timestamp: timestamp,
            level: level,
            message: message,
            data: data
        };
        var logString = JSON.stringify(logEntry) + '\n';
        // Write to the appropriate stream
        (stream || this.logStream).write(logString);
        // Also write to debug log for all levels
        if (!stream) {
            this.debugLogStream.write(logString);
        }
        // Optionally write to console
        if (this.enableConsole) {
            var consoleData = data ? " ".concat(JSON.stringify(data)) : '';
            console.log("[".concat(timestamp, "] [").concat(level, "] ").concat(message).concat(consoleData));
        }
    };
    Logger.prototype.close = function () {
        this.logStream.end();
        this.debugLogStream.end();
    };
    return Logger;
}());
exports.Logger = Logger;
// Logging configuration via environment variables
// LOGLEVEL: OFF | ERROR | WARN | INFO | DEBUG (default: OFF)
// LOGFILE: path to log file (default: logs/mcp-requests.log)
var LOGLEVEL = ((_a = process.env.LOGLEVEL) === null || _a === void 0 ? void 0 : _a.toUpperCase()) || 'OFF';
var LOGFILE = process.env.LOGFILE || path.resolve(process.cwd(), 'logs', 'mcp-requests.log');
var logger;
function logLevelFromString(level) {
    switch (level) {
        case 'DEBUG': return LogLevel.DEBUG;
        case 'INFO': return LogLevel.INFO;
        case 'WARN': return LogLevel.WARN;
        case 'ERROR': return LogLevel.ERROR;
        case 'OFF':
        default: return -1;
    }
}
var level = logLevelFromString(LOGLEVEL);
if (level === -1) {
    // Logging disabled
    exports.logger = logger = {
        debug: function () { },
        info: function () { },
        warn: function () { },
        error: function () { },
        log: function () { },
        close: function () { },
        setLevel: function () { },
        enableConsoleOutput: function () { },
    };
}
else {
    exports.logger = logger = new Logger(LOGFILE, level, true);
}
// Handle process exit to ensure logs are flushed
process.on('exit', function () {
    logger.close();
});

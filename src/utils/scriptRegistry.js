"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScriptRegistry = void 0;
exports.getScriptRegistry = getScriptRegistry;
var logger_js_1 = require("./logger.js");
/**
 * Central registry for Elasticsearch Painless scripts
 */
var ScriptRegistry = /** @class */ (function () {
    /**
     * Private constructor to enforce singleton pattern
     */
    function ScriptRegistry() {
        this.scripts = new Map();
    }
    /**
     * Get the singleton instance of the script registry
     */
    ScriptRegistry.getInstance = function () {
        if (!ScriptRegistry.instance) {
            ScriptRegistry.instance = new ScriptRegistry();
        }
        return ScriptRegistry.instance;
    };
    /**
     * Register a script with the registry
     * @param key Unique key for the script
     * @param source Script source code
     * @param metadata Script metadata
     */
    ScriptRegistry.prototype.registerScript = function (key, source, metadata) {
        if (this.scripts.has(key)) {
            logger_js_1.logger.warn("Overwriting existing script with key: ".concat(key));
        }
        this.scripts.set(key, { source: source, metadata: metadata });
        logger_js_1.logger.debug("Registered script: ".concat(key, " (").concat(metadata.domain, "/").concat(metadata.name, " v").concat(metadata.version, ")"));
    };
    /**
     * Get a script by its key
     * @param key Script key
     * @returns Script entry or undefined if not found
     */
    ScriptRegistry.prototype.getScript = function (key) {
        return this.scripts.get(key);
    };
    /**
     * Get script source by key
     * @param key Script key
     * @returns Script source or undefined if not found
     */
    ScriptRegistry.prototype.getScriptSource = function (key) {
        var entry = this.scripts.get(key);
        return entry === null || entry === void 0 ? void 0 : entry.source;
    };
    /**
     * Check if a script exists
     * @param key Script key
     * @returns True if the script exists
     */
    ScriptRegistry.prototype.hasScript = function (key) {
        return this.scripts.has(key);
    };
    /**
     * Get all scripts in the registry
     * @returns Map of all scripts
     */
    ScriptRegistry.prototype.getAllScripts = function () {
        return new Map(this.scripts);
    };
    /**
     * Get scripts by domain
     * @param domain Script domain
     * @returns Array of script entries for the domain
     */
    ScriptRegistry.prototype.getScriptsByDomain = function (domain) {
        var result = [];
        this.scripts.forEach(function (entry) {
            if (entry.metadata.domain === domain) {
                result.push(entry);
            }
        });
        return result;
    };
    /**
     * Clear all scripts from the registry
     */
    ScriptRegistry.prototype.clearScripts = function () {
        this.scripts.clear();
        logger_js_1.logger.debug('Cleared all scripts from registry');
    };
    return ScriptRegistry;
}());
exports.ScriptRegistry = ScriptRegistry;
/**
 * Convenience function to get the script registry instance
 * @returns Script registry instance
 */
function getScriptRegistry() {
    return ScriptRegistry.getInstance();
}

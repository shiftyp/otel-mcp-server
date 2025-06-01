"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorResponse = createErrorResponse;
exports.handleError = handleError;
exports.isErrorResponse = isErrorResponse;
exports.withErrorHandling = withErrorHandling;
var logger_js_1 = require("./logger.js");
/**
 * Creates a standardized error response object
 * @param message Error message
 * @param details Additional error details
 * @param code Error code
 * @param status HTTP status code
 * @returns Standardized error response
 */
function createErrorResponse(message, details, code, status) {
    return {
        error: true,
        message: message,
        details: details,
        code: code,
        status: status
    };
}
/**
 * Handles errors in a consistent way across the codebase
 * @param error Error object or string
 * @param context Additional context for the error
 * @returns Standardized error response
 */
function handleError(error, context) {
    var errorMessage = error instanceof Error ? error.message : String(error);
    var contextPrefix = context ? "[".concat(context, "] ") : '';
    var fullMessage = "".concat(contextPrefix).concat(errorMessage);
    logger_js_1.logger.error(fullMessage);
    if (error instanceof Error && error.stack) {
        logger_js_1.logger.debug(error.stack);
    }
    return createErrorResponse(fullMessage, error instanceof Error ? { stack: error.stack } : undefined, error.code, error.status);
}
/**
 * Checks if a response is an error response
 * @param response Any response object
 * @returns True if the response is an error response
 */
function isErrorResponse(response) {
    return response && typeof response === 'object' && response.error === true;
}
/**
 * Wraps an async function with error handling
 * @param fn Async function to wrap
 * @param context Context for error logging
 * @returns Wrapped function that returns a standardized response
 */
function withErrorHandling(fn, context) {
    var _this = this;
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return __awaiter(_this, void 0, void 0, function () {
            var error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, fn.apply(void 0, args)];
                    case 1: return [2 /*return*/, _a.sent()];
                    case 2:
                        error_1 = _a.sent();
                        return [2 /*return*/, handleError(error_1, context)];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
}

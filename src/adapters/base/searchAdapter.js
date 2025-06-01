"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchEngineFeature = exports.SearchEngineType = exports.BaseSearchAdapter = void 0;
var events_1 = require("events");
/**
 * Base interface for all search engine adapters
 * This defines the common methods that all search engine adapters must implement
 */
var BaseSearchAdapter = /** @class */ (function (_super) {
    __extends(BaseSearchAdapter, _super);
    function BaseSearchAdapter(options) {
        var _this = _super.call(this) || this;
        _this.options = options;
        return _this;
    }
    return BaseSearchAdapter;
}(events_1.EventEmitter));
exports.BaseSearchAdapter = BaseSearchAdapter;
/**
 * Enum of search engine types
 */
var SearchEngineType;
(function (SearchEngineType) {
    SearchEngineType["ELASTICSEARCH"] = "elasticsearch";
    SearchEngineType["OPENSEARCH"] = "opensearch";
})(SearchEngineType || (exports.SearchEngineType = SearchEngineType = {}));
/**
 * Enum of search engine features
 */
var SearchEngineFeature;
(function (SearchEngineFeature) {
    SearchEngineFeature["RUNTIME_FIELDS"] = "runtime_fields";
    SearchEngineFeature["ML_ANOMALY_DETECTION"] = "ml_anomaly_detection";
    SearchEngineFeature["PAINLESS_SCRIPTING"] = "painless_scripting";
    SearchEngineFeature["FIELD_COLLAPSING"] = "field_collapsing";
    SearchEngineFeature["ASYNC_SEARCH"] = "async_search";
    SearchEngineFeature["SEARCH_AFTER"] = "search_after";
    SearchEngineFeature["POINT_IN_TIME"] = "point_in_time";
    SearchEngineFeature["COMPOSITE_AGGREGATIONS"] = "composite_aggregations";
    SearchEngineFeature["PIPELINE_AGGREGATIONS"] = "pipeline_aggregations";
})(SearchEngineFeature || (exports.SearchEngineFeature = SearchEngineFeature = {}));

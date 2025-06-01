import { logger } from '../../../utils/logger.js';

/**
 * Create a custom sampling query for logs that works with various log structures
 * This approach is more flexible than the standard intelligent sampling
 * and works with logs that may not have consistent severity/level fields
 * 
 * @returns Query fragment for custom log sampling
 */
export function createCustomLogSamplingQuery() {
  logger.info('[SemanticLogSampling] Creating custom sampling query for logs');
  
  return {
    function_score: {
      query: {
        bool: {
          should: [
            // Sample logs with error-related keywords in the message (100%)
            {
              bool: {
                should: [
                  { match: { message: "error" } },
                  { match: { message: "exception" } },
                  { match: { message: "fail" } },
                  { match: { message: "critical" } },
                  // Check for specific fields if they exist
                  { range: { "event.severity": { gte: 17 } } },
                  { terms: { "log.level": ["error", "critical", "fatal", "emergency", "alert"] } }
                ]
              }
            },
            // Sample logs with warning-related keywords (50%)
            {
              bool: {
                must: [
                  {
                    bool: {
                      should: [
                        { match: { message: "warn" } },
                        { match: { message: "warning" } },
                        // Check for specific fields if they exist
                        { range: { "event.severity": { gte: 13, lt: 17 } } },
                        { terms: { "log.level": ["warning", "warn"] } }
                      ]
                    }
                  },
                  { script: { script: "Math.random() < 0.9" } } // 90% sampling
                ]
              }
            },
            // Low priority: Info and debug logs (10% sampling)
            {
              bool: {
                must: [
                  {
                    bool: {
                      should: [
                        { match: { message: "info" } },
                        { match: { message: "debug" } },
                        { match: { message: "trace" } },
                        // Check for specific fields if they exist
                        { range: { "event.severity": { lt: 13 } } },
                        { terms: { "log.level": ["info", "debug", "trace", "notice"] } }
                      ]
                    }
                  },
                  { script: { script: "Math.random() < 0.1" } } // 10% sampling
                ]
              }
            },
            // Fallback for logs without severity or level (5% sampling)
            {
              bool: {
                must_not: [
                  { exists: { field: "event.severity" } },
                  { exists: { field: "log.level" } }
                ],
                must: [
                  { script: { script: "Math.random() < 0.05" } } // 5% sampling
                ]
              }
            }
          ]
        }
      }
    }
  };
}

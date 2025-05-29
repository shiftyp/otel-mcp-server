import { OpenSearchCore } from '../core/core.js';
import { logger } from '../../../utils/logger.js';

/**
 * OpenSearch Traces Adapter Core
 * Provides base functionality for working with OpenTelemetry traces data in OpenSearch
 */
export class TracesAdapterCore extends OpenSearchCore {
  constructor(options: any) {
    super(options);
  }

  /**
   * Make a request to OpenSearch
   */
  public async request(method: string, url: string, body: any) {
    return this.callRequest(method, url, body);
  }
}

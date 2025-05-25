# OTEL MCP Server

A minimal MCP (Model Context Protocol) server that provides a stdio-based interface to Elasticsearch for querying and analyzing OpenTelemetry (OTEL) observability data (traces, metrics, logs).

## ⚙️ MCP Configuration

To use OTEL MCP Server with tools like MCP Inspector or Windsurf, use the following configuration (assuming default environment variables and that you run the server with `npx -y otel-mcp-server`):

```json
{
   "servers": {
      // ...
      "otel-mcp-server": {
         "command": "npx",
         "args": ["-y", "otel-mcp-server"],
         "env": {
            "ELASTICSEARCH_URL": "http://localhost:9200",
            "ELASTICSEARCH_USERNAME": "elastic",
            "ELASTICSEARCH_PASSWORD": "changeme",
            "SERVER_NAME": "otel-mcp-server",
            "LOGLEVEL": "OFF",
            "LOGFILE": "logs/mcp-requests.log"
         }
      }
      // ...
   }
}
```


## ✨ Features

- **Query** Elasticsearch for traces, metrics, and logs
- **Analyze a Trace**: Use the `analyze-trace` tool to get span count, root span, duration, and services for any trace
- **Anomaly Detection**: Detect anomalies in metrics, spans, and logs without ML models
- **Service-Aware Tools**: Filter all tools by service or analyze across multiple services
- **Field Discovery**: Find available fields for specific services to use in anomaly detection
- **Connection Validation** on startup
- **Cross-Platform**: Windows, macOS, and Linux

## 🚀 Quick Start

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/your-username/otel-mcp-server.git
   cd otel-mcp-server
   npm install
   ```

2. **Configure your environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Elasticsearch details
   ```

3. **Build the server**:
   ```bash
   npm run build
   ```

4. **Start the server** (stdio MCP transport):
   ```bash
   npm start
   ```

## 🛠️ Usage

This server exposes MCP tools for use with MCP-compatible clients (such as Windsurf or MCP Inspector):

### 🔧 Available Tools

### Traces

- `traceAnalyze`: Get a summary of a trace by ID
- `spanGet`: Find a span by ID
- `generateServiceDependencyGraph`: Create a service dependency graph for a time window
- `generateSpanFlowchart`: Generate a flowchart for a span
- `tracesQuery`: Query traces with Elasticsearch syntax
- `traceFieldsGet`: Find available trace fields (supports service filtering)
- `spanDurationAnomaliesDetect`: Detect anomalies in span durations (supports optional operation and multiple services)

### Metrics

- `searchMetricsFields`: Find available metric fields (supports service filtering)
- `queryMetrics`: Query metrics with Elasticsearch syntax
- `generateMetricsRangeAggregation`: Aggregate metrics over a time range
- `detectMetricAnomalies`: Detect anomalies in metrics (supports optional metric field and multiple services)

### Logs

- `findLogs`: Search logs for a pattern (supports service filtering and time ranges)
- `logsTable`: Display logs in a tabular format with customizable fields and trace links
- `logFieldsGet`: Find available log fields (supports service filtering)
- `logsQuery`: Query logs with Elasticsearch syntax
- `logAnomaliesDetect`: Detect anomalies in logs using a hybrid approach (supports multiple detection methods)
- `errorsGetTop`: Get top errors for a service or across multiple services

### Visualizations

- `generateMarkdownVisualizations`: Generate various visualizations including:
  - Incident timeline with emoji and special character support
  - XY charts (bar, line, scatter) for metrics, logs, and traces
  - Service dependency graphs
  - Error distribution pie charts
  - Service health charts
  - Span Gantt charts
  - Metrics time series tables

### Services

- `servicesGet`: List all services

## 🔍 Enhanced Anomaly Detection

The OTEL MCP Server includes powerful anomaly detection capabilities that work without requiring machine learning models:

### Metric Anomaly Detection

The `detectMetricAnomalies` tool supports:

- Optional metric field - Analyze any/all metrics when no specific field is provided
- Multiple services - Compare anomalies across different services
- Multiple detection methods - Z-score, percentile, IQR, and absolute threshold

```javascript
// Find any anomalous metrics across payment and checkout services
mcp0_detectMetricAnomalies({
  "startTime": "2025-05-23T12:00:00-04:00",
  "endTime": "2025-05-23T14:00:00-04:00",
  "services": ["payment", "checkout"],
  "zScoreThreshold": 2.5
})
```

### Span Duration Anomaly Detection

The `spanDurationAnomaliesDetect` tool supports:

- Optional operation - Analyze any/all operations when no specific operation is provided
- Multiple services - Compare anomalies across different services
- Multiple detection methods - Z-score, percentile, IQR, and absolute threshold

```javascript
// Find any slow spans across all operations in the payment service
mcp0_spanDurationAnomaliesDetect({
  "startTime": "2025-05-23T12:00:00-04:00",
  "endTime": "2025-05-23T14:00:00-04:00",
  "service": "payment",
  "percentileThreshold": 95
})
```

### Log Anomaly Detection

The `logAnomaliesDetect` tool implements a hybrid approach combining multiple detection strategies without requiring machine learning models:

- **Frequency-based detection** - Identifies unusual spikes or drops in log volume compared to a baseline period
- **Pattern-based detection** - Searches for logs containing error patterns or unexpected severity changes
- **Statistical detection** - Flags logs with unusual field values based on statistical measures
- **Clustering analysis** - Detects unusual groupings or unexpected variety in log messages

The tool supports multiple services and provides configurable parameters for fine-tuning detection sensitivity:

```javascript
// Find anomalous logs across multiple services using all detection methods
mcp0_logAnomaliesDetect({
  "startTime": "2025-05-23T12:00:00-04:00",
  "endTime": "2025-05-23T14:00:00-04:00",
  "services": ["payment", "checkout", "inventory"],
  "methods": ["frequency", "pattern", "statistical", "clustering"],
  "lookbackWindow": "7d",
  "spikeThreshold": 3
})

// Focus on specific detection methods with custom parameters
mcp0_logAnomaliesDetect({
  "startTime": "2025-05-23T12:00:00-04:00",
  "endTime": "2025-05-23T14:00:00-04:00",
  "service": "payment",
  "methods": ["pattern", "statistical"],
  "patternKeywords": ["timeout", "connection refused", "database error"],
  "includeDefaultPatterns": true,
  "zScoreThreshold": 2.5,
  "maxResults": 50
})
```

Results are grouped by service when analyzing multiple services, making it easy to identify which services are experiencing anomalies.

## 🔄 Service-Aware Tools

All tools now support service filtering, allowing you to focus on specific services or analyze across multiple services:

### Field Discovery

Find fields available for specific services:

```javascript
// Find CPU-related metric fields across multiple services
mcp0_searchMetricsFields({
  "search": "cpu",
  "services": ["payment", "inventory", "shipping"]
})

// Find duration-related span fields in the checkout service
mcp0_traceFieldsGet({
  "search": "duration",
  "service": "checkout"
})

// Find error-related log fields across multiple services
mcp0_logFieldsGet({
  "search": "error",
  "services": ["payment", "checkout"]
})
```

### Log Search

Filter logs by service and time range:

```javascript
// Find timeout logs across multiple services
mcp0_findLogs({
  "pattern": "timeout",
  "services": ["payment", "inventory", "shipping"],
  "timeRange": {
    "start": "now-1h",
    "end": "now"
  }
})
```

## 📊 Enhanced Visualizations

The OTEL MCP Server includes powerful visualization capabilities through the `generateMarkdownVisualizations` tool. All visualizations properly handle special characters and emojis using Unicode escaping.

### Incident Timeline

Generate a chronological view of events during an incident:

```javascript
// Create an incident timeline for the last hour
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-1h",
      "end": "now"
    },
    "config": {
      "type": "incident-timeline",
      "maxEvents": 20,
      "correlateEvents": true,
      "services": ["payment", "checkout"],
      "includeMetrics": true,
      "includeTraces": true
    }
  }
})
```

**Example Output:**

```mermaid
timeline
title Incident Timeline (with correlation)
    section load-generator
        07#58;42 PM : Warning Transient error StatusCode.UNAVAILABLE encountered while exporting logs to otel-collector#58;4317... : warning
        07#58;42 PM : Warning Transient error StatusCode.UNAVAILABLE encountered while exporting traces to otel-collector#58;43... : warning
        07#58;42 PM : Error Browser.new_context#58; Target page, context or browser has been closed Traceback (most recent ca... : critical
        07#58;42 PM : Error POST [8768d8ad...][4bee997e...] : critical
        07#58;42 PM : Error GET [73465730...][be2732b2...] : critical
    section product-catalog
        07#58;43 PM : Error oteldemo.ProductCatalogService/GetProduct [0a2da977...][9cef039b...] : critical
```

### Logs Table

Display logs in a tabular format with customizable fields and trace links:

### Logs Table

Generate a table of logs with customizable fields. You can use either the dedicated logs table tool or the markdown visualizations tool:

```javascript

```javascript
// Method 1: Using the dedicated logs table tool
mcp0_logsTable({
  "timeRange": {
    "start": "now-1h",
    "end": "now"
  },
  "maxRows": 3,
  "fields": ["Resource.service.name"]
})

// Method 2: Using the markdown visualizations tool
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-1h",
      "end": "now"
    },
    "config": {
      "type": "logs-table",
      "maxRows": 3,
      "fields": ["timestamp", "service", "level", "message", "Resource.service.name"],
      "includeTraceLinks": true,
      "services": ["payment", "checkout", "inventory"] // Optional: filter to specific services
    }
  }
})
```

**Example Output:**

| Timestamp | Service | Level | Message | Trace ID | Resource.service.name |
|-----------|---------|-------|---------|----------|----------------------|
| 2025-05-25 22:52:52 | payment-service | ERROR | Failed to process payment for order #12345: Invalid credit card number | [f8a91c2d...](trace:f8a91c2d7b3e6a5f4c9d8e7b6a5f4c9d) | payment-service |
| 2025-05-25 22:52:49 | frontend-proxy | INFO | [2025-05-25T22:52:49.152Z] "GET /api/cart HTTP/1.1" 200 - via_upstream - "-" 0 24 2 2 "-" "python... | [01366d98...](trace:01366d986ed8a49882444b1569c938e0) | frontend-proxy |
| 2025-05-25 22:52:47 | accounting | INFORMATION | Order details: {@OrderResult}. | - | accounting |
| 2025-05-25 22:52:47 | fraud-detection | INFO | Consumed record with orderId: fa1d0a10-39ba-11f0-9877-debf89339049, and updated total count to: 1... | [ac36a9f5...](trace:ac36a9f58dbced6d24d8e3b141675301) | fraud-detection |

*Showing 3 of 100 logs. Use maxRows parameter to adjust.*

### XY Charts

Create bar, line, or scatter charts for visualizing metrics, logs, or traces:

```javascript
// Generate a bar chart showing log counts by service
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-24h",
      "end": "now"
    },
    "config": {
      "type": "xy-chart",
      "chartType": "bar",
      "xField": "Resource.service.name",
      "yField": "count",
      "dataType": "logs",
      "title": "Log Count by Service",
      "xAxisTitle": "Service",
      "yAxisTitle": "Count"
    }
  }
})
```

### Field Distribution Pie Chart

Show the distribution of values for a specific field:

```javascript
// Generate a pie chart showing distribution of HTTP status codes
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-24h",
      "end": "now"
    },
    "config": {
      "type": "field-distribution-pie",
      "field": "http.status_code",
      "dataType": "traces",
      "maxSlices": 10,
      "showData": true
    }
  }
})
```

### Error Distribution Pie Chart

Show the distribution of errors by service or type:

```javascript
// Generate a pie chart showing distribution of errors
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-24h",
      "end": "now"
    },
    "config": {
      "type": "error-pie",
      "services": ["payment", "checkout", "inventory"],
      "maxResults": 10,
      "showData": true
    }
  }
})
```

### Service Health Chart

Time series visualization of service health metrics:

```javascript
// Generate a service health chart for CPU usage
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-6h",
      "end": "now"
    },
    "config": {
      "type": "service-health",
      "services": ["payment", "checkout", "inventory"],
      "metricField": "system.cpu.usage",
      "aggregation": "avg",
      "intervalCount": 12,
      "yAxisLabel": "CPU Usage (%)"
    }
  }
})
```

### Service Dependency Graph

Visualize the relationships and call patterns between services:

```javascript
// Generate a service dependency graph
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-24h",
      "end": "now"
    },
    "config": {
      "type": "service-dependency",
      "query": "Resource.service.name:payment OR Resource.service.name:checkout"
    }
  }
})
```

**Example Output:**

```mermaid
graph TD
  A["checkout"]
  B["frontend"]
  C["cart"]
  D["payment"]
  E["shipping"]
  A --> |3 calls| B
  A --> |6 calls| C
  A --> |3 calls| D
  A --> |4 calls| E
  B --> |3 calls| A
  B --> |1 calls| D
  C --> |6 calls| A
  C --> |3 calls| D
  D --> |3 calls| A
  E --> |4 calls| A
```

### Incident Graph

Visualize the relationships between services during an incident:

```javascript
// Generate an incident graph
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-1h",
      "end": "now"
    },
    "config": {
      "type": "incident-graph",
      "service": "payment",
      "query": "severity:high"
    }
  }
})
```

### Span Gantt Chart

Timeline visualization of spans in a distributed trace:

```javascript
// Generate a span Gantt chart for a specific trace
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-1h",
      "end": "now"
    },
    "config": {
      "type": "span-gantt",
      "spanId": "abcdef1234567890"
    }
  }
})
```

### Markdown Table

Tabular representation of OTEL data:

```javascript
// Generate a markdown table of trace data
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-1h",
      "end": "now"
    },
    "config": {
      "type": "markdown-table",
      "headers": ["Timestamp", "Service", "Operation", "Duration", "Status"],
      "fieldMappings": ["timestamp", "Resource.service.name", "name", "duration", "status.code"],
      "queryType": "traces",
      "query": {},
      "maxRows": 20
    }
  }
})
```

### Metrics Time Series Table

Tabular representation of metrics over time intervals:

```javascript
// Generate a metrics time series table
mcp0_generateMarkdownVisualizations({
  "config": {
    "timeRange": {
      "start": "now-6h",
      "end": "now"
    },
    "config": {
      "type": "metrics-time-series-table",
      "metricField": "system.memory.usage",
      "services": ["payment", "checkout", "inventory"],
      "intervalCount": 6,
      "formatValue": "decimal2"
    }
  }
})
```

### Incident Analysis

Analyze incidents across multiple services:

```javascript
// Extract an incident graph spanning multiple services
mcp0_extractIncidentGraph({
  "startTime": "2025-05-23T13:00:00-04:00",
  "endTime": "2025-05-23T14:00:00-04:00",
  "services": ["payment", "checkout", "inventory"]
})
```

### Example: Analyze a Trace

Request:
```json
{
  "tool": "analyzeTrace",
  "params": { "traceId": "<your-trace-id>" }
}
```

Response:
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"traceId\": \"...\",\n  \"spanCount\": 12,\n  ...\n}"
    }
  ]
}
```

## 🧪 Testing with the OTEL Demo

You can test OTEL MCP Server with the official [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) to ingest and query real traces, metrics, and logs.

### Steps:
1. **Deploy the OTEL Demo** (e.g., via Docker Compose or Kubernetes)
2. **Find your Elasticsearch endpoint and credentials** (usually from the OTEL demo's output or secrets)
3. **Configure your `.env`** for OTEL MCP Server:
   ```env
   ELASTICSEARCH_URL=http://localhost:9200
   ELASTICSEARCH_USERNAME=elastic
   ELASTICSEARCH_PASSWORD=yourpassword
   # ...other settings
   ```
4. **Run OTEL MCP Server** and connect your MCP client (e.g., Windsurf)

### ⚠️ Known Issue: Elasticsearch HTTPS/SSL
- The OTEL demo often exposes Elasticsearch with **self-signed HTTPS** (SSL/TLS) enabled.
- The MCP server (and many clients) may fail to connect due to SSL verification errors.

#### **Workarounds:**
- **Recommended:** Deploy an Nginx proxy that listens on HTTP and forwards to the Elasticsearch HTTPS endpoint, disabling SSL verification and injecting credentials.
- Example Nginx config (see `demo/elasticsearch-nginx-proxy.conf`):
  ```nginx
  server {
      listen 80;
      location / {
          proxy_pass https://elasticsearch-master:9200;
          proxy_ssl_verify off;
          # Base64 encoded elastic:changeme (default Elastic password, change for production!)
          proxy_set_header Authorization "Basic ZWxhc3RpYzpjaGFuZ2VtZQ==";
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  }
  ```
  - **Warning:** The above uses the default password `changeme`. Change this for production deployments!
  - See `demo/elasticsearch-nginx-proxy.yaml` for a ready-to-use Kubernetes deployment.
- **Alternative:** If running locally, you may be able to set `ELASTICSEARCH_URL=http://localhost:<forwarded-port>` if you have port-forwarded HTTP traffic or disabled SSL in Elasticsearch.
- **Not recommended:** Disabling SSL verification in Node.js globally (via `NODE_TLS_REJECT_UNAUTHORIZED=0`) is insecure for production.

**Tip:**
- After setting up the proxy, point `ELASTICSEARCH_URL` to the HTTP proxy endpoint (e.g., `http://localhost:8082`).
- Use the provided credentials in your `.env`.

If you encounter connection issues, check the logs for SSL or authentication errors and consult the example proxy configs in `demo/`.

## 🚢 Deployment & Orchestration Notes

**Note:** OTEL MCP Server is a stdio-based process. It is not meant to be deployed as a long-running HTTP/gRPC service. Instead, it should be launched by an MCP-compatible orchestrator (such as Windsurf, MCP Inspector, or another MCP tool) or run directly in your shell for local testing.

- For most use cases, run the server locally with:
  ```bash
  npm start
  ```
- If containerizing, run it as a foreground process and connect its stdio to your orchestrator.
- Do **not** deploy as a background service or expose as an HTTP endpoint (unless you have added a transport for that purpose).

### Kubernetes (Helm or kubectl)
1. **Deploy the OTEL Demo:**
   - Follow the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) instructions for Kubernetes.
2. **Deploy the Nginx Proxy:**
   - Apply the provided `demo/elasticsearch-nginx-proxy.yaml`:
     ```bash
     kubectl apply -f demo/elasticsearch-nginx-proxy.yaml
     ```
   - Confirm the service is running (default port 80).
3. **Run OTEL MCP Server:**
   - Start the server as a stdio process from your shell, or as a subprocess of your MCP client/orchestrator (e.g., Windsurf):
     ```bash
     npm start
     # or
     node dist/server.js
     ```
   - Set `ELASTICSEARCH_URL` to the Nginx proxy service (e.g., `http://elasticsearch-nginx-proxy:80`).
   - If running in a container, ensure stdio is connected to your orchestrator.

### Docker Compose
1. **Run the OTEL Demo:**
   - Use the official Docker Compose setup from the [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo).
2. **Add the Nginx Proxy:**
   - Add a service to your `docker-compose.yaml` referencing the `demo/elasticsearch-nginx-proxy.conf` as a config/volume.
   - Link the proxy to the Elasticsearch container and expose it on a desired port (e.g., 8082).
3. **Run OTEL MCP Server:**
   - Start the server as a stdio process from your shell, or as a subprocess of your MCP client/orchestrator:
     ```bash
     npm start
     # or
     node dist/server.js
     ```
   - Set `ELASTICSEARCH_URL` to the Nginx proxy (e.g., `http://nginx-proxy:8082`).
   - If running in a container, ensure stdio is connected to your orchestrator.

**See the `demo/` directory for ready-to-use config files for both Kubernetes and Docker Compose.**

### Examples

1. Query for traces:
   ```json
   {
     "tool": "queryTraces",
     "params": {
       "query": {
         "query": {
           "range": {
             "@timestamp": {
               "gte": "2023-01-01T00:00:00Z",
               "lte": "2023-01-02T00:00:00Z"
             }
           }
         },
         "size": 10
       }
     }
   }
   ```

2. Search for trace fields:
   ```json
   {
     "tool": "searchForTraceFields",
     "params": {
       "search": "duration"
     }
   }
   ```

3. Search for log fields:
   ```json
   {
     "tool": "searchForLogFields",
     "params": {
       "search": "message"
     }
   }
   ```

4. Search for metric fields:
   ```json
   {
     "tool": "searchMetricsFields",
     "params": {
       "search": "value"
     }
   }
   ```

5. Detect metric anomalies:
   ```json
   {
     "tool": "detectMetricAnomalies",
     "params": {
       "startTime": "2023-01-01T00:00:00Z",
       "endTime": "2023-01-02T00:00:00Z",
       "service": "frontend",
       "metricField": "metric.value",
       "nStddev": 3
     }
   }
   ```

6. List all services:
   ```
   list
   ```

3. Get a specific resource:
   ```
   get traces/123e4567-e89b-12d3-a456-426614174000
   ```

4. List only trace resources:
   ```
   list traces
   ```

## 🔍 Debugging

Set the `DEBUG=1` environment variable to enable detailed logging:

```bash
DEBUG=1 npm start
```

This will show:
- Request/response headers
- Full request/response bodies
- Detailed error messages
- Connection details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Integration

You can pipe commands to the server:
```bash
echo "query traces '{\"timeRange\": {\"start\": \"2023-01-01T00:00:00Z\", \"end\": \"2023-01-02T00:00:00Z\"}}'" | npm start
```

## Example Prompts for LLMs

Here are some example prompts you can use with LLMs that have access to this MCP server:

### Exploring Data Structure

```
What fields are available in the trace data? Use the searchForTraceFields tool to find out.
```

```
I want to analyze logs related to errors. What fields should I look at? Use the searchForLogFields tool to find fields related to errors or exceptions.
```

```
What metrics are available for the 'frontend' service? Use the searchMetricsFields tool to find relevant metric fields.
```

### Service Dependency Analysis

```
Generate a service dependency graph for the last hour. Which services have the highest error rates?
```

```
Create a flowchart for this span: <span-id>. I want to understand the request flow.
```

### Troubleshooting

```
Find all error traces from the last 24 hours for the 'payment' service. Use the queryTraces tool.
```

```
Analyze this trace ID: <trace-id>. What services are involved and what was the error?
```

```
Look for any anomalies in the 'http.server.duration' metric for the 'checkout' service over the past hour.
```

### Incident Investigation

```
Extract an incident graph between 2:00 PM and 3:00 PM today when we had the outage. Focus on the 'authentication' service.
```

```
Find the top 5 errors during the incident timeframe (May 23, 2025, 10:00-11:00 AM).
```

```
Query the logs during the incident and look for any authentication failures or timeout errors.
```

## Windsurf-Specific Prompts with Code Context

When using this MCP server with [Windsurf](https://windsurf.com/editor), you can leverage both telemetry data and code context for more powerful analysis. Here are some prompts designed specifically for Windsurf:

### Exploring Code and Data Together

```
What fields are available in our trace data that correspond to the error handling in our API controllers? Use the searchForTraceFields tool to find relevant fields, then show me where these are used in our code.
```

```
How do our database query metrics correlate with our ORM implementation? Use searchMetricsFields to find database metrics, then analyze our database access patterns in the code.
```

### Service Dependency Analysis

```
Generate a service dependency graph for our application and correlate it with our codebase structure. Are there any mismatches between our service architecture and code organization?
```

```
Create a flowchart for this span: <span-id> and map it to the corresponding code paths in our application. I want to understand how the request flows through our services.
```

### Code-Aware Troubleshooting

```
I'm seeing errors in the authentication service. Use the searchLogs tool to find recent authentication errors, then analyze the relevant code in our codebase to identify potential issues. Focus on the auth middleware and token validation logic.
```

```
This API endpoint is returning 500 errors. Use the queryTraces tool to find recent traces for this endpoint, then examine the code to identify what might be causing the failures. Look for error handling, database queries, and external service calls.
```

```
The 'payment-service' is showing high latency. Use the searchMetricsFields tool to find relevant metrics, then analyze the performance of our payment processing code. Identify any inefficient algorithms, blocking calls, or resource bottlenecks.
```

### Root Cause Analysis

```
We had an incident yesterday between 2:00-3:00 PM. Use the extractIncidentGraph tool to visualize the incident, then correlate the affected services with our codebase. Identify which code changes might have contributed to the issue and suggest fixes.
```

```
This trace ID shows a failed checkout: <trace-id>. Analyze the trace and then examine our checkout flow code to determine what went wrong. Suggest code improvements to prevent this issue in the future.
```

### Performance Optimization

```
Our database queries are slow according to the traces. Use the queryTraces tool to find the slowest database operations, then analyze our database access code and suggest optimizations. Look for missing indexes, N+1 queries, or inefficient joins.
```

```
Use the detectMetricAnomalies tool to find unusual patterns in our API response times across all services, then review the API implementation code to identify potential performance bottlenecks. Focus on any metrics that show anomalies without specifying a particular metric field.
```

```
Find anomalous span durations in our payment and checkout services for the last hour. Don't limit to a specific operation - I want to see any slow operations across these services. Then suggest code improvements for the slowest operations.
```

### Error Pattern Detection

```
Use the detectLogAnomalies tool to find unusual log patterns in our payment service over the last 2 hours. Focus on both frequency spikes and error patterns. Analyze the results to identify potential issues and suggest fixes.
```

```
Analyze error patterns across our microservices using the listTopErrors tool. Then examine our error handling code to identify common failure modes and suggest improvements to our error handling and resilience patterns.
```

```
Find all available log fields for our authentication service, then use those fields to search for authentication failures during the incident timeframe (May 23, 2025, 1:00-2:00 PM).
```

```
Use the extractIncidentGraph tool to visualize the incident across our payment, checkout, and inventory services. Identify which services were most affected and suggest areas to investigate further.
```

### Cross-Service Analysis

```
Perform a comprehensive analysis of our checkout flow by:
1. Finding all available metric fields for the checkout service
2. Detecting any anomalies in those metrics
3. Searching for error patterns in the checkout service logs
4. Analyzing slow spans in the checkout process
Then provide a summary of potential issues and recommendations.
```

```
Compare the performance of our payment service before and after the recent deployment. Use the detectMetricAnomalies and detectSpanDurationAnomalies tools to identify any regressions or improvements. Focus on both the payment service itself and any services it depends on.
```

```
Use the detectLogAnomalies tool with all detection methods to find unusual patterns across our entire system during the incident window. Group the results by service and focus on the most severe anomalies based on confidence score.
```

## Building for Production

To build the TypeScript code to JavaScript:
```bash
npm run build
```

The built files will be in the `dist` directory.

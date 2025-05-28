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

- **Direct Query** - Execute custom Elasticsearch queries against traces, metrics, and logs
- **Service-Aware Tools** - Filter all tools by service or query across multiple services
- **Field Discovery** - Find available fields for specific services to construct effective queries
- **Structured Error Handling** - All tools return consistent, structured error responses
- **Connection Validation** - Automatic validation on startup
- **Cross-Platform** - Windows, macOS, and Linux
- **Dual Mapping Mode Support** - Compatible with both OTEL and ECS mapping modes in Elasticsearch
- **Minimal Abstraction** - Transparent access to data without hiding query complexity
- **Maximum Flexibility** - Full control over queries for customization

## 🔄 Elasticsearch Mapping Modes

The OTEL MCP Server supports two Elasticsearch mapping modes for OpenTelemetry data:

### OTEL Mapping Mode

The `otel` mapping mode preserves the original OpenTelemetry data structure, keeping attribute names and closely following the OTLP event structure. This mode requires Elasticsearch 8.12+ and uses data streams for optimal time series performance.

**Configuration requirements:**
- Elasticsearch 8.12+ or 9.0+
- Data stream index templates for logs, metrics, and traces
- OpenTelemetry Collector configured with:
  ```yaml
  exporters:
    elasticsearch:
      mapping:
        mode: otel
      headers:
        X-Elastic-Mapping-Mode: otel
  ```

### ECS Mapping Mode

The `ecs` mapping mode maps OpenTelemetry fields to the Elastic Common Schema (ECS), making the data more compatible with existing Elastic dashboards and tools.

**Configuration requirements:**
- Works with all Elasticsearch versions
- OpenTelemetry Collector configured with:
  ```yaml
  exporters:
    elasticsearch:
      mapping:
        mode: ecs
      headers:
        X-Elastic-Mapping-Mode: ecs
  ```

The OTEL MCP Server automatically detects and adapts to both mapping modes, so you can use either format without changing your configuration.

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

## ⚙️ Usage

This server exposes MCP tools for use with MCP-compatible clients (such as Windsurf or MCP Inspector). All tools return structured responses and include consistent error handling.

### Adaptive Tool Registration

The OTEL MCP Server dynamically registers tools based on available telemetry types in your Elasticsearch instance:

- If traces are available, trace query tools (`tracesQuery`, `traceFieldsGet`) will be registered
- If metrics are available, metric query tools (`metricsQuery`, `metricsFieldsGet`) will be registered
- If logs are available, log query tools (`logsQuery`, `logFieldsGet`, `findLogs`) will be registered
- Common tools like `servicesGet` adapt to use whatever telemetry is available

This means the set of available tools may vary depending on your environment and data availability. The server automatically detects what's available and registers the appropriate tools.

To check which tools are available at runtime, you can use the built-in `listtools` utility:

```javascript
mcp0_listtools({
  "search": ""
})
```

This will return a list of all registered tools, which will reflect the available telemetry types in your environment.

### 🔧 Available Tools

### Direct Query Tools

- `tracesQuery`: Query trace data using Elasticsearch query syntax
- `metricsQuery`: Query metric data using Elasticsearch query syntax
- `logsQuery`: Query log data using Elasticsearch query syntax
- `servicesGet`: List all detected services (based on trace, metric, or log data)
- `serviceDependencyInfo`: Analyze service dependency relationships and traffic metrics for all spans in a time window (no sampling)
- `serviceArchitectureMap`: Generate a tree or graph of service relationships with error rates and traffic statistics. Supports:
    - Tree structure output (preferred)
    - Relationship-specific metrics (calls, errors, error rates)
    - Format options: `full`, `summary`, `compact`
    - Pagination: `page`, `pageSize`
    - Filtering: `maxDepth`, `minCallCount`, `includeMetrics`
- `traceFieldsGet`: Discover available trace fields with their types (supports service filtering)
- `logFieldsGet`: Discover available log fields with their types and schemas (supports service filtering)
- `metricsFieldsGet`: Discover available metric fields with their types (supports service filtering)

### Service Discovery

- **List Services**: "What services are available in the system? Use the `servicesGet` tool to list all services."
- **Find Services**: "Are there any payment-related services? Use `servicesGet` with a search parameter."

### Troubleshooting

- **Error Traces**: "Find all error traces from the last 24 hours for the 'payment' service using `tracesQuery`."
- **Recent Logs**: "Show me the most recent logs from the 'checkout' service using `logsQuery`."
- **Resource Metrics**: "Get the CPU usage metrics for the 'api' service over the past hour using `metricsQuery`."

### Incident Investigation

- **Outage Analysis**: "Query traces during the outage period (2:00-3:00 PM today) for the 'authentication' service."
- **Error Timeline**: "Find logs with error severity during the incident timeframe (May 23, 10:00-11:00 AM)."
- **Authentication Issues**: "Find authentication failures or timeout errors during the incident using `logsQuery`."

## 🔎 Example Queries

Here are some example queries you can use with the OTEL MCP Server tools:

---

## 🤖 LLM Prompt Library

A collection of ready-to-use prompts for LLMs and users, designed for the OTEL MCP Server and Windsurf. All prompts use real Elasticsearch data (no sampling or mock data) and support tree structure, filtering, and pagination where relevant.

### Service Discovery
- **List all services:**
  ```javascript
  mcp0_servicesGet({})
  ```
- **Find services matching a pattern:**
  ```javascript
  mcp0_servicesGet({ "search": "cart*" })
  ```
- **List services with a specific version:**
  ```javascript
  mcp0_servicesGet({ "version": "2.0.*" })
  ```

### Trace Queries
- **Find all error traces in the last hour:**
  ```javascript
  mcp0_tracesQuery({
    "query": {
      "search": "@timestamp:[now-1h TO now] AND status.code:ERROR",
      "size": 100
    }
  })
  ```
- **Find all traces for the checkout service:**
  ```javascript
  mcp0_tracesQuery({
    "query": {
      "search": "service.name:checkout",
      "size": 100
    }
  })
  ```

### Metric Queries
- **Find high CPU usage metrics:**
  ```javascript
  mcp0_metricsQuery({
    "query": {
      "search": "metric.name:system.cpu.usage AND metric.value:>0.8",
      "size": 10
    }
  })
  ```
- **Get all latency metrics for payment service:**
  ```javascript
  mcp0_metricsQuery({
    "query": {
      "search": "service.name:payment AND name:*latency*",
      "size": 100
    }
  })
  ```

### Log Queries
- **Find all error logs for the cart service:**
  ```javascript
  mcp0_logsQuery({
    "query": {
      "search": "service.name:cart AND severity_text:ERROR",
      "size": 100
    }
  })
  ```
- **Find logs with authentication failures:**
  ```javascript
  mcp0_logsQuery({
    "query": {
      "search": "authentication failure",
      "size": 50
    }
  })
  ```

### Service Dependency & Architecture
- **Show the service dependency tree for all services in the last 24 hours:**
  ```javascript
  mcp0_serviceArchitectureMap({
    "startTime": "2025-05-27T00:00:00Z",
    "endTime": "2025-05-28T00:00:00Z",
    "format": "full"
  })
  ```
- **Show only high-traffic relationships (minCallCount = 100):**
  ```javascript
  mcp0_serviceArchitectureMap({
    "startTime": "2025-05-27T00:00:00Z",
    "endTime": "2025-05-28T00:00:00Z",
    "format": "full",
    "minCallCount": 100
  })
  ```
- **Paginate through the service dependency tree:**
  ```javascript
  mcp0_serviceArchitectureMap({
    "startTime": "2025-05-27T00:00:00Z",
    "endTime": "2025-05-28T00:00:00Z",
    "format": "summary",
    "page": 2,
    "pageSize": 10
  })
  ```

### Root Cause Analysis & Troubleshooting
- **Incident investigation for a specific time window:**
  ```javascript
  mcp0_tracesQuery({
    "query": {
      "search": "@timestamp:[2025-05-27T14:00:00Z TO 2025-05-27T15:00:00Z] AND status.code:ERROR",
      "size": 100
    }
  })
  ```
- **Find slow spans in payment and checkout services:**
  ```javascript
  mcp0_tracesQuery({
    "query": {
      "search": "service.name:(payment OR checkout) AND duration_ms:>1000",
      "size": 100
    }
  })
  ```
- **Find authentication errors and correlate with logs:**
  ```javascript
  mcp0_logsQuery({
    "query": {
      "search": "authentication failure OR auth error",
      "size": 100
    }
  })
  ```

---

### Service Discovery

```javascript
// Get all services with names starting with "front"
mcp0_servicesGet({
  "search": "front*"
})

// Get all services with version 2.0.2
mcp0_servicesGet({
  "version": "2.0.2"
})

// Get all services with names containing "end" and versions starting with "v"
mcp0_servicesGet({
  "search": "*end*",
  "version": "v*"
})

// Get all services within a specific time range
mcp0_servicesGet({
  "startTime": "2025-05-26T15:00:00Z",
  "endTime": "2025-05-26T16:00:00Z"
})
```

### Trace Queries

```javascript
// Query for traces with errors in the payment service
mcp0_tracesQuery({
  "query": {
    "query": {
      "bool": {
        "must": [
          { "term": { "service.name": "payment" } },
          { "term": { "status.code": "ERROR" } }
        ]
      }
    },
    "size": 10,
    "sort": [{ "@timestamp": "desc" }]
  }
})
```

### Log Queries

```javascript
// Query for error logs in the checkout service
mcp0_logsQuery({
  "query": {
    "query": {
      "bool": {
        "must": [
          { "term": { "service.name": "checkout" } },
          { "term": { "severity.text": "ERROR" } }
        ]
      }
    },
    "size": 10,
    "sort": [{ "@timestamp": "desc" }]
  }
})
```

### Metric Queries

```javascript
// Query for high CPU usage metrics
mcp0_metricsQuery({
  "query": {
    "query": {
      "bool": {
        "must": [
          { "term": { "metric.name": "system.cpu.usage" } },
          { "range": { "metric.value": { "gt": 0.8 } } }
        ]
      }
    },
    "size": 10,
    "sort": [{ "@timestamp": "desc" }]
  }
})
```

## 🔍 Field Discovery Examples

The field discovery tools help you understand the data structure to build effective queries:

### Trace Field Discovery

```javascript
// Find duration-related trace fields in the checkout service
mcp0_traceFieldsGet({
  "search": "duration",
  "service": "checkout"
})

// Get all trace fields across multiple services
mcp0_traceFieldsGet({
  "services": ["payment", "inventory", "shipping"]
})
```

### Log Field Discovery

```javascript
// Find error-related log fields
mcp0_logFieldsGet({
  "search": "error"
})

// Get log fields specific to the payment service
mcp0_logFieldsGet({
  "service": "payment"
})
```

### Metric Field Discovery

```javascript
// Find CPU-related metric fields
mcp0_metricsFieldsGet({
  "search": "cpu"
})

// Get metric fields across multiple services
mcp0_metricsFieldsGet({
  "services": ["payment", "inventory", "shipping"]
})
```

### Service Discovery

```javascript
// Get all available services
mcp0_servicesGet({})

// Find services matching a pattern
mcp0_servicesGet({
  "search": "payment"
})

```

## 🔍 Advanced Query Capabilities

All query tools (`logsQuery`, `tracesQuery`, `metricsQuery`) support powerful query capabilities through various parameters that map directly to Elasticsearch's native functionality.

### Logical Operators

- `AND`: Require all conditions to match (default operator)
- `OR`: Match any of the conditions
- `NOT`: Exclude results that match a condition
- Parentheses `()`: Group conditions for complex logic

### Field-Specific Searches

Use the `field:value` syntax to search specific fields:

```javascript
// Search for errors in the frontend service
mcp0_logsQuery({
  "search": "severity_text:ERROR AND resource.attributes.service.name:frontend"
})
```

### Time Range Queries

Use range syntax for time-based queries:

```javascript
// Search for errors in the last hour
mcp0_logsQuery({
  "search": "@timestamp:[now-1h TO now] AND severity_text:ERROR"
})

// Search for high latency spans in a specific time window
mcp0_tracesQuery({
  "search": "@timestamp:[2025-05-27T00:00:00Z TO 2025-05-27T04:00:00Z] AND duration>1000000"
})
```

### Wildcards and Regular Expressions

Use wildcards for partial matching:

```javascript
// Search for metrics with names containing 'latency'
mcp0_metricsQuery({
  "search": "name:*latency*"
})

// Search for HTTP-related spans
mcp0_tracesQuery({
  "search": "attributes.http.*:* AND service.name:frontend"
})
```

### Numeric Comparisons

Use comparison operators for numeric fields:

```javascript
// Find high-value metrics
mcp0_metricsQuery({
  "search": "metric.value>100 AND service.name:cart"
})

// Find slow spans
mcp0_tracesQuery({
  "search": "duration>5000000 AND name:*checkout*"
})
```

### Example Test Queries

```javascript
// Check available services
mcp0_servicesGet({})

// Find available trace fields
mcp0_traceFieldsGet({})

// Query for recent traces
mcp0_tracesQuery({
  "query": {
    "query": { "match_all": {} },
    "size": 10,
    "sort": [{ "@timestamp": "desc" }]
  }
})

// Using the simplified search parameter with logical query
mcp0_logsQuery({
  "search": "severity_text:ERROR AND resource.attributes.service.name:load-generator",
  "size": 5
})
```

### Advanced Elasticsearch Parameters

All query tools now support additional Elasticsearch parameters for more advanced use cases:

#### Result Tracking and Pagination

```javascript
// Get accurate hit counts for large result sets
mcp0_logsQuery({
  "search": "severity_text:ERROR",
  "track_total_hits": true
})

// Efficient pagination through large result sets
// First query to get initial results and sort values
const initialResults = await mcp0_tracesQuery({
  "search": "duration>1000000",
  "size": 10,
  "sort": [{"duration": "desc"}, {"@timestamp": "desc"}]
});

// Follow-up query using search_after with the sort values from the last result
mcp0_tracesQuery({
  "search": "duration>1000000",
  "size": 10,
  "sort": [{"duration": "desc"}, {"@timestamp": "desc"}],
  "search_after": initialResults.hits.hits[initialResults.hits.hits.length-1].sort
})
```

#### Performance and Timeout Controls

```javascript
// Set a timeout to prevent long-running queries
mcp0_metricsQuery({
  "search": "name:*latency*",
  "timeout": "5s"
})
```

#### Result Highlighting and Deduplication

```javascript
// Highlight search terms in results
mcp0_logsQuery({
  "search": "error",
  "highlight": {
    "fields": {
      "body": {},
      "message": {}
    },
    "pre_tags": ["<mark>"],
    "post_tags": ["</mark>"]
  }
})

// Deduplicate results by collapsing on a field
mcp0_tracesQuery({
  "search": "error",
  "collapse": {
    "field": "service.name"
  }
})
```
## 🔎 Error Handling

All tools in the OTEL MCP Server provide structured error responses when issues occur. This makes it easier to diagnose and fix problems programmatically.

### Error Response Format

When an error occurs, tools return a consistent JSON structure:

```json
{
  "error": true,
  "type": "ElasticsearchDataError",
  "message": "Error accessing trace data: index_not_found_exception",
  "params": {
    "query": { /* original query parameters */ }
  }
}
```

This structured approach provides several benefits:

- **Programmatic Error Handling**: Clients can easily parse errors and handle them programmatically
- **Improved Diagnostics**: The detailed error information makes it easier to diagnose and fix issues
- **Consistent User Experience**: All tools handle errors in a consistent way

## 💻 Conclusion

The OTEL MCP Server provides a streamlined approach to querying OpenTelemetry data in Elasticsearch. By focusing on direct query capabilities and field discovery, it offers maximum flexibility while maintaining a simple, consistent interface.

Key advantages:

- **Direct Access**: Transparent access to Elasticsearch data without hiding query complexity
- **Flexibility**: Full control over queries for maximum customization
- **Discovery Support**: Tools to help understand the available data structure
- **Minimal Abstraction**: No high-level abstractions that hide the underlying data model
- **Consistent Error Handling**: Structured error responses across all tools

## 🔄 Adaptive Tool Registration

The OTEL MCP Server automatically adapts to the available data in your Elasticsearch instance:

- If trace data is available, trace query tools (`tracesQuery`, `traceFieldsGet`) are registered
- If metric data is available, metric query tools (`metricsQuery`, `metricsFieldsGet`) are registered
- If log data is available, log query tools (`logsQuery`, `logFieldsGet`, `findLogs`) are registered

This ensures that you only see tools that will work with your available data. If a particular telemetry type is not available, the corresponding tools will not be registered, preventing you from attempting to use tools that would fail.

## 🧪 Testing with the OTEL Demo

The OTEL MCP Server has been extensively tested with the official [OpenTelemetry Demo](https://github.com/open-telemetry/opentelemetry-demo) application, which provides a realistic microservices environment with complete telemetry data.

### Kubernetes Setup

1. **Deploy the OpenTelemetry Demo** using Helm:
   ```bash
   # Add the OpenTelemetry Helm repository
   helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
   helm repo update
   
   # Create namespace for the demo
   kubectl create namespace opentelemetry-demo
   
   # Install the OpenTelemetry Demo using Helm
   helm install opentelemetry-demo open-telemetry/opentelemetry-demo \
     -n opentelemetry-demo \
     --values demo/otel-demo-values.yaml
   ```

2. **Configure the OTEL Collector** using the provided values file:
   ```bash
   # The demo/otel-demo-values.yaml file already contains the necessary configuration:
   # - Elasticsearch exporter with OTEL mapping mode
   # - Proper pipeline configuration for traces, metrics, and logs
   # - Kubernetes attribute processors
   
   # If you need to update the Elasticsearch endpoint, modify the values file:
   sed -i 's|endpoint: http://elasticsearch-master:9200|endpoint: http://elasticsearch.elastic.svc.cluster.local:9200|g' demo/otel-demo-values.yaml
   
   # Update the OpenTelemetry Demo with the modified values
   helm upgrade opentelemetry-demo open-telemetry/opentelemetry-demo \
     -n opentelemetry-demo \
     --values demo/otel-demo-values.yaml
   ```
   
   The provided values file includes comprehensive configuration for the OpenTelemetry Collector, including:
   - Elasticsearch exporter with OTEL mapping mode
   - Kubernetes attributes extraction
   - Resource processors
   - Memory limiters and batch processors
   - Proper service pipelines for all telemetry types

3. **Deploy Elasticsearch** using the provided manifests:
   ```bash
   # Create namespace for Elasticsearch
   kubectl create namespace elastic
   
   # Apply the Elasticsearch manifests
   kubectl apply -f demo/elasticsearch-manifests/elasticsearch-service.yaml
   kubectl apply -f demo/elasticsearch-manifests/elasticsearch-statefulset.yaml
   kubectl apply -f demo/elasticsearch-manifests/elasticsearch-templates-configmap.yaml
   kubectl apply -f demo/elasticsearch-manifests/elasticsearch-setup-job.yaml
   
   # For a complete setup with security (optional)
   # kubectl apply -f demo/elasticsearch-manifests/elasticsearch-certs.yaml
   # kubectl apply -f demo/elasticsearch-manifests/elasticsearch-credentials.yaml
   ```
   
   These manifests provide a production-ready Elasticsearch setup with:
   - Properly configured StatefulSet for data persistence
   - Kubernetes Services for access
   - Index templates optimized for OpenTelemetry data
   - Optional security configuration

4. **Connect with OTEL MCP Server**:
   ```bash
   # Port-forward Elasticsearch service to your local machine
   kubectl port-forward -n elastic svc/elasticsearch 9200:9200 &
   
   # Run OTEL MCP Server with the forwarded Elasticsearch URL
   ELASTICSEARCH_URL=http://localhost:9200 npx -y otel-mcp-server
   ```

   Or use the configuration for your LLM tool at the start of this readme.
   
5. **Verify the connection** by checking available services:
   ```javascript
   // Using the MCP Inspector or Windsurf, run:
   mcp0_servicesGet({})
   ```
   
   You should see the OpenTelemetry Demo services listed in the response, confirming that the OTEL MCP Server is successfully connected to Elasticsearch and retrieving telemetry data.

4. **Connect your MCP client** (e.g., Windsurf) to start querying the data

### Elasticsearch Compatibility

- **Version Support**: Tested with Elasticsearch 8.x (8.12+ recommended for OTEL mapping mode)
- **Index Patterns**: The server looks for `.ds-traces-*`, `.ds-metrics-*`, and `.ds-logs-*` indices
- **Mapping Modes**: Supports both OTEL native mapping (recommended) and ECS mapping

### Example Queries for OTEL Demo

Once you have the demo running, try these queries to explore the data:

```javascript
// List all services in the demo
mcp0_servicesGet({})

// Find checkout service traces with errors
mcp0_tracesQuery({
  "query": {
    "query": {
      "bool": {
        "must": [
          { "term": { "Resource.service.name": "checkout" } },
          { "term": { "status.code": "ERROR" } }
        ]
      }
    }
  }
})

// Get CPU usage metrics for the frontend service
mcp0_metricsQuery({
  "query": {
    "query": {
      "bool": {
        "must": [
          { "term": { "Resource.service.name": "frontend" } },
          { "term": { "metric.name": "system.cpu.usage" } }
        ]
      }
    }
  }
})
```

**Note:** For production environments, enable Elasticsearch security features with proper authentication and encryption.

## 🚢 Deployment & Orchestration Notes

**Note:** OTEL MCP Server is a stdio-based process. It is not meant to be deployed as a long-running HTTP/gRPC service. Instead, it should be launched by an MCP-compatible orchestrator (such as Windsurf, MCP Inspector, or another MCP tool) or run directly in your shell for local testing.

- For most use cases, run the server locally with:
  ```bash
  npm start
  ```
- If containerizing, run it as a foreground process and connect its stdio to your orchestrator.
- Do **not** deploy as a background service or expose as an HTTP endpoint (unless you have added a transport for that purpose).

### Error Handling

The server implements structured error handling for all tools. If a tool encounters an error, it will return a response with the following structure:

```json
{
  "error": true,
  "type": "ErrorType",
  "message": "Detailed error message",
  "params": {
    // Original parameters that caused the error
  }
}
```

This makes it easier to debug issues and provide meaningful feedback to users.

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
## 🔍 Debugging

Set the `DEBUG=1` environment variable to enable detailed logging:

```bash
DEBUG=1 npm start
```

This will show:
- Request/response headers
- Full request/response bodies
- Elasticsearch query details
- Error stack traces

## 🔎 Error Handling

All tools return structured error responses when issues occur. For example:

```json
{
  "error": true,
  "type": "ElasticsearchDataError",
  "message": "Error accessing trace data: index_not_found_exception",
  "params": {
    "query": { "match_all": {} }
  }
}
```
- Detailed error messages
- Connection details

## 💬 Contributing

Contributions to the OTEL MCP Server are welcome! If you'd like to contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 🔒 License

Built with ❤️ for the OpenTelemetry community!

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Integration

You can pipe commands to the server:
```bash
echo "query traces '{\"timeRange\": {\"start\": \"2023-01-01T00:00:00Z\", \"end\": \"2023-01-02T00:00:00Z\"}}'" | npm start
```

## Building for Production

To build the TypeScript code to JavaScript:
```bash
npm run build
```

The built files will be in the `dist` directory.

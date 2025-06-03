# AI-Powered OpenTelemetry Analysis

## 🚀 Transform Your Observability Data into Actionable Intelligence

**Stop drowning in dashboards. Start having conversations with your telemetry data.**

Modern applications generate massive amounts of observability data through OpenTelemetry - traces, metrics, and logs that contain the answers to every operational question. But finding those answers requires navigating complex query languages, building custom dashboards, and manually correlating signals across different data types.

What if you could just ask?

This MCP server bridges the gap between AI assistants and your OpenTelemetry data, enabling natural language interactions with your entire observability stack:

- **"Show me all errors in the payment service from the last hour"** - The AI queries your traces and logs, finding patterns you might have missed
- **"Why is the checkout service slow?"** - Get instant analysis of latency patterns, bottlenecks, and anomalies
- **"What changed in my system between 2pm and 3pm yesterday?"** - Compare metrics, identify anomalies, and correlate events across services
- **"Find the root cause of the authentication failures"** - Let AI trace error propagation through your distributed system

## 📡 What is OpenTelemetry?

[OpenTelemetry](https://opentelemetry.io/) (OTEL) is the industry-standard framework for collecting and managing telemetry data from your applications. It provides a vendor-neutral way to instrument, generate, collect, and export telemetry data.

### The Three Pillars of Observability

OpenTelemetry captures three essential types of telemetry data:

**[Traces](https://opentelemetry.io/docs/concepts/signals/traces/)**
- Track requests as they flow through distributed systems
- Show the complete journey of a transaction across multiple services
- Include timing, status, and contextual information for each step
- Example: Following a user's checkout process from frontend → cart service → payment service → notification service

**[Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/)**
- Numerical measurements of system behavior over time
- Include counters, gauges, and histograms
- Track resource usage, business KPIs, and performance indicators
- Example: CPU usage, request latency percentiles, items sold per minute

**[Logs](https://opentelemetry.io/docs/concepts/signals/logs/)**
- Structured records of discrete events
- Include timestamps, severity levels, and contextual attributes
- Can be correlated with traces and metrics for full context
- Example: Error messages, audit trails, debugging information

### Why OpenTelemetry Matters

Traditional monitoring tools often lock you into proprietary formats. OpenTelemetry breaks these silos by:

1. **Vendor Neutrality**: Collect once, send anywhere - works with [Elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/current/elasticsearch-intro.html), [OpenSearch](https://opensearch.org/docs/latest/), [Jaeger](https://www.jaegertracing.io/), [Prometheus](https://prometheus.io/), and more
2. **Unified Collection**: Single instrumentation for all telemetry types
3. **Automatic Context**: Built-in correlation between traces, metrics, and logs
4. **Industry Standard**: Backed by the [Cloud Native Computing Foundation](https://www.cncf.io/)

### How This Server Enhances OpenTelemetry

While OpenTelemetry solves data collection, analyzing that data still requires expertise. This MCP server makes your OpenTelemetry data conversational:

- **No Query Language Required**: Ask questions in plain English instead of writing complex queries
- **Cross-Signal Correlation**: AI automatically correlates traces, metrics, and logs
- **Pattern Recognition**: Discover anomalies and trends you might miss manually
- **Contextual Understanding**: AI understands service relationships and dependencies

Learn more:
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OTEL Collector Configuration](https://opentelemetry.io/docs/collector/configuration/)
- [Instrumenting Your Application](https://opentelemetry.io/docs/instrumentation/)
- [OpenTelemetry Demo Application](https://opentelemetry.io/docs/demo/)

## 💡 Why This Matters

Traditional observability tools excel at collecting and storing data, but they still require human expertise to extract insights. By connecting AI directly to your telemetry data, you get:

### Instant Incident Response
When an outage hits at 3am, you don't have time to craft complex queries. Ask the AI to investigate error patterns, trace failures through your system, and identify the root cause - all in natural language.

### Proactive Problem Detection
Instead of setting up hundreds of static alerts, let AI continuously analyze your data for anomalies. Ask questions like "Are there any unusual patterns in today's traffic?" and get intelligent analysis based on historical baselines.

### Democratized Observability
Not everyone on your team is a query expert. With natural language access, developers, SREs, and even product managers can explore system behavior without learning complex query languages.

### Context-Aware Development
While reviewing code or designing features, developers can instantly check how similar code performs in production, what errors it generates, and how it impacts system performance.

## 🎯 Real-World Use Cases

### During Incidents
- "Find all traces with errors in the authentication flow"
- "Show me service dependency failures in the last 30 minutes"
- "Which services are experiencing elevated latency?"

### Performance Analysis
- "Identify the slowest operations in the checkout service"
- "Compare today's CPU usage with last week's baseline"
- "Find memory leaks in the cart service"

### System Understanding
- "Map out all service dependencies"
- "Show me the critical path for order processing"
- "Which services communicate with the payment gateway?"

### Anomaly Detection
- "Find unusual log patterns in the last hour"
- "Detect metric anomalies across all services"
- "Show me rare error messages that started appearing today"

## 🛠️ How It Works

This server implements the Model Context Protocol (MCP), providing AI assistants with a structured interface to your OpenTelemetry data stored in Elasticsearch/OpenSearch. When you ask a question, the AI:

1. Understands your intent and identifies relevant data types (traces, metrics, or logs)
2. Constructs appropriate queries using the provided tools
3. Analyzes the results and presents insights in natural language
4. Can perform follow-up queries to dive deeper into issues

## ⚡ Quick Start

### For Windsurf/Claude Desktop Users

Add this to your MCP settings:

```json
{
  "mcpServers": {
    "otel-mcp-server": {
      "command": "npx",
      "args": ["-y", "otel-mcp-server"],
      "env": {
        "OPENSEARCH_URL": "http://localhost:9200",
        "USERNAME": "elastic",
        "PASSWORD": "changeme",
        "OPENAI_API_KEY": "sk-..."  // Optional: for ML-powered features
      }
    }
  }
}
```

Note: You can use either `ELASTICSEARCH_URL` or `OPENSEARCH_URL` - both work.

### For Developers

```bash
# Clone and install
git clone https://github.com/ryanwith/melchi.git
cd melchi
npm install

# Configure your connection
cp .env.example .env
# Edit .env with your Elasticsearch details

# Build and run
npm run build

# Integrate with your MCP client using a direct node command to run dist/server.js
```

## 📊 Available Capabilities

### Query Tools
- **Direct Queries**: Execute Elasticsearch queries for traces, metrics, and logs
- **Service Discovery**: List and search for services in your system
- **Field Discovery**: Explore available fields with wildcard support (e.g., "*.error", "span.*")

### Analysis Tools
- **Anomaly Detection**: Find outliers in metrics, traces, and log patterns
- **Service Topology & Dependency Mapping**: 
  - Discover service relationships from OpenTelemetry span parent-child relationships
  - Detailed latency statistics per dependency (avg, min, max, p50, p95, p99)
  - Error rates and success rates for each service connection
  - Throughput metrics (calls per minute) between services
  - Visualization-ready data with node sizes, edge widths, and color coding
  - Automatic identification of critical services and bottlenecks
- **Time Series Analysis**: Detect trends, seasonality, and anomalies in metrics
- **Health Summaries**: Get instant system health reports with bottleneck identification

### Correlation Tools
- **Error Propagation**: Trace errors through your distributed system
- **Incident Analysis**: Correlate logs, metrics, and traces during outages
- **Performance Profiling**: Identify slow operations and resource bottlenecks

## 🔧 Example Interactions

### Analyzing Service Dependencies
```
You: "Show me service dependencies with high latency"

AI: I'll analyze service dependencies and their performance metrics.

[AI executes dependency analysis and returns]:
Found 15 service dependencies. Here are the critical ones:

1. checkout-service → payment-service
   - Average latency: 450ms (95th percentile: 1200ms)
   - Error rate: 2.3%
   - Call volume: 1,250 calls/minute
   
2. frontend → recommendation-service  
   - Average latency: 890ms (95th percentile: 2100ms)
   - Error rate: 0.5%
   - Call volume: 3,400 calls/minute
   - ⚠️ This is a bottleneck - high latency affecting user experience

The recommendation service is your primary bottleneck, with p95 latency over 2 seconds.
```

### Finding Performance Issues
```
You: "Why is the checkout service slow today?"

AI: I'll analyze the checkout service performance. Let me:
1. Check for latency anomalies
2. Identify slow operations
3. Look for error patterns

[AI executes queries and returns]:
The checkout service is experiencing 3x normal latency on the payment-processing operation. 
This started at 2:15 PM and correlates with increased error rates from the payment gateway.
The service is timing out after 5 seconds, causing cascading failures.
```

### Investigating Errors
```
You: "Find all authentication failures in the last hour"

AI: I'll search for authentication failures across logs and traces.

[AI executes queries and returns]:
Found 847 authentication failures in the last hour:
- 92% are "invalid token" errors from the mobile app (v2.3.1)
- Failures spike every 15 minutes, suggesting a token refresh issue
- All failures originate from 3 specific API endpoints
- The pattern started after the 1:30 PM deployment
```

## 🌟 Key Benefits

### Speed of Investigation
- Reduce MTTR from hours to minutes
- No need to context-switch between multiple tools
- Instant correlation across data types

### Lower Barrier to Entry
- New team members can investigate issues immediately
- No query language expertise required
- Natural language is the only interface needed

### Proactive Insights
- AI can spot patterns humans might miss
- Continuous analysis without manual intervention
- Historical comparisons and trend detection

### Unified Interface
- One conversation thread for entire investigations
- No need to jump between dashboards
- Context preserved throughout the analysis

## 🚀 Getting Started with Real Data

### Using the OpenTelemetry Demo

Test with realistic microservices data:

```bash
# Deploy the OTEL demo with Kubernetes
kubectl create namespace otel-demo
helm install demo open-telemetry/opentelemetry-demo -n otel-demo --values demo/otel-demo-values.yaml

# Port-forward OpenSearch
kubectl port-forward -n elastic svc/opensearch 9200:9200

# Start your MCP Client with the following environment variables:
# OPENSEARCH_URL=http://localhost:9200
```

### Try These Queries

Once connected, explore your data:
- "Show me all available services"
- "Find errors in the frontend service"
- "Analyze checkout service latency patterns"
- "Detect anomalies in CPU usage"
- "Map service dependencies with latency metrics"
- "Show me the slowest service connections"
- "Which services have the highest error rates?"
- "Identify bottlenecks in the service topology"

## 📚 Advanced Features

### ML-Powered Analysis (Requires OpenAI API Key)
- **Semantic log search**: Find similar error patterns using embeddings
- **Automatic trace clustering**: Group similar issues together
- **Time series forecasting**: Predict future metric trends

To enable ML features, set the `OPENAI_API_KEY` environment variable.

### Intelligent Correlation
- Automatic correlation of traces, metrics, and logs
- Service dependency tracking with error propagation analysis
- Root cause analysis across distributed transactions

### Flexible Deployment
- Works with Elasticsearch 7.x/8.x and OpenSearch
- Supports both OTEL and ECS mapping modes
- Adapts to available data types automatically

## 🤝 Contributing

We welcome contributions! The greatest contribution is to try it out, and file issues according to the contribution guidelines. For direct contributions, whether it's adding new analysis tools, improving query capabilities, or enhancing documentation, your input helps make observability more accessible to everyone.

## 📄 License

MIT License - Built with ❤️ for the OpenTelemetry community

---

**Ready to transform how you interact with observability data?** Start having conversations with your telemetry today.
# Elasticsearch Data Stream Setup

This directory contains Kubernetes manifests for automatically setting up Elasticsearch index templates and data streams for OpenTelemetry data.

## Components

1. **elasticsearch-templates-configmap.yaml**: ConfigMap containing:
   - The OpenTelemetry index templates JSON configuration
   - A setup script that creates the index templates and data streams

2. **elasticsearch-setup-job.yaml**: Kubernetes Job that:
   - Runs after Elasticsearch is deployed
   - Waits for Elasticsearch to be ready
   - Creates the necessary index templates and data streams
   - Uses Alpine Linux with curl and jq for JSON processing

3. **elasticsearch-master-credentials.yaml**: Secret containing:
   - The Elasticsearch username and password for authentication
   - This secret is already created as part of the Elasticsearch deployment

## Usage

1. Apply the manifests in the following order:
   ```bash
   kubectl apply -f elasticsearch-templates-configmap.yaml
   kubectl apply -f elasticsearch-setup-job.yaml
   ```

   Note: The `elasticsearch-master-credentials` secret should already exist from the Elasticsearch deployment.

3. Check the job status:
   ```bash
   kubectl get jobs elasticsearch-setup
   kubectl logs job/elasticsearch-setup
   ```

## Data Streams Created

The job automatically creates the following data streams:
- `logs-generic-default`: For OpenTelemetry logs
- `metrics-generic.otel-default`: For OpenTelemetry metrics
- `traces-generic-default`: For OpenTelemetry traces

## Index Templates Created

The job creates three index templates:
- `logs-otel`: Template for log data
- `metrics-otel`: Template for metric data
- `traces-otel`: Template for trace data

Each template includes settings for shards and replicas, as well as dynamic mappings for resource attributes and other attributes.

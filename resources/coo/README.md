# Cluster Observability Operator (COO) Integration

This directory contains resources to deploy the Red Hat OpenShift Cluster Observability Operator for monitoring Service Mesh 3 traffic as an alternative to Kiali.

## Overview

The Cluster Observability Operator provides a way to deploy and manage Prometheus-based monitoring stacks that can scrape metrics from the Istio service mesh. This enables viewing service mesh traffic metrics directly in the OpenShift console or via a dedicated Prometheus UI.

## Prerequisites

- OpenShift 4.14+
- Service Mesh 3 deployed (traditional sidecar mode)

## Installation

### Step 1: Install the COO Operator

```bash
oc apply -f resources/coo/subscription.yaml
```

Wait for the operator to be ready:
```bash
until oc get pods -n openshift-cluster-observability-operator | grep -E "observability.*Running"; do
  echo "Waiting for COO operator..."
  sleep 10
done
```

### Step 2: Label Service Mesh Namespaces

Label the namespaces you want to monitor:
```bash
oc label namespace istio-system monitoring.rhobs/stack=service-mesh
oc label namespace istio-ingress monitoring.rhobs/stack=service-mesh
oc label namespace bookinfo monitoring.rhobs/stack=service-mesh
oc label namespace rest-api-with-mesh monitoring.rhobs/stack=service-mesh
```

### Step 3: Deploy the MonitoringStack

```bash
oc apply -k resources/coo
```

### Step 4: Expose Prometheus UI (Optional)

```bash
oc expose svc service-mesh-monitoring-prometheus -n coo-service-mesh --name=prometheus-coo
echo "Prometheus UI: http://$(oc get route prometheus-coo -n coo-service-mesh -o jsonpath='{.spec.host}')"
```

## What Gets Deployed

| Resource | Namespace | Purpose |
|----------|-----------|---------|
| MonitoringStack | coo-service-mesh | Deploys Prometheus + Alertmanager |
| PodMonitor (istio-proxies) | coo-service-mesh | Scrapes Envoy sidecar metrics |
| ServiceMonitor (istiod) | coo-service-mesh | Scrapes Istiod control plane metrics |
| UIPlugin (distributed-tracing) | cluster-scoped | Adds **Observe → Traces** to console |
| UIPlugin (logging) | cluster-scoped | Adds **Observe → Logs** to console |

## Available Metrics

### Istio Traffic Metrics (from sidecars)
- `istio_requests_total` - Total requests by source/destination
- `istio_request_duration_milliseconds` - Request latency histogram
- `istio_request_bytes` / `istio_response_bytes` - Request/response sizes
- `istio_tcp_connections_opened_total` / `istio_tcp_connections_closed_total` - TCP connections

### Istiod Control Plane Metrics
- `pilot_info` - Istiod version and build info
- `pilot_xds_pushes` - Config push count to proxies
- `pilot_xds_push_time` - Config push latency
- `pilot_conflict_inbound_listener` / `pilot_conflict_outbound_listener_tcp_over_current_tcp` - Configuration conflicts

## Example Queries

### Request Rate by Service
```promql
sum(rate(istio_requests_total{reporter="destination"}[5m])) by (destination_service_name)
```

### Error Rate
```promql
sum(rate(istio_requests_total{response_code=~"5.*"}[5m])) / sum(rate(istio_requests_total[5m]))
```

### P99 Latency
```promql
histogram_quantile(0.99, sum(rate(istio_request_duration_milliseconds_bucket{reporter="destination"}[5m])) by (le, destination_service_name))
```

## Viewing in OpenShift Console

Once deployed, you can:
1. Go to **Observe → Metrics** in the OpenShift Console
2. Select the `coo-service-mesh` namespace from the dropdown (if using namespace-scoped queries)
3. Use the PromQL queries above to visualize service mesh traffic

Alternatively, access the dedicated Prometheus UI via the exposed route.

## UI Plugins

### Distributed Tracing Plugin

The distributed tracing UI plugin adds **Observe → Traces** to the OpenShift Console. It automatically discovers TempoStack instances in the cluster.

**Requirements for COO Tracing Plugin:**
- TempoStack must have gateway enabled with a route
- RBAC for the OTEL collector (see `resources/tempootel/otel-collector-rbac.yaml`)
- OpenTelemetry Collector must use bearer token auth and send `X-Scope-OrgID` header matching a tenant name

**Features:**
- View distributed traces from service mesh traffic
- Select time ranges and filter by service, operation, or trace ID
- Visualize request flow through microservices with Gantt charts
- Drill down into individual spans to see attributes

**Usage:**
1. Navigate to **Observe → Traces** in the OpenShift Console
2. Select the TempoStack instance (`sample` in `tracing-system` namespace)
3. Select a tenant (`dev` or `prod`)
4. Set time range and query parameters
5. Click on traces to view detailed span information

### Logging Plugin

The logging UI plugin adds **Observe → Logs** to the OpenShift Console.

**Note:** This plugin requires a LokiStack for full functionality. Without Loki Operator installed, the Logs page will be available but won't show data.

**Features:**
- Query and filter logs across namespaces
- Support for both ViaQ and OpenTelemetry log schemas
- Configurable log limits and timeouts

**To enable full logging functionality:**
1. Install the Loki Operator from OperatorHub
2. Deploy a LokiStack in `openshift-logging` namespace
3. Configure cluster logging to forward logs to Loki

## Documentation

- [Cluster Observability Operator Documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_cluster_observability_operator/1-latest/html-single/installing_red_hat_openshift_cluster_observability_operator/index)
- [UI Plugins Documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_cluster_observability_operator/1-latest/html-single/ui_plugins_for_red_hat_openshift_cluster_observability_operator/index)


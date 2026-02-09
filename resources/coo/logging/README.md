# OpenShift Logging with LokiStack

This directory contains resources to deploy OpenShift Logging with LokiStack for log aggregation and the COO Logging UI plugin.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     All Cluster Nodes                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  Collector  │  │  Collector  │  │  Collector  │  (DaemonSet) │
│  │  (Vector)   │  │  (Vector)   │  │  (Vector)   │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   openshift-logging namespace                    │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      LokiStack                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │  │
│  │  │ Distributor │→ │  Ingester   │→ │ MinIO (Storage) │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │  │
│  │  ┌─────────────┐  ┌─────────────┐                         │  │
│  │  │   Querier   │← │  Gateway    │← Console/API            │  │
│  │  └─────────────┘  └─────────────┘                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│              OpenShift Console → Observe → Logs                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  COO Logging UIPlugin                                      │  │
│  │  - Query logs by namespace, pod, container                 │  │
│  │  - Filter by severity, labels                              │  │
│  │  - Time range selection                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Description |
|-----------|-------------|
| **Loki Operator** | Manages LokiStack instances |
| **Cluster Logging Operator** | Manages log collection and forwarding |
| **LokiStack** | Log storage and query engine |
| **ClusterLogForwarder** | Routes logs to LokiStack |
| **Collectors (Vector)** | DaemonSet that collects logs from nodes |
| **MinIO** | Object storage backend for Loki |

## Prerequisites

- OpenShift 4.14+
- Storage class (gp3-csi) available

## Installation

### Step 1: Install Operators

```bash
# Apply logging operator subscriptions
oc apply -k resources/operators/overlays/logging

# Wait for operators
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/loki-operator -n openshift-operators-redhat --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/cluster-logging -n openshift-logging --timeout=120s

# Also install COO for the Logging UIPlugin (Observe → Logs)
oc apply -k resources/operators/overlays/coo
```

### Step 2: Deploy MinIO Storage

```bash
oc apply -f resources/logging/minio.yaml
oc wait --for=condition=Available deployment/minio -n openshift-logging --timeout=120s

# Create the loki bucket
oc exec -n openshift-logging deploy/minio -- mkdir -p /data/loki
```

### Step 3: Deploy LokiStack

```bash
oc apply -f resources/logging/lokistack.yaml

# Wait for LokiStack to be ready
until oc get lokistack logging-loki -n openshift-logging -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' | grep -q "True"; do
  echo "Waiting for LokiStack..."
  sleep 10
done
```

### Step 4: Deploy ClusterLogForwarder

```bash
oc apply -f resources/logging/clusterlogforwarder.yaml

# Verify collectors are running
oc get pods -n openshift-logging -l app.kubernetes.io/component=collector
```

### Step 5: Update Logging UIPlugin

```bash
cat <<EOF | oc apply -f -
apiVersion: observability.openshift.io/v1alpha1
kind: UIPlugin
metadata:
  name: logging
spec:
  type: Logging
  logging:
    lokiStack:
      name: logging-loki
EOF
```

## Usage

1. Navigate to **Observe → Logs** in the OpenShift Console
2. Select log type: **Application**, **Infrastructure**, or **Audit**
3. Filter by:
   - Namespace
   - Pod name
   - Container name
   - Severity level
   - Custom labels
4. Set time range
5. View log entries with full detail

## Example Queries

### View bookinfo application logs
- Log type: Application
- Namespace: bookinfo

### View service mesh control plane logs
- Log type: Infrastructure  
- Namespace: istio-system

### View logs with errors
- Severity: error

## Log Types

| Type | Description |
|------|-------------|
| **Application** | Logs from user workloads (pods in non-system namespaces) |
| **Infrastructure** | Logs from OpenShift components and system pods |
| **Audit** | API server audit logs (requires additional configuration) |

## Troubleshooting

### No logs appearing
```bash
# Check collector pods
oc get pods -n openshift-logging -l app.kubernetes.io/component=collector

# Check collector logs
oc logs -n openshift-logging -l app.kubernetes.io/component=collector --tail=50

# Check ClusterLogForwarder status
oc get clusterlogforwarder collector -n openshift-logging -o yaml
```

### LokiStack not ready
```bash
# Check LokiStack status
oc get lokistack logging-loki -n openshift-logging -o yaml

# Check Loki pods
oc get pods -n openshift-logging -l app.kubernetes.io/instance=logging-loki
```

## Cleanup

```bash
oc delete -k resources/coo/logging
```


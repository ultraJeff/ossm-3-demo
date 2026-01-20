# Network Observability Demo

This directory contains resources for the Red Hat OpenShift Network Observability Operator demo, showcasing network flow visualization and network policy management.

## Components

### Operators
- **Loki Operator** (`loki-operator-subscription.yaml`) - Stores network flow logs
- **Network Observability Operator** (`netobserv-operator-subscription.yaml`) - Collects and visualizes network flows

### Infrastructure
- **MinIO** (`minio.yaml`) - S3-compatible object storage for Loki
- **LokiStack** (`lokistack.yaml`) - Loki deployment for storing flow logs
- **FlowCollector** (`flowcollector.yaml`) - Main configuration for network flow collection

### Sample Application
The `sample-app/` directory contains a multi-tier application demonstrating network policies:

```
┌─────────────────┐
│    Ingress      │
└────────┬────────┘
         │ ✓ Allowed
         ▼
┌─────────────────┐
│    Frontend     │ ← Traffic Generator
└────────┬────────┘
         │ ✓ Allowed (NetworkPolicy)
         ▼
┌─────────────────┐
│    Backend      │ ← Attacker (BLOCKED)
└────────┬────────┘
         │ ✓ Allowed (NetworkPolicy)
         ▼
┌─────────────────┐
│    Database     │ ← Attacker (BLOCKED)
└─────────────────┘
```

## Installation

### 1. Install Operators
```bash
oc apply -f resources/network-observability/loki-operator-subscription.yaml
oc apply -f resources/network-observability/netobserv-operator-subscription.yaml

# Wait for operators
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/loki-operator -n openshift-operators-redhat --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/netobserv-operator -n openshift-operators --timeout=120s
```

### 2. Deploy Infrastructure
```bash
oc apply -f resources/network-observability/namespace.yaml
oc apply -f resources/network-observability/minio.yaml
oc wait --for=condition=Available deployment/loki-minio -n netobserv --timeout=120s

oc apply -f resources/network-observability/lokistack.yaml
# Wait for LokiStack to be ready
oc wait --for=condition=Ready lokistack/netobserv-loki -n netobserv --timeout=300s

oc apply -f resources/network-observability/flowcollector.yaml
```

### 3. Deploy Sample Application
```bash
oc apply -k resources/network-observability/sample-app
```

## Viewing Network Flows

### OpenShift Console
1. Navigate to **Observe → Network Traffic**
2. View the **Overview** for high-level metrics
3. Use **Traffic Flows** to see individual flows
4. Use **Topology** to visualize communication patterns

### Key Features to Demonstrate

1. **Traffic Flow Visualization**
   - See real-time network flows between pods
   - Filter by namespace, pod, service, or direction

2. **Network Policy Enforcement**
   - Observe allowed vs blocked traffic
   - The "attacker" pod generates blocked flows to backend/database
   - The "traffic-generator" pod shows normal allowed flows

3. **Topology View**
   - Visualize the 3-tier architecture
   - See traffic patterns and volumes

4. **DNS Tracking**
   - View DNS queries from pods
   - Identify external service dependencies

## Network Policies

The demo includes these policies:

| Policy | Description |
|--------|-------------|
| `default-deny-ingress` | Blocks all ingress by default |
| `allow-frontend-ingress` | Allows traffic to frontend from anywhere |
| `allow-backend-from-frontend` | Backend only accepts from frontend pods |
| `allow-database-from-backend` | Database only accepts from backend pods |

## Cleanup

```bash
oc delete -k resources/network-observability/sample-app
oc delete flowcollector cluster
oc delete lokistack netobserv-loki -n netobserv
oc delete -f resources/network-observability/minio.yaml
oc delete namespace netobserv
```

## References

- [Network Observability Documentation](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/network_observability/index)
- [FlowCollector API](https://docs.redhat.com/en/documentation/openshift_container_platform/4.20/html-single/network_observability/index#network-observability-flowcollector-api-specifications_network-observability-operator)


# Operator Subscriptions

This directory contains all operator subscriptions for the OSSM3 demo, organized using Kustomize overlays.

## Structure

```
operators/
├── base/
│   └── loki-operator-namespace.yaml   # Shared by noo and logging
└── overlays/
    ├── core/                          # Required for OSSM3 demo
    │   ├── namespaces.yaml
    │   └── subscriptions.yaml
    ├── coo/                           # Cluster Observability Operator
    │   ├── namespace.yaml
    │   └── subscription.yaml
    ├── noo/                           # Network Observability Operator
    │   ├── loki-operator-subscription.yaml
    │   └── netobserv-operator-subscription.yaml
    └── logging/                       # Cluster logging
        ├── logging-namespace.yaml
        ├── loki-operator-subscription.yaml
        └── cluster-logging-subscription.yaml
```

## Usage

### Install Core Operators (Required)
Installs: Service Mesh 3, Kiali, Tempo, OpenTelemetry

```bash
oc apply -k resources/operators/overlays/core
```

### Install Cluster Observability Operator (Optional)
Adds Observe → Traces/Logs/Dashboards to OpenShift Console

```bash
oc apply -k resources/operators/overlays/coo
```

### Install Network Observability Operators (Optional)
Adds network flow visualization (eBPF-based)

```bash
oc apply -k resources/operators/overlays/noo
```

### Install Logging Operators (Optional)
Adds cluster-wide logging with Loki

```bash
oc apply -k resources/operators/overlays/logging
```

## Wait for Operators

After installing, wait for subscriptions to be ready:

```bash
# Core operators
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/servicemeshoperator3 -n openshift-operators --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/kiali-ossm -n openshift-operators --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/tempo-product -n openshift-tempo-operator --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/opentelemetry-product -n openshift-opentelemetry-operator --timeout=120s

# COO
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/cluster-observability-operator -n openshift-cluster-observability-operator --timeout=120s

# NOO (Network Observability Operator)
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/loki-operator -n openshift-operators-redhat --timeout=120s
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/netobserv-operator -n openshift-operators --timeout=120s

# Logging
oc wait --for=jsonpath='{.status.state}'=AtLatestKnown subscription/cluster-logging -n openshift-logging --timeout=120s
```

## Notes

- **Loki Operator** is shared between noo and logging overlays. If you install both, the second install will simply confirm the existing resources.
- After installing operators, you still need to deploy the corresponding custom resources (e.g., `oc apply -k resources/coo` for MonitoringStack and UIPlugins).

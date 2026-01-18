# Tempo and OpenTelemetry Configuration

This directory contains the configuration for distributed tracing with Tempo and OpenTelemetry, organized with Kustomize overlays for different use cases.

## Overlay Structure

```
tempootel/
├── base/                    # Common resources (MinIO, Telemetry)
│   ├── kustomization.yaml
│   ├── minio.yaml          # MinIO object storage
│   └── istioTelemetry.yaml # Istio tracing configuration
├── overlays/
│   ├── kiali/              # Kiali-optimized (Jaeger UI, no gateway)
│   └── coo/                # COO-optimized (gateway, multi-tenant)
```

## Configuration Options

### Kiali Overlay (`overlays/kiali/`)
**Best for:** Kiali UI tracing integration

- Tempo with **Jaeger UI enabled** (for Kiali tracing view)
- **No gateway** (simpler setup)
- OTEL collector connects directly to Tempo distributor
- No authentication required

```bash
oc apply -k ./resources/tempootel/overlays/kiali
```

### COO Overlay (`overlays/coo/`)
**Best for:** OpenShift Console "Observe → Traces" UI plugin

- Tempo with **gateway enabled** (required for COO UI)
- **RBAC disabled** for simplified access
- OTEL collector uses bearer token authentication
- Requires CA certificate ConfigMap (see setup below)

```bash
# Apply the overlay
oc apply -k ./resources/tempootel/overlays/coo

# Create CA certificate ConfigMap (required for TLS)
oc get configmap openshift-service-ca.crt -n openshift-config-managed -o jsonpath='{.data.service-ca\.crt}' > /tmp/service-ca.crt
oc create configmap tempo-ca --from-file=ca.crt=/tmp/service-ca.crt -n opentelemetrycollector
```

## Architecture

### Kiali Mode
```
Istio Sidecars/Waypoints → OTEL Collector → Tempo Distributor → Tempo
                                                                  ↑
                                                        Kiali UI (Jaeger)
```

### COO Mode
```
Istio Sidecars/Waypoints → OTEL Collector → Tempo Gateway → Tempo
                                  ↑ (bearer token)           ↑
                                                 COO "Observe → Traces" UI
```

## Prerequisites

Both overlays require:
1. `tracing-system` namespace created
2. MinIO deployed and ready
3. Tempo Operator installed

## Viewing Traces

### Kiali Mode
- **Kiali UI**: Open Kiali → Select a service → View Traces tab

### COO Mode
- **OpenShift Console**: Observe → Traces → Select TempoStack 'sample'

## Troubleshooting

Check OTEL collector logs:
```bash
oc logs -n opentelemetrycollector -l app.kubernetes.io/name=otel-collector
```

Check Tempo logs:
```bash
# Kiali mode
oc logs -n tracing-system -l app.kubernetes.io/component=query-frontend

# COO mode
oc logs -n tracing-system -l app.kubernetes.io/component=gateway
```

Verify traces are being received:
```bash
oc port-forward svc/tempo-sample-query-frontend 3200:3200 -n tracing-system
curl http://localhost:3200/api/search
```


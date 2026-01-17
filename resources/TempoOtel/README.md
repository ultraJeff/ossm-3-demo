# Tempo and OpenTelemetry Configuration

This directory contains the configuration for distributed tracing with Tempo and OpenTelemetry.

## Components

- **minio.yaml** - MinIO object storage for Tempo trace data
- **tempo.yaml** - TempoStack deployment with gateway enabled for COO UI integration
- **opentelemetrycollector.yaml** - OpenTelemetry Collector that receives traces from Istio and forwards to Tempo
- **otel-collector-rbac.yaml** - ServiceAccount and ClusterRoleBinding for the OTEL collector
- **istioTelemetry.yaml** - Istio Telemetry configuration to enable tracing

## Architecture

```
Istio Sidecars → OpenTelemetry Collector → TempoStack Gateway → Tempo
                                                    ↑
                                        COO Observe → Traces UI
```

## Setup Notes

### CA Certificate ConfigMap

The OpenTelemetry Collector needs the Tempo gateway's CA certificate for TLS. This certificate
is cluster-specific and must be created manually after deploying TempoStack:

```bash
# Get the service serving CA certificate from the Tempo gateway
oc get secret tempo-sample-gateway-tls -n tracing-system -o jsonpath='{.data.tls\.crt}' | base64 -d > /tmp/tempo-ca.crt

# Create the ConfigMap in the opentelemetrycollector namespace
oc create configmap tempo-ca --from-file=ca.crt=/tmp/tempo-ca.crt -n opentelemetrycollector
```

Alternatively, you can use the cluster's service serving CA:

```bash
# Extract the service serving CA
oc get configmap openshift-service-ca.crt -n openshift-config-managed -o jsonpath='{.data.service-ca\.crt}' > /tmp/service-ca.crt

# Create the ConfigMap
oc create configmap tempo-ca --from-file=ca.crt=/tmp/service-ca.crt -n opentelemetrycollector
```

### Multi-Tenancy

The current configuration uses `X-Scope-OrgID: dev` header for tenant identification.
For production use with multiple tenants, update the header value as needed.

### Viewing Traces

Traces can be viewed in:
1. **COO UI**: OpenShift Console → Observe → Traces (select TempoStack 'sample' from 'tracing-system')
2. **Kiali**: Service mesh topology with trace correlation

## Troubleshooting

Check OTEL collector logs:
```bash
oc logs -n opentelemetrycollector -l app.kubernetes.io/name=otel-collector
```

Check Tempo gateway logs:
```bash
oc logs -n tracing-system -l app.kubernetes.io/component=gateway
```

Verify traces are being received:
```bash
oc port-forward svc/tempo-sample-query-frontend 3200:3200 -n tracing-system
curl http://localhost:3200/api/search
```


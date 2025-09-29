# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is an OpenShift Service Mesh 3 (OSSM3) demonstration repository that showcases a complete service mesh implementation using:
- **OSSM3/Istio** for service mesh capabilities
- **Kiali** for observability and traffic visualization  
- **Tempo** for distributed tracing
- **OpenTelemetry** for telemetry collection
- **Kubernetes Gateway API** for next-generation ingress alongside traditional Istio gateways

The demo includes two sample applications:
1. **Bookinfo** - Classic Istio sample app using traditional Istio Gateway
2. **RestAPI (hello-service)** - Custom REST API using Kubernetes Gateway API

## Architecture

### Namespace Organization
- `tracing-system`: MinIO storage and Tempo for distributed tracing
- `opentelemetrycollector`: OpenTelemetry Collector for telemetry aggregation
- `istio-system`: OSSM3 control plane, Kiali, and OSSMC plugin
- `istio-cni`: Istio CNI components for pod networking
- `istio-ingress`: Both Istio and Gateway API ingress gateways
- `bookinfo`: Bookinfo sample application with traffic generator
- `rest-api-with-mesh`: Custom REST API with canary deployment capabilities

### Key Components
- **Service Mesh**: Uses Istio CNI for pod networking instead of init containers
- **Observability Stack**: Tempo + OpenTelemetry + Kiali + OpenShift monitoring
- **Dual Ingress**: Traditional Istio Gateway alongside Kubernetes Gateway API

## Common Development Tasks

### Infrastructure Setup Commands

**Install all operators:**
```bash
./install_operators.sh
```

**Deploy complete infrastructure (Kiali, Tempo, etc.):**
```bash
./install_ossm3_demo.sh
```

### Bookinfo Demo Commands

**Deploy traditional sidecar mode:**
```bash
./deploy-traditional.sh
```

**Deploy ambient mode:**
```bash
./deploy-ambient.sh
```

**Clean up for mode switching:**
```bash
./cleanup-bookinfo.sh
```

### REST API Testing (Optional)

**Test Gateway API-based REST API:**
```bash
./scripts/test-api.sh
```

**Generate continuous traffic for testing:**
```bash
./scripts/generate-traffic.sh
```

**Perform canary deployment rollout:**
```bash
./scripts/canary-rollout.sh
```

### Accessing Services

**Get Bookinfo application URL:**
```bash
INGRESSHOST=$(oc get route istio-ingressgateway -n istio-ingress -o=jsonpath='{.spec.host}')
echo "http://${INGRESSHOST}/productpage"
```

**Get Kiali dashboard URL:**
```bash
KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}')
echo "https://${KIALI_HOST}"
```

**Test Gateway API endpoints:**
```bash
export GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')
curl -s $GATEWAY/hello | jq
curl -s $GATEWAY/hello-service | jq
```

### Monitoring and Debugging

**Check all component status:**
```bash
oc get pods -n tracing-system
oc get pods -n opentelemetrycollector  
oc get pods -n istio-system
oc get pods -n istio-cni
oc get pods -n istio-ingress
oc get pods -n bookinfo
oc get pods -n rest-api-with-mesh
```

**Verify service mesh readiness:**
```bash
oc wait --for condition=Ready istio/default --timeout 60s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni
```

### Customization Patterns

**Deploy custom application with mesh injection:**
```bash
oc new-project my-app
oc label namespace my-app istio-injection=enabled
oc apply -f ./resources/Monitoring/podMonitor.yaml -n my-app
```

**Apply Gateway API resources:**
```bash
oc apply -k ./resources/gateway
```

**Deploy custom Kustomize applications:**
```bash
oc apply -k ./resources/application/kustomize/overlays/pod
```

## File Structure Notes

- `resources/`: Contains all Kubernetes manifests organized by component
- `ansible/`: Alternative Ansible-based installation approach
- `scripts/`: Utility scripts for testing and traffic generation
- Root shell scripts provide automated installation workflows

## Prerequisites

- OpenShift cluster with sufficient resources (Control Plane: m6a.4xlarge or equivalent)
- Cluster admin privileges for operator installation
- Storage with dynamic provisioning for MinIO/Tempo

## Important Configuration Details

- Uses `istio-injection=enabled` label for mesh inclusion (assumes Istio CR named "default")
- Gateway API must be enabled before installation
- Tempo requires persistent storage (uses MinIO by default)
- Kiali requires cluster role bindings for OpenShift monitoring integration
- Traffic generation runs continuously at 1 request/second when enabled

## OpenShift Server URL

The configured OpenShift server URL is ephemeral and will likely change. Ask the user for the current OpenShift server URL.
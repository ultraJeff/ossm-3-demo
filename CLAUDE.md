# CLAUDE.md

This file provides guidance to Claude (Anthropic) and Cursor when working with code in this repository.

## Project Overview

This is an OpenShift Service Mesh 3 (OSSM3) demonstration repository that showcases a complete service mesh implementation using:
- **OSSM3/Istio** for service mesh capabilities (ambient mode)
- **Kiali** for observability and traffic visualization
- **Tempo** for distributed tracing
- **OpenTelemetry** for telemetry collection
- **Kubernetes Gateway API** for next-generation ingress alongside traditional Istio gateways
- **Red Hat Service Interconnect (Skupper 2.0)** for multi-cluster connectivity

The demo includes two sample applications:
1. **Bookinfo** - Classic Istio sample app using traditional Istio Gateway
2. **RestAPI (hello-service)** - Quarkus-based REST API using Kubernetes Gateway API

## Architecture

### Namespace Organization
- `tracing-system`: MinIO storage and Tempo for distributed tracing
- `opentelemetrycollector`: OpenTelemetry Collector for telemetry aggregation
- `istio-system`: OSSM3 control plane, Kiali, and OSSMC plugin
- `istio-cni`: Istio CNI components for pod networking
- `istio-ingress`: Both Istio and Gateway API ingress gateways
- `ossm-bookinfo`: Bookinfo sample application with traffic generator
- `ossm-restapi`: Quarkus REST API with canary deployment capabilities
- `ztunnel`: Ztunnel proxy for ambient mode L4 processing
- `skupper-site`: Service Interconnect site (multi-cluster scenarios)

### Service Mesh Mode

This repo uses ambient mode for the data plane:

- **Istio profile**: `ambient`
- **Pod containers**: 1/1 (no sidecar injected)
- **Namespace label**: `istio.io/dataplane-mode: ambient`
- **L4 proxy**: Ztunnel per node
- **L7 features**: Requires waypoint proxy
- **Extra CRs**: ZTunnel CR + ztunnel namespace
- **OVN prerequisite**: `routingViaHost: true`

Note: The `istio-ingress` namespace uses `istio-injection=enabled` for the ingress gateway pods, which is separate from the ambient data plane.

### Key Components
- **Service Mesh**: Uses Istio CNI for pod networking instead of init containers
- **Observability Stack**: Tempo + OpenTelemetry + Kiali + OpenShift monitoring
- **Dual Ingress**: Traditional Istio Gateway alongside Kubernetes Gateway API
- **Multi-cluster**: Service Interconnect (Skupper 2.0) for cross-cluster connectivity

## Common Development Tasks

### Infrastructure Setup Commands

**Install all operators:**
```bash
./install_operators.sh
```

**Deploy complete infrastructure -- ambient mode:**
```bash
./install_ambient_demo.sh
```

### Bookinfo Demo Commands

**Deploy ambient mode:**
```bash
./deploy-ambient.sh
```

**Clean up bookinfo:**
```bash
./cleanup-bookinfo.sh
```

### REST API Testing

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
oc get pods -n ossm-bookinfo
oc get pods -n ossm-restapi
```

**Verify service mesh readiness:**
```bash
oc wait --for condition=Ready istio/default --timeout 60s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni
```

## File Structure and Conventions

### Directory Layout
```
.
├── install_operators.sh          # Installs OLM subscriptions + Gateway API CRDs
├── install_ambient_demo.sh       # Full ambient mode demo setup
├── deploy-ambient.sh             # Bookinfo in ambient mode
├── cleanup-bookinfo.sh           # Tear down ossm-bookinfo namespace
├── scripts/                      # test-api.sh, generate-traffic.sh, canary-rollout.sh
├── resources/
│   ├── ossm3/                    # Istio/CNI/ingress gateway (base + overlays)
│   ├── bookinfo/                 # Bookinfo app (base + ambient overlay)
│   ├── tempootel/                # Tempo + OTel (base + kiali/coo overlays)
│   ├── gateway/                  # Gateway API resources
│   ├── rest-api-demo/            # Quarkus REST API (kustomize base + overlays)
│   ├── service-interconnect/     # Skupper 2.0 (base + east/west overlays)
│   ├── kiali/                    # Kiali CR and RBAC
│   ├── monitoring/               # OpenShift user monitoring
│   ├── operators/                # OLM subscriptions (overlays per operator group)
│   ├── console-banner/           # OpenShift console notifications
│   ├── jwt-auth/                 # JWT authentication policies
│   ├── opa/                      # OPA external authorization
│   ├── coo/                      # Cluster Observability Operator configs
│   └── noo/                      # Network Observability Operator configs
├── deploy/                       # Alternative kustomize tree (ArgoCD-oriented)
└── docs/                         # Reference documentation
```

### Kustomize Patterns

All resource directories follow the `base/` + `overlays/<variant>/` pattern:

- **`base/`** contains shared manifests and a `kustomization.yaml`
- **`overlays/<variant>/`** extends the base with mode-specific resources or patches
- Apply with: `oc apply -k ./resources/<component>/overlays/<variant>`

**Label convention**: When using `commonLabels` or `labels` in Kustomize, use `includeSelectors: false` to avoid injecting labels into Service selectors (which would break pod matching).

### Adding New Components

1. Create `resources/<name>/base/` with shared manifests
2. Add `overlays/<variant>/` directories for each deployment variant
3. If an operator is needed, add a subscription under `resources/operators/overlays/<name>/`
4. Wire into the appropriate install script or document the `oc apply -k` command in `README.md`
5. Follow existing naming conventions (lowercase, hyphenated)

## Important Configuration Details

- The Istio CR must be named `default` for the `istio-injection=enabled` label to work on the ingress gateway namespace; otherwise use `istio.io/rev=<name>`
- Gateway API CRDs must be installed before OSSM3 (handled by `install_operators.sh`)
- Tempo requires persistent storage (uses MinIO by default)
- Kiali requires ClusterRoleBindings for OpenShift monitoring integration
- Traffic generation runs continuously at 1 request/second when enabled
- Ambient mode requires `routingViaHost: true` on the OVN-Kubernetes CNI (see `docs/ambient-health-checks.md`)

## OpenShift Server URL

The configured OpenShift server URL is ephemeral and will likely change. Ask the user for the current OpenShift server URL.

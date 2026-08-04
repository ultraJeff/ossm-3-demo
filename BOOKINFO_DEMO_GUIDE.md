# Bookinfo Service Mesh Demo Guide

This guide is an idea for a flow to demo of all the features.

Show Kiali and console plugin features of Service Mesh in OpenShift (kiali, traces, drilling into services)

Show REST API and adjust the weights in the Virtual Service to switch traffic between two endpoints using `./scripts/generate-traffic.sh`

Show Kiali in ambient SM3 and show how pods run with 1/1 containers (no sidecars). Explain ztunnel + waypoint architecture.

Do `oc adm top -n ztunnel` and show how few resources are being consumed

Do `oc adm top -n ossm-bookinfo` and show resources being consumed

Show mTLS on by default

Show REST API again and generate traffic to it, then apply the Authorization Policy and Request Authentication and watch the traffic die

`./resources/jwt-auth/test-jwt-auth.sh`

**or**

`curl -s a0153b9e91372440289dd90a5f6d9a0d-1853560166.us-east-2.elb.amazonaws.com/hello`

and then

` curl -s -H 'Authorization: Bearer $TOKEN' a0153b9e91372440289dd90a5f6d9a0d-1853560166.us-east-2.elb.amazonaws.com/hello`

## Architecture Overview

### Ambient Mode
- **Pods**: 1/1 containers (application only, no sidecars)
- **Label**: `istio.io/dataplane-mode=ambient`
- **Traffic**: L4 handled by ztunnel DaemonSet, L7 by waypoint proxy
- **L7 Features**: Available via dedicated waypoint proxy for observability

## Quick Demo Commands

### Deploy
```bash
./install_ambient_demo.sh
```

### Redeploy Bookinfo
```bash
./cleanup-bookinfo.sh
./deploy-ambient.sh
```

**Verification:**
```bash
oc get pods -n ossm-bookinfo                    # Should show 1/1 containers
oc get namespace ossm-bookinfo -o yaml | grep dataplane-mode
oc get daemonset ztunnel -n ztunnel        # ztunnel should be running
oc get gateway bookinfo-waypoint -n ossm-bookinfo  # waypoint for L7 observability
```

### Access Applications
```bash
# Get Bookinfo URL
# BOOKINFO_URL=$(oc get route istio-ingressgateway -n istio-ingress -o=jsonpath='{.spec.host}')
BOOKINFO_URL=$(oc get gateway bookinfo-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')
echo "Bookinfo: http://${BOOKINFO_URL}/productpage"

# Get Kiali URL
KIALI_URL=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}')
echo "Kiali: https://${KIALI_URL}"
```

## Kustomize Structure

The demo uses Kustomize overlays for clean separation:

```
bookinfo/
├── base/                           # Common Bookinfo resources
│   ├── namespace.yaml             # Base namespace
│   ├── bookinfo.yaml              # Application manifests
│   ├── bookinfo-gateway.yaml     # Istio Gateway
│   ├── traffic-generator.yaml     # Continuous traffic
│   └── podMonitor.yaml            # Observability
├── overlays/
│   └── ambient/                   # Ambient mode overlay
│       ├── kustomization.yaml
│       ├── namespace-patch.yaml   # Adds istio.io/dataplane-mode=ambient
│       └── waypoint-gateway.yaml  # L7 proxy for Kiali visibility
```

## Kiali Observability in Ambient Mode

- **L4 Traffic**: Basic connectivity (handled by ztunnel)
- **L7 Traffic**: **Requires waypoint proxy** for full Kiali visibility
- **Service Graph**: Rich topology **only with waypoint deployed**
- **Metrics**: HTTP metrics via waypoint, connection metrics via ztunnel

## Demo Flow

### 1. Deploy Ambient Mode
```bash
./install_ambient_demo.sh
oc get pods -n ossm-bookinfo  # Show 1/1 containers
```
- Open Kiali, show service graph (via waypoint)
- Explain ztunnel + waypoint architecture

### 2. Show Resource Usage
```bash
# Ambient: Shared ztunnel across nodes
oc get daemonset ztunnel -n ztunnel
oc adm top pods -n ztunnel
oc adm top pods -n ossm-bookinfo
```

## Troubleshooting

### Ambient Mode Issues
- **No L7 traffic in Kiali**: Ensure waypoint proxy is deployed
- **ztunnel not running**: Check ZTunnel CR status
- **Pods not starting**: Verify ambient profile in Istio CR

## Infrastructure Requirements

- OSSM3 operators installed
- Kiali, Tempo, OpenTelemetry deployed
- Istio ingress gateway
- IstioCNI configured for ambient profile
- ZTunnel resource deployed
- ztunnel DaemonSet running

## Cleanup

```bash
./cleanup-bookinfo.sh
```

This removes the ossm-bookinfo namespace and all associated resources.

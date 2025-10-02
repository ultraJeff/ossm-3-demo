# Bookinfo Service Mesh Demo Guide

This guide is an idea for a flow to demo of all the features.

Start on the sidecar cluster `oc config use-context sidecar-mesh`

Show Kiali and console plugin features of Service Mesh in OpenShift (kiali, traces, drilling into services)

Show REST API and adjust the weights in the Virtual Service to switch traffic between two endpoints using `./scripts/generate-traffic.sh`

Show Kiali in sidecar SM3 and show Envoy sidecar containers running in the pods. Click into sidecar and show the size of the sidecar container requests

Do `oc adm top -n bookinfo` and show resources being consumed

Show mTLS on by default

Switch to Ambient Mesh SM3 (`oc config use-context ambient-mesh`)

Do `oc adm top -n ztunnel` and show how few resources are being consumed

Do `oc adm top -n bookinfo` and show resources being consumed

Show REST API again and generate traffic to it, then apply the Authorization Policy and Request Authentication and watch the traffic die

`./resources/jwt-auth/test-jwt-auth.sh`

**or**

`curl -s a0153b9e91372440289dd90a5f6d9a0d-1853560166.us-east-2.elb.amazonaws.com/hello`

and then

` curl -s -H 'Authorization: Bearer $TOKEN' a0153b9e91372440289dd90a5f6d9a0d-1853560166.us-east-2.elb.amazonaws.com/hello`

## Architecture Overview

### Traditional Sidecar Mode
- **Pods**: 2/2 containers (application + istio-proxy sidecar)
- **Label**: `istio-injection=enabled`
- **Traffic**: Handled by individual Envoy sidecars
- **L7 Features**: Available in every pod via sidecar

### Ambient Mode  
- **Pods**: 1/1 containers (application only, no sidecars)
- **Label**: `istio.io/dataplane-mode=ambient`
- **Traffic**: L4 handled by ztunnel DaemonSet, L7 by waypoint proxy
- **L7 Features**: Available via dedicated waypoint proxy for observability

## Quick Demo Commands

### First time deploy
```bash
./install_ossm3_demo.sh
```

### Switch to Ambient Mode
```bash
# ./cleanup-bookinfo.sh
./deploy-ambient.sh
```

<!-- TODO Won't work as-is due to added labels
### Switch Back to Traditional Mode
```bash
./cleanup-bookinfo.sh
./deploy-traditional.sh
``` -->

**Verification:**
```bash
oc get pods -n bookinfo                    # Should show 2/2 containers
oc get namespace bookinfo -o yaml | grep istio-injection
```

**Verification:**
```bash
oc get pods -n bookinfo                    # Should show 1/1 containers  
oc get namespace bookinfo -o yaml | grep dataplane-mode
oc get daemonset ztunnel -n ztunnel        # ztunnel should be running
oc get gateway bookinfo-waypoint -n bookinfo  # waypoint for L7 observability
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
│   ├── traditional/               # Sidecar mode overlay
│   │   ├── kustomization.yaml
│   │   └── namespace-patch.yaml   # Adds istio-injection=enabled
│   └── ambient/                   # Ambient mode overlay
│       ├── kustomization.yaml
│       ├── namespace-patch.yaml   # Adds istio.io/dataplane-mode=ambient
│       └── waypoint-gateway.yaml  # L7 proxy for Kiali visibility
```

## Key Differences for Kiali Observability

### Traditional Mode
- **L7 Traffic**: Visible immediately (handled by sidecars)
- **Service Graph**: Shows all microservice calls
- **Metrics**: Detailed HTTP metrics from each sidecar

### Ambient Mode  
- **L4 Traffic**: Basic connectivity (handled by ztunnel)
- **L7 Traffic**: **Requires waypoint proxy** for full Kiali visibility
- **Service Graph**: Rich topology **only with waypoint deployed**
- **Metrics**: HTTP metrics via waypoint, connection metrics via ztunnel

## Demo Flow

### 1. Start with Traditional Mode
```bash
./install_ossm3_demo.sh
# ./deploy-traditional.sh
oc get pods -n bookinfo  # Show 2/2 containers
```
- Open Kiali, show rich service graph
- Explain sidecar architecture

### 2. Switch to Ambient Mode
```bash
./cleanup-bookinfo.sh
./deploy-ambient.sh
oc get pods -n bookinfo  # Show 1/1 containers
```
- Open Kiali, show service graph (now via waypoint)
- Explain ztunnel + waypoint architecture

### 3. Compare Resource Usage
```bash
# Traditional: Each pod has ~50-100MB sidecar overhead
oc describe pod <bookinfo-pod> | grep -A5 -B5 istio-proxy

# Ambient: Shared ztunnel across nodes
oc get daemonset ztunnel -n ztunnel
oc adm top pods -n ztunnel
```

## Troubleshooting

### Ambient Mode Issues
- **No L7 traffic in Kiali**: Ensure waypoint proxy is deployed
- **ztunnel not running**: Check ZTunnel CR status
- **Pods not starting**: Verify ambient profile in Istio CR

### Traditional Mode Issues  
- **Sidecars not injected**: Check istio-injection label
- **Poor performance**: Resource constraints on sidecars

## Infrastructure Requirements

Both modes require:
- OSSM3 operators installed
- Kiali, Tempo, OpenTelemetry deployed
- Istio ingress gateway

Ambient mode additionally requires:
- IstioCNI configured for ambient profile
- ZTunnel resource deployed
- ztunnel DaemonSet running

## Cleanup

```bash
./cleanup-bookinfo.sh
```

This removes the bookinfo namespace and all associated resources, allowing you to switch between modes cleanly.
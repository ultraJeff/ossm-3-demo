# OSSM3 Kustomize Overlays

This directory contains Kustomize-based configurations for deploying OpenShift Service Mesh 3 in different modes.

## Structure

```
ossm3/
├── base/                      # Common resources for all modes
│   ├── istioIngressGateway.yaml  # Ingress gateway configuration
│   └── kustomization.yaml
└── overlays/
    ├── ambient/              # Ambient mode configuration
    │   ├── istioCni.yaml     # CNI with ambient profile
    │   ├── istiocr.yaml      # Istio CR with ambient profile
    │   ├── ztunnel.yaml      # ZTunnel for ambient L4 processing
    │   ├── ztunnel-namespace.yaml  # Namespace for ztunnel
    │   └── kustomization.yaml
    └── traditional/          # Traditional sidecar mode
        ├── istioCni.yaml     # CNI with OpenShift profile
        ├── istiocr.yaml      # Istio CR with OpenShift profile
        └── kustomization.yaml
```

## Usage

### Deploy Traditional Sidecar Mode
```bash
oc apply -k resources/ossm3/overlays/traditional
```

### Deploy Ambient Mode
```bash
oc apply -k resources/ossm3/overlays/ambient
```

## Key Differences

### Traditional Mode
- Uses `profile: openshift` for compatibility
- Deploys sidecar proxies in each pod
- Standard Istio CNI configuration
- No ztunnel required

### Ambient Mode
- Uses `profile: ambient` for ztunnel-based L4 processing
- No sidecars in application pods
- Requires ztunnel DaemonSet for L4 proxy
- Supports waypoint proxies for L7 features
- Configured with trusted ztunnel namespace

## Integration with Deployment Scripts

The deployment scripts (`deploy-traditional.sh` and `deploy-ambient.sh`) automatically apply the appropriate overlay:

- **deploy-traditional.sh**: Applies `overlays/traditional`
- **deploy-ambient.sh**: Applies `overlays/ambient`

Both scripts wait for the control plane components to be ready before proceeding with application deployment.
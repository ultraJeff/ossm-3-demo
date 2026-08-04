# OSSM3 Kustomize Overlays

This directory contains Kustomize-based configurations for deploying OpenShift Service Mesh 3 in ambient mode.

## Structure

```
ossm3/
├── base/                      # Common resources for all modes
│   ├── istioIngressGateway.yaml  # Ingress gateway configuration
│   └── kustomization.yaml
└── overlays/
    └── ambient/              # Ambient mode configuration
        ├── istioCni.yaml     # CNI with ambient profile
        ├── istiocr.yaml      # Istio CR with ambient profile
        ├── ztunnel.yaml      # ZTunnel for ambient L4 processing
        ├── ztunnel-namespace.yaml  # Namespace for ztunnel
        └── kustomization.yaml
```

## Usage

### Deploy Ambient Mode
```bash
oc apply -k resources/ossm3/overlays/ambient
```

## Details

- Uses `profile: ambient` for ztunnel-based L4 processing
- No sidecars in application pods
- Requires ztunnel DaemonSet for L4 proxy
- Supports waypoint proxies for L7 features
- Configured with trusted ztunnel namespace

## Integration with Deployment Scripts

The deployment script (`deploy-ambient.sh`) automatically applies the ambient overlay and waits for the control plane components to be ready before proceeding with application deployment.

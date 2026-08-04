# Console Banner Configuration

This directory contains Kustomize overlays for OpenShift console banners that identify the service mesh mode.

## Overlay Structure

```
console-banner/
├── base/                   # Base ConsoleNotification resource
│   ├── kustomization.yaml
│   └── consolenotification.yaml
├── overlays/
│   └── ambient/            # Gold banner for ambient mode
```

## Usage

### Ambient Mode (Gold Banner)
```bash
oc apply -k ./resources/console-banner/overlays/ambient
```

Displays: **🌐 Service Mesh 3 — Ambient Mode**
- Background: Gold (#FFD700)
- Text: Black (#000000)

## Remove Banner

```bash
oc delete consolenotification service-mesh-banner
```

## Customization

To create a custom banner, create a new overlay directory and patch the base:

```yaml
# overlays/custom/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
- ../../base

patches:
- target:
    kind: ConsoleNotification
    name: service-mesh-banner
  patch: |-
    - op: replace
      path: /spec/text
      value: "Your Custom Banner Text"
    - op: replace
      path: /spec/backgroundColor
      value: "#YOUR_COLOR"
    - op: replace
      path: /spec/color
      value: "#TEXT_COLOR"
```

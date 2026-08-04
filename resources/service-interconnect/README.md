# Red Hat Service Interconnect (Skupper 2.0)

Multi-cluster application connectivity using Red Hat Service Interconnect 2.0 (Skupper). This enables secure Layer 7 communication between services running on different OpenShift clusters with mutual TLS authentication.

## Overview

Service Interconnect creates an application network that spans multiple clusters. Services exposed on one cluster become available on linked clusters as if they were local.

This demo exposes the Quarkus REST API backend (`service-b`) from an "east" cluster and makes it consumable from a "west" cluster.

## Architecture

```
East Cluster                                    West Cluster
┌─────────────────────────┐                     ┌─────────────────────────┐
│  ossm-restapi     │                     │  skupper-site           │
│  ┌───────────────────┐  │                     │  ┌───────────────────┐  │
│  │ service-b (v1/v2) │  │   Skupper Link      │  │ east-rest-api-    │  │
│  │ (Quarkus app)     │◄─┼───(mTLS tunnel)────►│  │ backend:8080     │  │
│  └───────────────────┘  │                     │  │ (proxy service)   │  │
│                         │                     │  └───────────────────┘  │
│  skupper-site           │                     │                         │
│  ┌───────────────────┐  │                     │  ┌───────────────────┐  │
│  │ Site + Connector  │  │                     │  │ Site + Listener   │  │
│  └───────────────────┘  │                     │  └───────────────────┘  │
└─────────────────────────┘                     └─────────────────────────┘
```

## Overlay Structure

```
service-interconnect/
├── base/                    # Common resources for any site
│   ├── kustomization.yaml
│   ├── namespace.yaml       # skupper-site namespace
│   └── site.yaml            # Site CR (linkAccess: default)
├── overlays/
│   ├── east/                # Provider site (exposes services)
│   │   ├── kustomization.yaml
│   │   └── connector.yaml   # Binds service-b workloads
│   └── west/                # Consumer site (creates proxy services)
│       ├── kustomization.yaml
│       └── listener.yaml    # Creates east-rest-api-backend service
```

## Prerequisites

1. Red Hat Service Interconnect operator installed on both clusters
2. Two OpenShift clusters with network connectivity between them
3. `oc` CLI logged into the target cluster

### Install the Operator

```bash
oc apply -k ./resources/operators/overlays/service-interconnect
```

Wait for the operator to be ready:
```bash
oc wait --for=condition=Available deployment/skupper-controller \
  -n openshift-operators --timeout=120s
```

## Setup

### Step 1: Deploy Sites on Both Clusters

**On the east cluster** (where the REST API backend runs):
```bash
oc apply -k ./resources/service-interconnect/overlays/east
```

**On the west cluster** (where you want to consume the service):
```bash
oc apply -k ./resources/service-interconnect/overlays/west
```

Verify sites are ready:
```bash
oc get site -n skupper-site
```

### Step 2: Link the Sites

The linking workflow uses AccessGrant/AccessToken CRs. These contain secrets and are generated dynamically -- they should not be committed to version control.

**On the east cluster** (listening site), create an AccessGrant:
```bash
cat <<EOF | oc apply -n skupper-site -f -
apiVersion: skupper.io/v2alpha1
kind: AccessGrant
metadata:
  name: grant-to-west
spec:
  redemptionsAllowed: 1
  expirationWindow: 15m
EOF
```

**Extract the token details** from the east cluster:
```bash
GRANT_URL=$(oc get accessgrant grant-to-west -n skupper-site -o jsonpath='{.status.url}')
GRANT_CODE=$(oc get accessgrant grant-to-west -n skupper-site -o jsonpath='{.status.code}')
GRANT_CA=$(oc get accessgrant grant-to-west -n skupper-site -o jsonpath='{.status.ca}')
```

**On the west cluster**, create an AccessToken using the values from the east cluster:
```bash
cat <<EOF | oc apply -n skupper-site -f -
apiVersion: skupper.io/v2alpha1
kind: AccessToken
metadata:
  name: token-from-east
spec:
  url: "${GRANT_URL}"
  code: "${GRANT_CODE}"
  ca: "${GRANT_CA}"
EOF
```

Verify the link is established:
```bash
oc get link -n skupper-site
```

### Step 3: Verify Service Availability

**On the west cluster**, confirm the proxy service was created:
```bash
oc get service east-rest-api-backend -n skupper-site
```

Test connectivity from the west cluster:
```bash
oc run curl-test --rm -i --tty --image=curlimages/curl -n skupper-site \
  -- curl -s http://east-rest-api-backend:8080/hello | jq
```

## Custom Resources Reference

| Resource | Purpose | Scope |
|----------|---------|-------|
| `Site` | Declares a cluster as a Skupper site | Per-cluster |
| `AccessGrant` | Permits link creation from remote sites | Listening site |
| `AccessToken` | Short-lived credential to establish a link | Connecting site |
| `Connector` | Binds local workloads for remote consumption | Provider site |
| `Listener` | Creates proxy service for remote workloads | Consumer site |

## Relationship to Service Mesh

Service Interconnect operates alongside (not inside) the service mesh. It provides cross-cluster connectivity at L7, while OSSM3 handles intra-cluster traffic management, observability, and security. The two are complementary:

- **OSSM3**: mTLS, traffic routing, observability within a cluster
- **Service Interconnect**: Secure cross-cluster service connectivity

## Troubleshooting

Check the Skupper controller logs:
```bash
oc logs -n openshift-operators -l app=skupper-controller
```

Check site status:
```bash
oc describe site default -n skupper-site
```

Check link status:
```bash
oc get link -n skupper-site -o yaml
```

Check connector/listener pairing:
```bash
oc get connector,listener -n skupper-site
```

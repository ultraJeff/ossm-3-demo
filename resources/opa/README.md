# OPA (Open Policy Agent) Authorization Example

This directory contains configuration for integrating OPA with Istio for fine-grained authorization control.

## Overview

OPA provides policy-based authorization decisions for service mesh traffic. This example demonstrates:
- Role-based access control (RBAC) using OPA policies
- Integration with Istio's external authorization (ext_authz) mechanism
- Policy decisions based on user identity and request path

## Architecture

```
Client Request → Istio Ingress → Istio Proxy → OPA Sidecar → Application
                                     ↓              ↓
                              AuthorizationPolicy   Policy Decision
                              (CUSTOM action)       (allow/deny)
```

## Policy

The example policy (`opa-policy.yaml`) implements:

| User | Role | Allowed Paths |
|------|------|---------------|
| alice | guest | `/productpage` only |
| bob | admin | `/productpage`, `/api/v1/products` |

Authentication is via HTTP Basic Auth.

## Prerequisites

1. OPA-Envoy admission controller installed:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/open-policy-agent/opa-envoy-plugin/main/examples/istio/quick_start.yaml
   ```

2. Istio mesh configured with OPA extension provider. Add to your Istio CR:
   ```yaml
   spec:
     values:
       meshConfig:
         extensionProviders:
         - name: opa-ext-authz-grpc
           envoyExtAuthzGrpc:
             service: bookinfo-opa/opa-ext-authz-grpc.local
             port: 9191
   ```

## Installation

```bash
# Deploy the OPA-enabled BookInfo
oc apply -k resources/opa

# Deploy BookInfo application
kubectl apply -f https://raw.githubusercontent.com/istio/istio/master/samples/bookinfo/platform/kube/bookinfo.yaml -n bookinfo-opa

# Wait for pods
oc wait --for=condition=Ready pods --all -n bookinfo-opa --timeout=60s
```

## Testing

Get the gateway URL:
```bash
GATEWAY_URL=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}')
```

Test with alice (guest - can only access /productpage):
```bash
# Should succeed (200)
curl --user alice:password -H "Host: opa.bookinfo.example.com" http://$GATEWAY_URL/productpage

# Should fail (403)
curl --user alice:password -H "Host: opa.bookinfo.example.com" http://$GATEWAY_URL/api/v1/products
```

Test with bob (admin - can access both):
```bash
# Should succeed (200)
curl --user bob:password -H "Host: opa.bookinfo.example.com" http://$GATEWAY_URL/productpage

# Should succeed (200)
curl --user bob:password -H "Host: opa.bookinfo.example.com" http://$GATEWAY_URL/api/v1/products
```

## Viewing OPA Decision Logs

```bash
oc logs -n bookinfo-opa -l app=productpage -c opa-istio --tail=20 | grep -v "/health"
```

## Customizing Policies

Edit `opa-policy.yaml` to modify:
- `user_roles`: Map users to roles
- `role_perms`: Map roles to allowed method/path combinations

After changes, apply and restart pods:
```bash
oc apply -f resources/opa/opa-policy.yaml
oc rollout restart deployment -n bookinfo-opa
```

## References

- [OPA Istio Tutorial](https://www.openpolicyagent.org/docs/envoy/tutorial-istio)
- [Istio External Authorization](https://istio.io/latest/docs/tasks/security/authorization/authz-custom/)
- [OPA Policy Language](https://www.openpolicyagent.org/docs/latest/policy-language/)


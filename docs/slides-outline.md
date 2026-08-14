# OpenShift Service Mesh 3: Ambient Mode — Slide Outline (v2)

Target audience: OpenShift users who can deploy apps but have mixed knowledge of networking, security, and observability. Conference setting. No assumptions about Istio, SPIFFE, Gateway API, or networking internals.

---

## Part 1: The Foundation

### Slide 1: Title
**OpenShift Service Mesh 3: Ambient Mode**
Transparent encryption, identity, and policy for pod-to-pod traffic

### Slide 2: What We'll Cover
- How pods talk to each other on OpenShift (and why it's a problem)
- What a service mesh is and what it's made of
- How ambient mode works under the hood
- Gateway API — the new standard for routing
- Identity, encryption, and access control
- Traffic management and observability
- Controlling egress with ServiceEntries

### Slide 3: How Pods Talk to Each Other
When you deploy two pods on OpenShift:
- Each pod gets an IP address from the node's subnet
- If they're on the same node: traffic switches through the OVN bridge (L2, fast)
- If they're on different nodes: traffic wraps in a Geneve tunnel (L3 overlay between nodes)
- Either way, the traffic is **plaintext on the wire** — HTTP, gRPC, database calls, all unencrypted
- OVN-Kubernetes (the cluster CNI) handles connectivity, not security

> Speaker notes: Keep it visual — show two pods, an arrow between them, label it "plaintext HTTP." Then show the Geneve tunnel for cross-node. The key insight: OVN-K gives you connectivity but not confidentiality.

### Slide 4: What About Network Policies?
Network policies let you restrict traffic by:
- Namespace labels
- Pod labels
- IP ranges and ports

What they can't do:
- Verify WHO is making the connection (no identity)
- Encrypt the traffic
- Inspect HTTP methods, paths, or headers
- Provide an audit trail of every connection

> Speaker notes: Network policies are layer 3/4 rules — they filter by address, not by identity. "This IP can reach that port" doesn't tell you which service account made the request.

### Slide 5: What a Service Mesh Does
A service mesh adds three capabilities to pod-to-pod traffic:

1. **Encrypt** — mutual TLS (mTLS) on every connection between pods
2. **Identify** — every workload gets a cryptographic identity
3. **Control** — policies that say which identities can reach which services

The application doesn't implement any of this. The mesh handles it transparently.

---

## Part 2: The Architecture

### Slide 6: Istio and Envoy — What's What
- **Istio** is the service mesh control plane — it manages configuration, distributes certificates, and pushes routing rules
- **Envoy** is the proxy that handles the actual traffic — a high-performance C++ proxy originally built by Lyft
- **istiod** is the Istio control plane process — it runs in istio-system and does certificate management, xDS configuration distribution, and service discovery
- In ambient mode, Envoy runs in **waypoint proxies** (not sidecars)

> Speaker notes: Istio tells the proxies what to do. Envoy does the work. istiod is the brain. This is important because people confuse "Istio" with "the sidecar proxy" — in ambient mode there are no sidecars.

### Slide 7: The Ambient Mode Stack
Five layers (diagram, bottom to top):

| Layer | Component | What It Does |
|-------|-----------|-------------|
| L2/L3 | OVN-Kubernetes | Pod networking — IP addresses, Geneve tunnels between nodes |
| Interception | istio-cni | Writes iptables rules on pod start to redirect traffic to ztunnel |
| L4 | ztunnel | Per-node Rust proxy — mTLS encryption, HBONE tunnels, TCP metrics |
| L7 | Waypoint proxy | Per-namespace Envoy proxy — HTTP routing, auth policies, timeouts |
| App | Your application | Runs unchanged — sends plain HTTP, ztunnel encrypts it |

> Speaker notes: Walk through bottom to top. "OVN-K is already running — it's your cluster networking. istio-cni is a DaemonSet that writes iptables rules when pods start — this is how ztunnel gets in the path. ztunnel runs on every node and wraps every connection in an encrypted tunnel. If you need L7 features, a waypoint proxy handles that. Your app sits on top, unchanged."

### Slide 8: What Is ztunnel?
- A Rust-based proxy that runs as a DaemonSet — one per node
- Intercepts all pod traffic via iptables rules written by istio-cni
- Wraps connections in **HBONE tunnels** (HTTP/2 CONNECT over mTLS on port 15008)
- Handles: mTLS encryption, SPIFFE certificate exchange, L4 metrics, L4 authorization
- Does NOT handle: HTTP header inspection, path-based routing, retries, timeouts

The key insight: ztunnel follows the same per-node proxy pattern as OVN-K itself. OVN-K encapsulates in Geneve for connectivity. ztunnel encapsulates in HBONE for encryption.

> Speaker notes: The parallel to OVN-K is powerful — both are per-node DaemonSets that tunnel traffic between nodes. OVN-K uses Geneve for L3 connectivity. ztunnel uses HBONE for mTLS encryption. `routingViaHost: true` is the setting that makes them work together — it forces OVN-K to route through the host kernel where ztunnel's iptables rules can intercept.

### Slide 9: What Is an HBONE Tunnel?
HBONE = HTTP-Based Overlay Network Encapsulation

- An HTTP/2 CONNECT tunnel running over mTLS on port 15008
- The inner connection is plain HTTP (what the app sent)
- The outer tunnel is encrypted with mutual TLS
- Each end of the tunnel presents a SPIFFE certificate
- ztunnel on the source node initiates the tunnel to ztunnel on the destination node

```
Pod A → ztunnel (node 1) →→ HBONE mTLS on port 15008 →→ ztunnel (node 2) → Pod B
        |                                                    |
        encrypts with                                    decrypts with
        source SPIFFE cert                               dest SPIFFE cert
```

> Speaker notes: "The app sends plain HTTP to port 8080. ztunnel intercepts it, opens an HTTP/2 CONNECT tunnel to the destination ztunnel, presents its SPIFFE certificate, and sends the data through. On the other end, ztunnel decrypts and delivers plain HTTP to the destination pod. The app never sees TLS."

### Slide 10: OVN-K and ztunnel — Two Sides of the Same Pattern
Side-by-side comparison:

| | OVN-Kubernetes | ztunnel |
|---|---|---|
| **Runs as** | DaemonSet per node | DaemonSet per node |
| **Intercepts via** | OVS bridge + veth pairs | iptables redirect (written by istio-cni) |
| **Tunnels** | Geneve (L3 overlay) | HBONE (mTLS overlay) |
| **Same-node** | L2 switch through br-int | Same network namespace, local delivery |
| **Cross-node** | Geneve encap → decap | HBONE encap → decap |
| **Control plane** | ovnkube-control-plane | istiod |

OVN-K gives you **connectivity**. ztunnel layers **encryption and identity** on top of it.

**Why `routingViaHost: true` matters:**
- Default: OVN-K handles routing in the OVS datapath, bypassing the host kernel
- With `routingViaHost: true`: traffic flows through the host kernel's network stack
- ztunnel intercepts traffic via iptables rules in the host kernel
- If OVN-K bypasses the host kernel, ztunnel never sees the packets

This is the seam between the two systems — `routingViaHost` is what lets ztunnel hook into OVN-K's traffic path.

> Speaker notes: "These two systems follow the exact same architectural pattern — per-node DaemonSets that tunnel traffic between nodes. OVN-K uses Geneve tunnels for L3 connectivity. ztunnel uses HBONE tunnels for mTLS encryption. The `routingViaHost` setting is the bridge between them. By default, OVN-K routes traffic entirely within the OVS datapath — fast, but it means traffic never passes through the host kernel. ztunnel's iptables rules live in the host kernel. So `routingViaHost: true` forces OVN-K to route through the host stack, which is where ztunnel can intercept and encrypt."

---

## Part 3: Identity

### Slide 10: What Is SPIFFE?
SPIFFE = Secure Production Identity Framework for Everyone

- An open standard (CNCF project) for workload identity
- Every workload gets an identity in the form of a URI:
  `spiffe://cluster.local/ns/my-namespace/sa/my-service-account`
- The identity is embedded in an X.509 certificate (called an SVID)
- istiod acts as the certificate authority — it signs certificates for every workload
- Certificates are short-lived (default ~24h) and automatically rotated

Why this matters: identity is no longer tied to IP addresses. A workload's identity is its namespace + service account, cryptographically verified.

> Speaker notes: "Traditional network security says 'traffic from IP 10.128.0.45 is the productpage service.' SPIFFE says 'this certificate proves this workload is spiffe://cluster.local/ns/bookinfo/sa/productpage.' The IP can change, the pod can move nodes — the identity stays the same."

### Slide 11: Enrolling a Namespace
One label enrolls a namespace in the mesh:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  labels:
    istio.io/dataplane-mode: ambient
```

What happens:
- ztunnel starts intercepting traffic for pods in this namespace
- istiod issues SPIFFE certificates for every pod's service account
- All outbound connections from these pods are encrypted via HBONE
- All inbound connections carry a verified SPIFFE identity

No pod restarts. No sidecars. No application changes.

---

## Part 4: Security Policies

### Slide 12: PeerAuthentication
PeerAuthentication controls whether a namespace accepts unencrypted traffic.

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: my-app
spec:
  mtls:
    mode: STRICT
```

Three modes:
- **STRICT**: Only accept connections that present a valid mesh certificate. Pods outside the mesh are rejected entirely.
- **PERMISSIVE**: Accept both mTLS and plaintext. Use during migration when some clients aren't mesh-enrolled yet.
- **DISABLE**: No mTLS enforcement (not recommended).

Scope: can be set per-namespace, per-workload, or per-port.

> Speaker notes: "STRICT doesn't mean 'encrypt everything' — ztunnel does that automatically for enrolled pods. STRICT means 'reject connections from pods that CAN'T encrypt' — pods outside the mesh. It's the difference between 'I encrypt my side' and 'I refuse to talk to anyone who doesn't.'"

### Slide 13: AuthorizationPolicy
AuthorizationPolicy controls which SPIFFE identities can reach which services. This is L7 policy, enforced by the waypoint proxy.

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: restrict-access
  namespace: my-app
spec:
  targetRefs:
    - kind: Gateway
      group: gateway.networking.k8s.io
      name: my-waypoint
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
              - "cluster.local/ns/frontend/sa/web"
```

What this says: "Only the `web` service account in the `frontend` namespace can reach services through this waypoint. Everyone else gets 403."

> Speaker notes: "Two layers of zero trust. PeerAuthentication (ztunnel, L4) controls whether plaintext is allowed at all. AuthorizationPolicy (waypoint, L7) controls which specific identities can access which specific services. You can restrict by namespace, service account, HTTP method, path — anything the waypoint can inspect."

### Slide 14: Waypoint Proxies
A waypoint proxy is an Envoy instance deployed per-namespace for L7 policy enforcement.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-waypoint
  namespace: my-app
  labels:
    istio.io/waypoint-for: service
spec:
  gatewayClassName: istio-waypoint
  listeners:
    - name: mesh
      port: 15008
      protocol: HBONE
```

- Created using the Gateway API `Gateway` resource with class `istio-waypoint`
- ztunnel routes traffic through the waypoint when the namespace has `istio.io/use-waypoint` label
- Handles: AuthorizationPolicy, HTTPRoute timeouts, traffic splitting, retries
- Without a waypoint, ztunnel handles L4 only — mTLS encryption and basic L4 auth

> Speaker notes: "You don't always need a waypoint. If all you need is encryption and basic connectivity, ztunnel handles that at L4. You add a waypoint when you need L7 features — HTTP-aware authorization policies, timeouts, canary routing."

---

## Part 5: Gateway API

### Slide 15: The Evolution of Kubernetes Ingress
How external traffic reaches your apps has evolved:

| Era | Resource | Limitations |
|-----|----------|-------------|
| v1 | `Ingress` | Basic HTTP routing. No TCP/UDP. Limited to path and host matching. |
| OpenShift | `Route` | Adds TLS termination, blue-green, weighted routing. OpenShift-specific. |
| Current | `Gateway` + `HTTPRoute` | Kubernetes-native. Multi-protocol. Portable. Extensible. Role-oriented. |

Gateway API splits the concern:
- **Gateway**: "I'm a load balancer listening on these ports" (infrastructure team)
- **HTTPRoute**: "Route traffic matching this path to this service" (application team)

> Speaker notes: "If you've used Ingress resources, Gateway API is the replacement. If you've used OpenShift Routes, Gateway API is the portable equivalent. The key improvement: the Gateway resource is separate from the routing rules, so the infra team manages the load balancer and the app team manages the routing."

### Slide 16: Gateway API in the Mesh
In OpenShift Service Mesh 3, Gateway API does double duty:

**North-South (Ingress):**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-gateway
spec:
  gatewayClassName: istio    # Creates an Envoy proxy with LoadBalancer
```

**East-West (Internal policy):**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: my-waypoint
spec:
  gatewayClassName: istio-waypoint    # Creates an Envoy proxy for L7 policy
```

Same API. Same skills. One creates an ingress proxy. The other creates a policy enforcement point inside the mesh.

### Slide 17: HTTPRoute
HTTPRoute is how you define routing rules — both for external ingress and internal traffic management.

**External routing (attach to a Gateway):**
```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
spec:
  parentRefs:
    - kind: Gateway
      name: my-gateway
  rules:
    - matches:
        - path: { type: PathPrefix, value: /api }
      backendRefs:
        - name: api-service
          port: 8080
```

**Canary deployment (attach to a Service):**
```yaml
spec:
  parentRefs:
    - kind: Service
      name: my-service
  rules:
    - backendRefs:
        - name: my-service-v1
          weight: 90
        - name: my-service-v2
          weight: 10
```

**Timeout (also an HTTPRoute):**
```yaml
spec:
  rules:
    - backendRefs:
        - name: my-service
      timeouts:
        request: 5s
```

> Speaker notes: "One resource type — HTTPRoute — handles external routing, canary deployments, and timeout policies. The `parentRef` determines where it's applied: attach it to a Gateway for ingress, attach it to a Service for internal traffic management through the waypoint."

---

## Part 6: Traffic Management and Observability

### Slide 18: Traffic Management Through the Waypoint
The waypoint proxy enables declarative traffic management:

- **Timeouts**: HTTPRoute `timeouts.request: 5s` — the waypoint cuts off slow responses
- **Canary routing**: HTTPRoute weighted `backendRefs` — split traffic between versions
- **Retries**: VirtualService `retries` — retry failed requests before the client sees an error

All enforced by the waypoint. The application doesn't implement retry logic, timeout handling, or traffic splitting — the mesh handles it.

### Slide 19: Observability
The mesh generates telemetry automatically from every connection:

- **Topology**: Kiali visualizes service-to-service connections as a live graph
- **Tracing**: Tempo + OpenTelemetry collect distributed traces across services
- **Metrics**: ztunnel and waypoint proxies export Prometheus metrics
- **Audit trail**: Every mTLS connection is logged with SPIFFE identity, destination, bytes transferred, and duration

This is generated from the mesh infrastructure — the application doesn't need instrumentation libraries or logging changes.

---

## Part 7: Controlling Egress

### Slide 20: ServiceEntry — Bringing External Services into the Mesh
By default, the mesh manages traffic between pods inside the cluster. ServiceEntry extends the mesh to cover external services.

```yaml
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: external-api
spec:
  hosts:
    - api.example.com
  location: MESH_EXTERNAL
  ports:
    - number: 443
      name: https
      protocol: TLS
  resolution: DNS
```

What this enables:
- **Observability**: See traffic to `api.example.com` in Kiali and metrics
- **Policy**: Apply AuthorizationPolicy to control which workloads can reach external services
- **Routing**: Route external traffic through a waypoint for inspection

> Speaker notes: "Without a ServiceEntry, traffic to external services bypasses the mesh — no observability, no policy. With a ServiceEntry, you register the external host in the mesh's service registry. Now the mesh treats it like any other service — you can see it in Kiali, apply authorization policies, and route it through a waypoint for egress control."

### Slide 21: Egress Control with Waypoints
Combine ServiceEntry with a waypoint for egress governance:

1. Define a ServiceEntry for the external service
2. Label it with `istio.io/use-waypoint: my-waypoint`
3. Apply AuthorizationPolicy to control which workloads can reach it

Example: only the `payment` service can call the external payment API. All other workloads get 403.

This gives you a single point of egress control — the waypoint acts as an egress gateway without requiring a separate egress infrastructure.

---

## Part 8: Practical Considerations

### Slide 22: The Istio API Surface
Key resources you'll work with:

| Resource | API Group | Purpose |
|----------|-----------|---------|
| `Gateway` | gateway.networking.k8s.io | Ingress proxy or waypoint proxy |
| `HTTPRoute` | gateway.networking.k8s.io | Routing, timeouts, traffic splitting |
| `PeerAuthentication` | security.istio.io | mTLS enforcement mode |
| `AuthorizationPolicy` | security.istio.io | Identity-based access control |
| `ServiceEntry` | networking.istio.io | Register external services in the mesh |
| `VirtualService` | networking.istio.io | Retries, fault injection, advanced routing |
| `Telemetry` | telemetry.istio.io | Tracing and metrics configuration |

Gateway API resources are Kubernetes standards. Istio resources are mesh-specific.

### Slide 23: Prerequisites and Gotchas
- **routingViaHost: true** required on OVN-Kubernetes — ambient mode needs traffic to flow through the host kernel where ztunnel can intercept it
- **Waypoint proxy** required per namespace for L7 features — without it, only L4 mTLS is available
- **PeerAuthentication**: start PERMISSIVE during migration, switch to STRICT when all consumers are enrolled
- **MetalLB** or equivalent needed for Gateway LoadBalancer addresses on bare metal
- **Prefer HTTPRoute** over VirtualService for new traffic policies — HTTPRoute is the Kubernetes standard

### Slide 24: Getting Started
Install the operators:
1. OpenShift Service Mesh 3 (Sail Operator)
2. Kiali
3. Tempo + OpenTelemetry (for tracing)

Deploy the mesh:
1. Create Istio, IstioCNI, and ZTunnel CRs
2. Label namespaces with `istio.io/dataplane-mode: ambient`
3. Create waypoint proxies where L7 features are needed
4. Create Gateway resources for external ingress

### Slide 25: Resources / Q&A
- OpenShift Service Mesh 3 documentation
- Gateway API: gateway-api.sigs.k8s.io
- SPIFFE: spiffe.io
- Istio ambient mode: istio.io/docs/ambient

**Questions?**

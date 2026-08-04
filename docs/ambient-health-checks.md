# Ambient Mesh Health Checks and OVN-Kubernetes Considerations

This document covers the prerequisites and operational considerations for running Istio ambient mode on OpenShift, with focus on OVN-Kubernetes gateway configuration and Kubernetes health check probe behavior.

## routingViaHost: The Required OVN-Kubernetes Change

### What is routingViaHost?

OpenShift uses OVN-Kubernetes as its CNI plugin, which supports two gateway modes for pod egress traffic:

| Mode | `routingViaHost` | Egress Path | Default Since |
|------|-----------------|-------------|---------------|
| **Shared** | `false` (default) | Pod traffic exits directly through Open vSwitch (OVS) to the NIC, bypassing the host kernel | OCP 4.8 |
| **Local** | `true` | Pod traffic routes through the host kernel networking stack and routing table before egressing | Pre-4.8 default |

### Why Ambient Mode Requires Local Gateway Mode

Istio ambient mode uses **ztunnel**, a per-node L4 proxy that intercepts pod traffic using iptables/nftables rules installed by the Istio CNI plugin. These rules operate at the host kernel level.

In shared gateway mode (`routingViaHost: false`), pod egress traffic bypasses the host kernel entirely -- it is forwarded directly through OVS flows. This means ztunnel's iptables-based traffic interception rules are never hit, and the mesh cannot function.

**Local gateway mode (`routingViaHost: true`) is a hard prerequisite** for ambient mode per the [OSSM 3.x documentation](https://docs.redhat.com/en/documentation/red_hat_openshift_service_mesh/3.3/html/installing/ossm-istio-ambient-mode).

### How to Enable routingViaHost

```bash
oc patch network.operator.openshift.io cluster \
  --type=merge \
  --patch='{"spec":{"defaultNetwork":{"ovnKubernetesConfig":{"gatewayConfig":{"routingViaHost":true}}}}}'
```

Verify the change:
```bash
oc get network.operator.openshift.io cluster \
  -o jsonpath='{.spec.defaultNetwork.ovnKubernetesConfig.gatewayConfig.routingViaHost}'
```

This triggers a rolling restart of the OVN-Kubernetes DaemonSet across all nodes. Monitor the rollout:
```bash
oc rollout status daemonset/ovnkube-node -n openshift-ovn-kubernetes
```

> **Important**: Apply this change **before** installing the ambient mesh components. The OVN-Kubernetes rollout must complete before ztunnel can function correctly.

## Impact of Switching to routingViaHost: true

### Cluster-Wide Effects

This is a **cluster-wide change** that affects all pods, not just those enrolled in the service mesh:

1. **Egress path change**: All pod egress traffic will now traverse the host kernel networking stack. This changes the path from `pod → OVS → NIC` to `pod → OVS → host kernel → NIC`.

2. **Performance**: The additional kernel hop adds marginal latency. For most workloads this is negligible, but high-throughput, latency-sensitive applications may notice a difference.

3. **Host-level rules take effect**: Any iptables/nftables rules, ip routes, or other host kernel networking configuration will now apply to pod egress traffic. This is intentional for ztunnel, but may have unintended side effects if other host-level rules exist.

4. **NetworkPolicy behavior**: Core NetworkPolicy enforcement is handled by OVN-Kubernetes and is unaffected. However, edge cases involving egress policies that relied on the shared gateway's direct OVS path may behave differently.

### When This Can Break Things

- **Existing iptables rules on nodes**: If nodes have custom iptables rules (from other CNI plugins, security tools, or node configuration), these will now apply to pod traffic.
- **MTU considerations**: The additional encapsulation through the host kernel may affect effective MTU in some configurations.
- **Workloads depending on shared gateway behavior**: Any workload that relied on the specific egress path of the shared gateway (e.g., specific source IP behavior) may be affected.
- **Rollback**: Switching back to `routingViaHost: false` is supported but triggers another rolling restart of OVN-Kubernetes pods.

### Risk Mitigation

- Test the gateway mode switch on a non-production cluster first
- Apply the change during a maintenance window
- Monitor pod connectivity and egress behavior after the rollout
- Verify existing NetworkPolicies still function as expected

## Health Check Probe Behavior in Ambient Mode

### How Probes Work Normally

Kubelet sends HTTP/TCP/gRPC probes directly to pod IPs to determine pod health. These are control-plane signals, not application traffic, and should not be subject to mesh policy enforcement.

### The Ambient Mode Challenge

In **sidecar mode**, Istio rewrites probe ports so kubelet probes bypass the sidecar proxy. This is well-established and transparent.

In **ambient mode**, traffic interception happens at the **node level** via iptables rules installed by the Istio CNI plugin. Kubelet probes originate from the node (not from another pod), and the CNI plugin must correctly distinguish kubelet probe traffic from regular pod-to-pod traffic to exempt it from ztunnel interception.

### Known Issues

1. **iptables backend mismatch** ([istio/istio#56983](https://github.com/istio/istio/issues/56983)): On some nodes, the Istio CNI plugin may select `iptables-legacy` instead of `iptables-nft`, causing probe interception rules to be installed in the wrong table. This affects ~5-6% of newly provisioned nodes and causes readiness probe timeouts even though the application is healthy.

   **Workaround**: Restart the `istio-cni-node` pod on affected nodes:
   ```bash
   oc delete pod -n istio-cni -l k8s-app=istio-cni-node --field-selector spec.nodeName=<affected-node>
   ```

2. **Ztunnel readiness probe failures** ([istio/ztunnel#1674](https://github.com/istio/ztunnel/issues/1674)): The Istio CNI health endpoint can intermittently return HTTP 500 to ztunnel readiness probes, preventing ztunnel pods from becoming ready on ~5-6% of new nodes.

   **Workaround**: Same as above -- restart the CNI pod.

### Recommendations for This Repository

#### Existing Deployments with Probes

The REST API demo deployments use HTTP probes that need validation in ambient mode:

- `resources/rest-api-demo/kustomize/base/deployment-front-end.yaml` -- probes on `/docs:8080`
- `resources/rest-api-demo/kustomize/overlays/pod/deployment-back-end-v1.yaml` -- probes on `/docs:8080`
- `resources/rest-api-demo/kustomize/overlays/pod/deployment-back-end-v2.yaml` -- probes on `/docs:8080`

When deploying these in an ambient mesh namespace, monitor for probe failures:
```bash
oc get events -n ossm-restapi --field-selector reason=Unhealthy
```

#### Deployments Without Probes

Bookinfo deployments (`resources/bookinfo/base/bookinfo.yaml`) do not define liveness or readiness probes. While this means they won't fail due to probe interception, it also means Kubernetes has no way to detect if the application is actually healthy. Consider adding probes to the ambient overlay for better observability.

#### Debugging Probe Failures in Ambient Mode

1. Check if the pod is enrolled in the mesh:
   ```bash
   oc get pod <pod-name> -n <namespace> -o jsonpath='{.metadata.labels.istio\.io/dataplane-mode}'
   ```

2. Verify ztunnel is running on the node:
   ```bash
   oc get pods -n ztunnel -o wide | grep <node-name>
   ```

3. Check ztunnel workload registration:
   ```bash
   istioctl ztunnel-config workloads --namespace ztunnel | grep <pod-name>
   ```

4. Check CNI plugin logs for iptables issues:
   ```bash
   oc logs -n istio-cni -l k8s-app=istio-cni-node --tail=50 | grep -i "iptables\|error\|fail"
   ```

5. Temporarily remove a pod from the mesh to isolate the issue:
   ```bash
   oc label pod <pod-name> -n <namespace> istio.io/dataplane-mode=none --overwrite
   ```

## Version Requirements

| Component | Minimum Version |
|-----------|----------------|
| OpenShift Container Platform | 4.19 |
| Red Hat OpenShift Service Mesh | 3.1.0 |
| Gateway API CRDs | v1.2.0 (included in OCP 4.19+) |

## References

- [OSSM 3.3 Ambient Mode Installation](https://docs.redhat.com/en/documentation/red_hat_openshift_service_mesh/3.3/html/installing/ossm-istio-ambient-mode)
- [OVN-Kubernetes Gateway Configuration](https://docs.redhat.com/en/documentation/openshift_container_platform/4.19/html/ovn-kubernetes_network_plugin/configuring-gateway)
- [Istio Ztunnel Traffic Redirection](https://istio.io/latest/docs/ambient/architecture/traffic-redirection)
- [istio/istio#56983 - iptables backend mismatch](https://github.com/istio/istio/issues/56983)
- [istio/ztunnel#1674 - CNI health probe failures](https://github.com/istio/ztunnel/issues/1674)

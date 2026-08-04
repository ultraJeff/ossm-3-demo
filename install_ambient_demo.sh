#!/bin/bash

NC=''          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow
BRed='\033[1;31m'     # Red
BBlue=''    # Blue

echo -e "${BGreen}==========================================${NC}"
echo -e "${BGreen}  OSSM3 Ambient Mode Demo Installation   ${NC}"
echo -e "${BGreen}==========================================${NC}"
echo ""

# Check prerequisites
echo -e "${BYellow}Checking prerequisites...${NC}"
if ! oc whoami &>/dev/null; then
    echo -e "${BRed}Error: Not logged into OpenShift. Please run 'oc login' first.${NC}"
    exit 1
fi

echo -e "${BYellow}Logged in as: $(oc whoami)${NC}"
echo -e "${BYellow}Cluster: $(oc whoami --show-server)${NC}"
echo ""

# Check routingViaHost
echo -e "${BYellow}Checking OVN-Kubernetes gateway configuration...${NC}"
ROUTING_VIA_HOST=$(oc get network.operator.openshift.io cluster -o jsonpath='{.spec.defaultNetwork.ovnKubernetesConfig.gatewayConfig.routingViaHost}' 2>/dev/null)
if [ "$ROUTING_VIA_HOST" != "true" ]; then
    echo -e "${BRed}WARNING: routingViaHost is not enabled (current: ${ROUTING_VIA_HOST:-not set}).${NC}"
    echo -e "${BRed}Ambient mode requires routingViaHost: true.${NC}"
    echo "  oc patch network.operator.openshift.io cluster --type=merge \\"
    echo "    --patch='{\"spec\":{\"defaultNetwork\":{\"ovnKubernetesConfig\":{\"gatewayConfig\":{\"routingViaHost\":true}}}}}'"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${BGreen}routingViaHost is enabled${NC}"
fi
echo ""

# ============================================
# [1/9] Tracing Infrastructure
# ============================================
echo -e "${BGreen}[1/9] Installing Tracing Infrastructure${NC}"

oc new-project tracing-system 2>/dev/null || true

echo -e "${BYellow}Installing MinIO for Tempo storage...${NC}"
oc apply -f ./resources/tempootel/base/minio.yaml -n tracing-system
oc wait --for condition=Available deployment/minio --timeout 150s -n tracing-system

echo -e "${BYellow}Installing TempoStack...${NC}"
oc apply -f ./resources/tempootel/overlays/kiali/tempo.yaml -n tracing-system
oc wait --for condition=Ready TempoStack/sample --timeout 150s -n tracing-system
oc wait --for condition=Available deployment/tempo-sample-compactor --timeout 150s -n tracing-system

echo -e "${BYellow}Setting up OpenTelemetry Collector...${NC}"
oc new-project opentelemetrycollector 2>/dev/null || true
oc apply -f ./resources/tempootel/overlays/kiali/opentelemetrycollector.yaml -n opentelemetrycollector
oc wait --for condition=Available deployment/otel-collector --timeout 60s -n opentelemetrycollector

# ============================================
# [2/9] OSSM3 Ambient Mode
# ============================================
echo -e "${BGreen}[2/9] Installing OSSM3 (Ambient Mode)${NC}"

oc new-project istio-system 2>/dev/null || true
oc new-project istio-cni 2>/dev/null || true
oc new-project ztunnel 2>/dev/null || true

echo -e "${BYellow}Applying Ambient Mode configuration...${NC}"
oc apply -k ./resources/ossm3/overlays/ambient

echo "Waiting for Istio control plane..."
oc wait --for condition=Ready istio/default --timeout 120s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni
oc wait --for condition=Ready ztunnel/default --timeout 120s -n ztunnel || echo -e "${BYellow}ZTunnel may still be initializing...${NC}"

# ============================================
# [3/9] Telemetry + Monitoring
# ============================================
echo -e "${BGreen}[3/9] Configuring Telemetry and Monitoring${NC}"

oc apply -f ./resources/tempootel/base/istioTelemetry.yaml -n istio-system
oc apply -f ./resources/monitoring/ocpUserMonitoring.yaml
oc apply -f ./resources/monitoring/serviceMonitor.yaml -n istio-system
oc apply -f ./resources/monitoring/podMonitor.yaml -n istio-system

# ============================================
# [4/9] Gateway Infrastructure
# ============================================
echo -e "${BGreen}[4/9] Setting up Gateway Infrastructure${NC}"

oc apply -k ./resources/gateway
oc label namespace istio-ingress istio-injection=enabled --overwrite
oc wait --for condition=Available deployment/istio-ingressgateway --timeout 60s -n istio-ingress 2>/dev/null || true

# ============================================
# [5/9] Kiali
# ============================================
echo -e "${BGreen}[5/9] Installing Kiali${NC}"

oc apply -f ./resources/kiali/kialiCrb.yaml -n istio-system

export TRACING_INGRESS_ROUTE=""
if oc get route tempo-sample-query-frontend -n tracing-system &>/dev/null; then
    TRACING_INGRESS_ROUTE="https://$(oc get route tempo-sample-query-frontend -n tracing-system -o jsonpath='{.spec.host}')"
fi
cat ./resources/kiali/kialiCr.yaml | JAEGERROUTE="${TRACING_INGRESS_ROUTE}" envsubst | oc -n istio-system apply -f -

oc wait --for condition=Successful kiali/kiali --timeout 180s -n istio-system
oc annotate route kiali haproxy.router.openshift.io/timeout=60s -n istio-system --overwrite
oc apply -f ./resources/kiali/kialiOssmcCr.yaml -n istio-system
oc wait -n istio-system --for=condition=Successful OSSMConsole ossmconsole --timeout 120s || true

# ============================================
# [6/9] Bookinfo
# ============================================
echo -e "${BGreen}[6/9] Deploying Bookinfo${NC}"

oc apply -k ./resources/bookinfo/overlays/ambient
oc wait --for=condition=Ready pods --all -n ossm-bookinfo --timeout 120s

# Traffic generator
BOOKINFO_GW=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -n "$BOOKINFO_GW" ] && [ "$BOOKINFO_GW" != "<pending>" ]; then
    cat ./resources/bookinfo/base/traffic-generator-configmap.yaml | ROUTE="http://${BOOKINFO_GW}/productpage" envsubst | oc -n ossm-bookinfo apply -f -
    oc apply -f ./resources/bookinfo/base/traffic-generator.yaml -n ossm-bookinfo
fi

# ============================================
# [7/9] REST API + Canary
# ============================================
echo -e "${BGreen}[7/9] Deploying REST API with Canary Routing${NC}"

oc apply -k ./resources/rest-api-demo/kustomize/overlays/pod
oc wait --for=condition=Ready pods --all -n ossm-restapi --timeout 120s

# ============================================
# [8/9] httpbin (Traffic Management)
# ============================================
echo -e "${BGreen}[8/9] Deploying httpbin${NC}"

oc apply -k ./resources/demo-workloads/overlays/ossm-httpbin
oc wait --for=condition=Ready pods --all -n ossm-httpbin --timeout 60s

# ============================================
# [9/9] Mesh Enrollment Demo
# ============================================
echo -e "${BGreen}[9/9] Deploying Mesh Enrollment Demo${NC}"

oc apply -k ./resources/mesh-enrollment/base
oc wait --for=condition=Ready pods -l app=mesh-logger -n ossm-mesh-demo --timeout 60s
oc wait --for=condition=Ready pods -l app=mesh-pinger -n ossm-enrollment-test --timeout 60s

# Console banner
oc apply -k ./resources/console-banner/overlays/ambient 2>/dev/null || true

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BGreen}==========================================${NC}"
echo -e "${BGreen}  Installation Complete!                 ${NC}"
echo -e "${BGreen}==========================================${NC}"
echo ""

KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}' 2>/dev/null)

echo -e "${BGreen}Namespaces deployed:${NC}"
echo "  ossm-bookinfo       Bookinfo sample app"
echo "  ossm-restapi        REST API with canary routing"
echo "  ossm-httpbin        httpbin for traffic management demos"
echo "  ossm-mesh-demo      Mesh enrollment logger"
echo "  ossm-enrollment-test  Mesh enrollment pinger"
echo ""
echo -e "${BGreen}URLs:${NC}"

BOOKINFO_GW=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
RESTAPI_GW=$(oc get gateway hello-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)

[ -n "$BOOKINFO_GW" ] && echo "  Bookinfo:  http://${BOOKINFO_GW}/productpage"
[ -n "$RESTAPI_GW" ] && echo "  REST API:  http://${RESTAPI_GW}/hello"
[ -n "$KIALI_HOST" ] && echo "  Kiali:     https://${KIALI_HOST}"
echo ""
echo -e "${BGreen}Demo console:${NC}"
echo "  cd demo-console && npm install && node server.js"
echo "  Open http://localhost:3000"
echo ""
echo -e "${BGreen}Optional: Deploy AI models (requires RHOAI operator):${NC}"
echo "  oc apply -k ./resources/operators/overlays/rhoai"
echo "  oc apply -k ./resources/rhoai/overlays/models"
echo ""
echo -e "${BGreen}==========================================${NC}"

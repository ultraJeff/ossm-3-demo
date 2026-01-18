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
echo "This script sets up the complete OSSM3 demo with Ambient Mode."
echo "- No sidecars required"
echo "- ZTunnel for L4 traffic and mTLS"
echo "- Waypoint gateway for L7 policies and observability"
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

# ============================================
# Install Tracing Infrastructure
# ============================================
echo -e "${BGreen}[1/7] Installing Tracing Infrastructure${NC}"

echo -e "${BYellow}Creating tracing-system namespace...${NC}"
oc new-project tracing-system 2>/dev/null || oc project tracing-system

echo -e "${BYellow}Installing MinIO for Tempo storage...${NC}"
oc apply -f ./resources/tempootel/base/minio.yaml -n tracing-system
echo "Waiting for MinIO to become available..."
oc wait --for condition=Available deployment/minio --timeout 150s -n tracing-system

echo -e "${BYellow}Installing TempoStack (Kiali-compatible)...${NC}"
oc apply -f ./resources/tempootel/overlays/kiali/tempo.yaml -n tracing-system
echo "Waiting for TempoStack to become ready..."
oc wait --for condition=Ready TempoStack/sample --timeout 150s -n tracing-system
echo "Waiting for Tempo compactor deployment..."
oc wait --for condition=Available deployment/tempo-sample-compactor --timeout 150s -n tracing-system

echo -e "${BYellow}Setting up OpenTelemetry Collector...${NC}"
oc new-project opentelemetrycollector 2>/dev/null || oc project opentelemetrycollector
oc apply -f ./resources/tempootel/overlays/kiali/opentelemetrycollector.yaml -n opentelemetrycollector
echo "Waiting for OpenTelemetryCollector deployment..."
oc wait --for condition=Available deployment/otel-collector --timeout 60s -n opentelemetrycollector

# ============================================
# Install OSSM3 with Ambient Mode
# ============================================
echo -e "${BGreen}[2/7] Installing OSSM3 (Ambient Mode)${NC}"

echo -e "${BYellow}Creating namespaces...${NC}"
oc new-project istio-system 2>/dev/null || true
oc new-project istio-cni 2>/dev/null || true
oc new-project istio-ingress 2>/dev/null || true
oc new-project ztunnel 2>/dev/null || true

echo -e "${BYellow}Applying Ambient Mode configuration...${NC}"
oc apply -k ./resources/ossm3/overlays/ambient

echo "Waiting for Istio control plane..."
oc wait --for condition=Ready istio/default --timeout 120s -n istio-system

echo "Waiting for IstioCNI..."
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni

echo "Waiting for ZTunnel..."
oc wait --for condition=Ready ztunnel/default --timeout 120s -n ztunnel || echo -e "${BYellow}ZTunnel may still be initializing...${NC}"

# Verify ztunnel daemonset
if oc get daemonset ztunnel -n ztunnel &>/dev/null; then
    echo -e "${BGreen}ZTunnel daemonset is running${NC}"
else
    echo -e "${BRed}Warning: ZTunnel daemonset not found${NC}"
fi

# ============================================
# Configure Telemetry
# ============================================
echo -e "${BGreen}[3/7] Configuring Telemetry${NC}"

echo -e "${BYellow}Installing Istio Telemetry resource...${NC}"
oc apply -f ./resources/tempootel/base/istioTelemetry.yaml -n istio-system

# ============================================
# Set up Gateway Infrastructure
# ============================================
echo -e "${BGreen}[4/7] Setting up Gateway Infrastructure${NC}"

echo -e "${BYellow}Labeling istio-ingress namespace...${NC}"
oc label namespace istio-ingress istio-injection=enabled --overwrite

echo -e "${BYellow}Creating Gateway API ingress...${NC}"
oc apply -k ./resources/gateway

echo "Waiting for ingress gateway deployment..."
oc wait --for condition=Available deployment/istio-ingressgateway --timeout 60s -n istio-ingress 2>/dev/null || true

# ============================================
# Set up Monitoring
# ============================================
echo -e "${BGreen}[5/7] Enabling Monitoring${NC}"

echo -e "${BYellow}Enabling user workload monitoring...${NC}"
oc apply -f ./resources/monitoring/ocpUserMonitoring.yaml

echo -e "${BYellow}Creating monitors in istio namespaces...${NC}"
oc apply -f ./resources/monitoring/serviceMonitor.yaml -n istio-system
oc apply -f ./resources/monitoring/podMonitor.yaml -n istio-system
oc apply -f ./resources/monitoring/podMonitor.yaml -n istio-ingress

# ============================================
# Install Kiali
# ============================================
echo -e "${BGreen}[6/7] Installing Kiali${NC}"

oc project istio-system

echo -e "${BYellow}Creating Kiali RBAC...${NC}"
oc apply -f ./resources/kiali/kialiCrb.yaml -n istio-system

echo -e "${BYellow}Installing Kiali CR...${NC}"
# Get Jaeger UI route from TempoStack
export TRACING_INGRESS_ROUTE=""
if oc get route tempo-sample-query-frontend -n tracing-system &>/dev/null; then
    TRACING_INGRESS_ROUTE="https://$(oc get route tempo-sample-query-frontend -n tracing-system -o jsonpath='{.spec.host}')"
fi
cat ./resources/kiali/kialiCr.yaml | JAEGERROUTE="${TRACING_INGRESS_ROUTE}" envsubst | oc -n istio-system apply -f -

echo "Waiting for Kiali..."
oc wait --for condition=Successful kiali/kiali --timeout 180s -n istio-system
oc annotate route kiali haproxy.router.openshift.io/timeout=60s -n istio-system --overwrite

echo -e "${BYellow}Installing OSSM Console plugin...${NC}"
oc apply -f ./resources/kiali/kialiOssmcCr.yaml -n istio-system
oc wait -n istio-system --for=condition=Successful OSSMConsole ossmconsole --timeout 120s || true

# ============================================
# Deploy Bookinfo with Ambient Mode
# ============================================
echo -e "${BGreen}[7/7] Deploying Bookinfo (Ambient Mode)${NC}"

echo -e "${BYellow}Deploying Bookinfo with waypoint gateway...${NC}"
oc apply -k ./resources/bookinfo/overlays/ambient

echo "Waiting for bookinfo pods..."
oc wait --for=condition=Ready pods --all -n bookinfo --timeout 120s

# Apply console banner
echo -e "${BYellow}Applying ambient mode console banner...${NC}"
oc apply -k ./resources/console-banner/overlays/ambient

# ============================================
# Final Setup
# ============================================
echo ""
echo -e "${BGreen}==========================================${NC}"
echo -e "${BGreen}  Installation Complete!                 ${NC}"
echo -e "${BGreen}==========================================${NC}"
echo ""

# Wait for Gateway address
echo -e "${BYellow}Waiting for Gateway address...${NC}"
for i in {1..30}; do
    INGRESSHOST=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
    if [ ! -z "$INGRESSHOST" ] && [ "$INGRESSHOST" != "<pending>" ]; then
        echo -e "${BGreen}Gateway address obtained: $INGRESSHOST${NC}"
        break
    fi
    echo "Waiting for Gateway address (attempt $i/30)..."
    sleep 2
done

if [ -z "$INGRESSHOST" ] || [ "$INGRESSHOST" == "<pending>" ]; then
    echo -e "${BYellow}Warning: Gateway address not yet available.${NC}"
    INGRESSHOST="<pending>"
fi

# Install traffic generator
if [ "$INGRESSHOST" != "<pending>" ]; then
    echo -e "${BYellow}Installing traffic generator...${NC}"
    cat ./resources/bookinfo/base/traffic-generator-configmap.yaml | ROUTE="http://${INGRESSHOST}/productpage" envsubst | oc -n bookinfo apply -f -
    
    if oc get rs kiali-traffic-generator -n bookinfo &>/dev/null; then
        oc delete rs kiali-traffic-generator -n bookinfo --force --grace-period=0 2>/dev/null
    fi
    oc apply -f ./resources/bookinfo/base/traffic-generator.yaml -n bookinfo
    oc wait --for=condition=Ready pod -l app=kiali-traffic-generator -n bookinfo --timeout=60s 2>/dev/null || true
fi

# Get URLs
KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}' 2>/dev/null)
CONSOLE_URL=$(oc whoami --show-console 2>/dev/null)

echo ""
echo -e "${BGreen}=== Ambient Mode Verification ===${NC}"
echo ""
echo "Pods should show 1/1 containers (no sidecars):"
echo "  oc get pods -n bookinfo"
echo ""
echo "Namespace should have istio.io/dataplane-mode=ambient:"
echo "  oc get namespace bookinfo -o yaml | grep -A5 labels"
echo ""
echo "ZTunnel should be running on all nodes:"
echo "  oc get daemonset ztunnel -n ztunnel"
echo ""
echo "Waypoint gateway should exist:"
echo "  oc get gateway bookinfo-waypoint -n bookinfo"
echo ""
echo -e "${BGreen}=== URLs ===${NC}"
echo ""
if [ "$INGRESSHOST" != "<pending>" ]; then
    echo -e "Bookinfo:          ${BBlue}http://${INGRESSHOST}/productpage${NC}"
else
    echo "Bookinfo:          <pending - check: oc get gateway bookinfo-gateway -n istio-ingress>"
fi
if [ ! -z "$KIALI_HOST" ]; then
    echo -e "Kiali:             ${BBlue}https://${KIALI_HOST}${NC}"
fi
if [ ! -z "$CONSOLE_URL" ]; then
    echo -e "OpenShift Console: ${BBlue}${CONSOLE_URL}${NC}"
fi
echo ""
echo -e "${BGreen}=== Test Commands ===${NC}"
echo ""
echo "# Test Bookinfo"
echo "curl -s http://${INGRESSHOST}/productpage | grep -o '<title>.*</title>'"
echo ""
echo "# Test RestAPI"
echo "sh ./scripts/test-api.sh"
echo ""
echo -e "${BGreen}==========================================${NC}"


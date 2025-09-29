#!/bin/bash

NC='\033[0m'          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow

echo -e "${BGreen}Deploying Bookinfo in Traditional Sidecar Mode${NC}"

# Ensure we're using the traditional Istio configuration
echo -e "${BYellow}Applying traditional OSSM3 configuration...${NC}"
# Delete existing ingress gateway deployment if it exists (selector is immutable)
# if oc get deployment istio-ingressgateway -n istio-ingress &>/dev/null; then
#     echo -e "${BYellow}Removing existing ingress gateway deployment to update selector...${NC}"
#     oc delete deployment istio-ingressgateway -n istio-ingress --force --grace-period=0
# fi
oc apply -k resources/ossm3/overlays/traditional
oc wait --for condition=Ready istio/default --timeout 60s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni

# Deploy bookinfo with sidecar injection
echo -e "${BYellow}Deploying Bookinfo with sidecar injection...${NC}"
oc apply -k resources/bookinfo/overlays/traditional

echo -e "${BYellow}Waiting for pods to be ready...${NC}"
oc wait --for=condition=Ready pods --all -n bookinfo --timeout 120s

echo -e "${BGreen}Traditional Sidecar Mode Deployment Complete!${NC}"
echo "=================================================================================================="
echo -e "${BGreen}Verification:${NC}"
echo "Pods should show 2/2 containers (app + istio-proxy):"
echo "oc get pods -n bookinfo"
echo ""
echo "Namespace should have istio-injection=enabled:"
echo "oc get namespace bookinfo -o yaml | grep labels -A5"
echo ""
# INGRESSHOST=$(oc get route istio-ingressgateway -n istio-ingress -o=jsonpath='{.spec.host}' 2>/dev/null)
INGRESSHOST=$($(oc get gateway bookinfo-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}') 2>/dev/null)
if [ ! -z "$INGRESSHOST" ]; then
    echo "Bookinfo URL: http://${INGRESSHOST}/productpage"
fi
echo "=================================================================================================="
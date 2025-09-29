#!/bin/bash

NC='\033[0m'          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow
BRed='\033[1;31m'     # Red

echo -e "${BGreen}Deploying Bookinfo in Ambient Mode with Waypoint${NC}"

# Check if OSSM3 ambient infrastructure is deployed
echo -e "${BYellow}Checking ambient mode infrastructure...${NC}"

# Deploy ambient OSSM3 configuration
echo -e "${BYellow}Applying ambient OSSM3 configuration...${NC}"
oc apply -k resources/ossm3/overlays/ambient
oc wait --for condition=Ready istio/default --timeout 90s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni
oc wait --for condition=Ready ztunnel/default --timeout 60s -n ztunnel

# Verify ztunnel is running
echo -e "${BYellow}Verifying ztunnel deployment...${NC}"
if ! oc get daemonset ztunnel -n ztunnel &>/dev/null; then
    echo -e "${BRed}Warning: ztunnel daemonset not found. Ambient mode may not work properly.${NC}"
fi

# Deploy bookinfo in ambient mode
echo -e "${BYellow}Deploying Bookinfo in ambient mode with waypoint...${NC}"
oc apply -k bookinfo/overlays/ambient

echo -e "${BYellow}Waiting for pods to be ready...${NC}"
oc wait --for=condition=Ready pods --all -n bookinfo --timeout 120s

echo -e "${BGreen}Ambient Mode Deployment Complete!${NC}"
echo "=================================================================================================="
echo -e "${BGreen}Verification:${NC}"
echo "Pods should show 1/1 containers (no sidecars):"
echo "oc get pods -n bookinfo"
echo ""
echo "Namespace should have istio.io/dataplane-mode=ambient:"
echo "oc get namespace bookinfo -o yaml | grep labels -A5"
echo ""
echo "ZTunnel should be running:"
echo "oc get daemonset ztunnel -n ztunnel"
echo ""
echo "Waypoint gateway should exist for L7 observability:"
echo "oc get gateway bookinfo-waypoint -n bookinfo"
echo ""
INGRESSHOST=$(oc get route istio-ingressgateway -n istio-ingress -o=jsonpath='{.spec.host}' 2>/dev/null)
if [ ! -z "$INGRESSHOST" ]; then
    echo "Bookinfo URL: http://${INGRESSHOST}/productpage"
fi
KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}' 2>/dev/null)
if [ ! -z "$KIALI_HOST" ]; then
    echo "Kiali URL: https://${KIALI_HOST}"
fi
echo "=================================================================================================="
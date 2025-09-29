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
# Delete existing ingress gateway deployment if it exists (selector is immutable)
# if oc get deployment istio-ingressgateway -n istio-ingress &>/dev/null; then
#     echo -e "${BYellow}Removing existing ingress gateway deployment to update selector...${NC}"
#     oc delete deployment istio-ingressgateway -n istio-ingress --force --grace-period=0
# fi
oc apply -k resources/ossm3/overlays/ambient
oc wait --for condition=Ready istio/default --timeout 90s -n istio-system
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni
# Wait for ztunnel with increased timeout since it's a new deployment
oc wait --for condition=Ready ztunnel/default --timeout 120s -n ztunnel || echo -e "${BYellow}ZTunnel may still be initializing...${NC}"

# Verify ztunnel is running
echo -e "${BYellow}Verifying ztunnel deployment...${NC}"
if ! oc get daemonset ztunnel -n ztunnel &>/dev/null; then
    echo -e "${BRed}Warning: ztunnel daemonset not found. Ambient mode may not work properly.${NC}"
fi

# Deploy bookinfo in ambient mode
echo -e "${BYellow}Deploying Bookinfo in ambient mode with waypoint...${NC}"
oc apply -k resources/bookinfo/overlays/ambient

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
# Wait for Gateway to get an address
for i in {1..15}; do
    INGRESSHOST=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
    if [ ! -z "$INGRESSHOST" ]; then
        break
    fi
    echo "Waiting for Gateway address (attempt $i/15)..."
    sleep 2
done

echo "[optional] Installing Bookinfo traffic generator..."
if [ "$INGRESSHOST" != "<pending>" ]; then
  # Update the ConfigMap with the new route
  cat ./resources/bookinfo/base/traffic-generator-configmap.yaml | ROUTE="http://${INGRESSHOST}/productpage" envsubst | oc -n bookinfo apply -f -
  
  # Check if the ReplicaSet already exists
  if oc get rs kiali-traffic-generator -n bookinfo &>/dev/null; then
    echo "Traffic generator already exists, restarting it with new configuration..."
    # Delete existing pods to force them to pick up the new ConfigMap
    oc delete rs kiali-traffic-generator -n bookinfo --force --grace-period=0
    # Recreate the ReplicaSet
    oc apply -f ./resources/bookinfo/base/traffic-generator.yaml -n bookinfo
  else
    # Create new ReplicaSet
    oc apply -f ./resources/bookinfo/base/traffic-generator.yaml -n bookinfo
  fi
  
  echo "Waiting for traffic generator to start..."
  oc wait --for=condition=Ready pod -l app=kiali-traffic-generator -n bookinfo --timeout=60s 2>/dev/null || true
else
  echo "Skipping traffic generator installation as Gateway address is not yet available."
fi

if [ ! -z "$INGRESSHOST" ]; then
    echo "Bookinfo URL: http://${INGRESSHOST}/productpage"
fi
KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}' 2>/dev/null)
if [ ! -z "$KIALI_HOST" ]; then
    echo "Kiali URL: https://${KIALI_HOST}"
fi
echo "=================================================================================================="
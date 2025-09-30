#!/bin/bash

# JWT Authentication Test Script for OpenShift Service Mesh 3
# This script tests JWT authentication on the REST API gateway

# Don't exit on error immediately, we want to provide helpful messages
set +e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo "JWT Authentication Test for Service Mesh Gateway"
echo "================================================"
echo ""

# Check if logged into OpenShift
oc whoami &>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: You are not logged into OpenShift.${NC}"
    echo ""
    echo "Please log in first:"
    echo "  oc login <your-openshift-url>"
    echo ""
    echo "Or if using the demo environment:"
    echo "  oc login https://api.cluster-k252r.k252r.sandbox1112.opentlc.com:6443"
    exit 1
fi

# Get the gateway URL
GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}' 2>/dev/null)

if [ -z "$GATEWAY" ]; then
    echo -e "${YELLOW}Warning: Could not find gateway URL.${NC}"
    echo ""
    
    # Check if the gateway exists at all
    oc get gateway hello-gateway -n istio-ingress &>/dev/null
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Gateway 'hello-gateway' does not exist in namespace 'istio-ingress'.${NC}"
        echo ""
        echo "Make sure you have:"
        echo "1. Installed the OSSM3 demo:"
        echo "   ./install_operators.sh"
        echo "   ./install_ossm3_demo.sh"
        echo ""
        echo "2. Deployed the RestAPI application:"
        echo "   oc apply -k ./resources/application/kustomize/overlays/pod"
        echo ""
        echo "3. Created the gateway:"
        echo "   oc apply -k ./resources/gateway"
    else
        echo -e "${RED}Error: Gateway exists but has no address yet.${NC}"
        echo "The gateway may still be provisioning. Wait a moment and try again."
        echo ""
        echo "Check gateway status:"
        echo "  oc describe gateway hello-gateway -n istio-ingress"
    fi
    exit 1
fi

echo -e "${GREEN}Gateway URL: $GATEWAY${NC}"
echo ""

# Function to test an endpoint
test_endpoint() {
    local description=$1
    local curl_cmd=$2
    local expected_code=$3
    
    echo -e "${YELLOW}Test: $description${NC}"
    echo "Command: $curl_cmd"
    
    # Execute curl and capture response code
    response=$(eval "$curl_cmd -w '\n%{http_code}'" 2>/dev/null)
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_code" ]; then
        echo -e "${GREEN}✓ Passed: Got expected HTTP $http_code${NC}"
        if [ ! -z "$body" ] && [ "$http_code" = "200" ]; then
            echo "Response body:"
            echo "$body" | jq . 2>/dev/null || echo "$body"
        fi
    else
        echo -e "${RED}✗ Failed: Expected HTTP $expected_code, got HTTP $http_code${NC}"
        if [ ! -z "$body" ]; then
            echo "Response body:"
            echo "$body"
        fi
    fi
    echo ""
}

# Test 1: Request without token (should fail with Forbidden)
test_endpoint \
    "Request without JWT token (should return 403)" \
    "curl -s -o /dev/null $GATEWAY/hello" \
    "403"

# Test 2: Request to /docs endpoint without token (should succeed)
test_endpoint \
    "Docs endpoint without JWT token (should return 200)" \
    "curl -s -o /dev/null $GATEWAY/docs" \
    "200"

# Test 3: Request with invalid token (should fail with Unauthorized)
test_endpoint \
    "Request with invalid JWT token (should return 401)" \
    "curl -s -o /dev/null -H 'Authorization: Bearer invalid.jwt.token' $GATEWAY/hello" \
    "401"

# Test 4: Demo token verification with SSH RSA key
if [ -f "resources/jwt-auth/overlays/demo/demo-token.txt" ]; then
    TOKEN=$(cat resources/jwt-auth/overlays/demo/demo-token.txt | tr -d '\n')
    if [ ! -z "$TOKEN" ]; then
        echo -e "${YELLOW}Testing with demo token (generated from SSH key)...${NC}"
        test_endpoint \
            "Request with demo JWT token" \
            "curl -s -H 'Authorization: Bearer $TOKEN' $GATEWAY/hello" \
            "200"
    fi
elif [ ! -z "$JWT_TOKEN" ]; then
    echo -e "${YELLOW}Testing with JWT_TOKEN environment variable...${NC}"
    test_endpoint \
        "Request with JWT from environment" \
        "curl -s -H 'Authorization: Bearer $JWT_TOKEN' $GATEWAY/hello" \
        "200"
else
    echo -e "${YELLOW}No demo token found. Set JWT_TOKEN environment variable to test with a valid token.${NC}"
fi

# Test 5: Check RequestAuthentication status
echo -e "${YELLOW}Checking RequestAuthentication configuration:${NC}"
oc get requestauthentication -n istio-ingress jwt-auth -o jsonpath='{.spec.jwtRules[0].issuer}' 2>/dev/null
if [ $? -eq 0 ]; then
    issuer=$(oc get requestauthentication -n istio-ingress jwt-auth -o jsonpath='{.spec.jwtRules[0].issuer}')
    echo -e "${GREEN}✓ RequestAuthentication configured with issuer: $issuer${NC}"
else
    echo -e "${RED}✗ RequestAuthentication not found or not configured${NC}"
fi

echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"

# Check if JWT auth is properly configured
ra_exists=$(oc get requestauthentication -n istio-ingress jwt-auth 2>/dev/null | wc -l)
ap_exists=$(oc get authorizationpolicy -n istio-ingress jwt-authz 2>/dev/null | wc -l)

if [ $ra_exists -gt 0 ] && [ $ap_exists -gt 0 ]; then
    echo -e "${GREEN}✓ JWT authentication is configured and active${NC}"
    echo ""
    echo "To test with your own JWT token:"
    echo "  export JWT_TOKEN='your-token-here'"
    echo "  ./test-jwt-auth.sh"
    echo ""
    echo "Or directly:"
    echo "  curl -H 'Authorization: Bearer \$JWT_TOKEN' $GATEWAY/hello"
else
    echo -e "${RED}✗ JWT authentication is not fully configured${NC}"
    echo ""
    echo "To enable JWT authentication, run one of:"
    echo "  oc apply -k resources/jwt-auth/overlays/demo      # For demo/testing"
    echo "  oc apply -k resources/jwt-auth/overlays/keycloak  # For Keycloak/RHSSO"
    echo "  oc apply -k resources/jwt-auth/overlays/auth0     # For Auth0"
fi
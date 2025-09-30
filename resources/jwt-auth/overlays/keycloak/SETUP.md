# Keycloak/RHSSO JWT Setup Guide

## Prerequisites
- Keycloak or Red Hat SSO installed and accessible
- Admin access to create realms, clients, and users

## Setup Steps

### 1. Create a Realm (if needed)
```bash
# Using Keycloak Admin CLI
kcadm.sh create realms -s realm=rest-api-realm -s enabled=true
```

### 2. Create a Client for the REST API
```bash
kcadm.sh create clients -r rest-api-realm \
  -s clientId=rest-api \
  -s enabled=true \
  -s publicClient=false \
  -s standardFlowEnabled=false \
  -s serviceAccountsEnabled=true \
  -s directAccessGrantsEnabled=true
```

### 3. Create Roles
```bash
# Create realm roles
kcadm.sh create roles -r rest-api-realm -s name=api-user
kcadm.sh create roles -r rest-api-realm -s name=rest-api-access
kcadm.sh create roles -r rest-api-realm -s name=admin
```

### 4. Create a Test User
```bash
kcadm.sh create users -r rest-api-realm \
  -s username=testuser \
  -s enabled=true \
  -s email=testuser@example.com

# Set password
kcadm.sh set-password -r rest-api-realm \
  --username testuser \
  --new-password test123

# Assign roles
kcadm.sh add-roles -r rest-api-realm \
  --uusername testuser \
  --rolename api-user \
  --rolename rest-api-access
```

## Configuration

### 1. Update the RequestAuthentication with your Keycloak URL
```bash
export KEYCLOAK_URL="https://your-keycloak.example.com"
export REALM="rest-api-realm"

oc patch requestauthentication jwt-auth -n istio-ingress --type='json' \
  -p='[
    {"op": "replace", "path": "/spec/jwtRules/0/issuer", "value": "'${KEYCLOAK_URL}'/auth/realms/'${REALM}'"},
    {"op": "replace", "path": "/spec/jwtRules/0/jwksUri", "value": "'${KEYCLOAK_URL}'/auth/realms/'${REALM}'/protocol/openid-connect/certs"}
  ]'
```

### 2. Get a Token from Keycloak
```bash
export TOKEN=$(curl -s -X POST "${KEYCLOAK_URL}/auth/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=testuser" \
  -d "password=test123" \
  -d "grant_type=password" \
  -d "client_id=rest-api" \
  -d "client_secret=YOUR_CLIENT_SECRET" | jq -r '.access_token')

echo $TOKEN
```

### 3. Test the Protected API
```bash
export GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')

# This should work
curl -H "Authorization: Bearer $TOKEN" $GATEWAY/hello | jq

# This should fail with 401
curl $GATEWAY/hello
```

## Using with Red Hat SSO on OpenShift

If you're using Red Hat SSO Operator on OpenShift:

### 1. Deploy Red Hat SSO
```yaml
apiVersion: keycloak.org/v1alpha1
kind: Keycloak
metadata:
  name: rhsso
  namespace: rhsso
spec:
  instances: 1
  externalAccess:
    enabled: true
```

### 2. Create Keycloak Realm
```yaml
apiVersion: keycloak.org/v1alpha1
kind: KeycloakRealm
metadata:
  name: rest-api-realm
  namespace: rhsso
spec:
  realm:
    realm: rest-api-realm
    enabled: true
    displayName: REST API Realm
  instanceSelector:
    matchLabels:
      app: rhsso
```

### 3. Create Keycloak Client
```yaml
apiVersion: keycloak.org/v1alpha1
kind: KeycloakClient
metadata:
  name: rest-api-client
  namespace: rhsso
spec:
  realmSelector:
    matchLabels:
      app: rest-api-realm
  client:
    clientId: rest-api
    standardFlowEnabled: false
    directAccessGrantsEnabled: true
    serviceAccountsEnabled: true
    publicClient: false
```

## Troubleshooting

### Check JWT Claims
```bash
# Decode the token to see claims
echo $TOKEN | cut -d. -f2 | base64 -d | jq
```

### Verify JWKS Endpoint
```bash
curl "${KEYCLOAK_URL}/auth/realms/${REALM}/protocol/openid-connect/certs" | jq
```

### Check Istio Logs
```bash
oc logs -n istio-ingress deployment/istio-ingressgateway -c istio-proxy --tail=100 | grep -i jwt
```
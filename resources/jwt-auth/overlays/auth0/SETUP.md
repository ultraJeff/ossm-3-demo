# Auth0 JWT Setup Guide

## Prerequisites
- Auth0 account with a tenant created
- Access to Auth0 Dashboard

## Setup in Auth0 Dashboard

### 1. Create an API
1. Navigate to **APIs** in the Auth0 Dashboard
2. Click **Create API**
3. Configure:
   - **Name**: REST API Service Mesh
   - **Identifier**: `https://rest-api.example.com` (This becomes the audience)
   - **Signing Algorithm**: RS256

### 2. Create an Application (Optional - for testing)
1. Navigate to **Applications**
2. Click **Create Application**
3. Choose:
   - **Name**: REST API Test Client
   - **Type**: Machine to Machine
4. Authorize for your API:
   - Select the API created above
   - Grant necessary scopes

### 3. Create Scopes/Permissions
In your API settings, add scopes:
- `read:api`
- `write:api`
- `admin:api`

## Configure Service Mesh

### 1. Update RequestAuthentication with your Auth0 details
```bash
export AUTH0_DOMAIN="your-tenant.auth0.com"
export API_IDENTIFIER="https://rest-api.example.com"

oc patch requestauthentication jwt-auth -n istio-ingress --type='json' \
  -p='[
    {"op": "replace", "path": "/spec/jwtRules/0/issuer", "value": "https://'${AUTH0_DOMAIN}'/"},
    {"op": "replace", "path": "/spec/jwtRules/0/jwksUri", "value": "https://'${AUTH0_DOMAIN}'/.well-known/jwks.json"},
    {"op": "replace", "path": "/spec/jwtRules/0/audiences/0", "value": "'${API_IDENTIFIER}'"}
  ]'
```

## Getting Tokens

### Option 1: Using Client Credentials (M2M)
```bash
export AUTH0_DOMAIN="your-tenant.auth0.com"
export CLIENT_ID="YOUR_CLIENT_ID"
export CLIENT_SECRET="YOUR_CLIENT_SECRET"
export API_IDENTIFIER="https://rest-api.example.com"

export TOKEN=$(curl -s -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "'${CLIENT_ID}'",
    "client_secret": "'${CLIENT_SECRET}'",
    "audience": "'${API_IDENTIFIER}'",
    "grant_type": "client_credentials"
  }' | jq -r '.access_token')

echo $TOKEN
```

### Option 2: Using Resource Owner Password (Test only!)
```bash
# Note: This requires enabling the Password grant type in your Auth0 application
export TOKEN=$(curl -s -X POST "https://${AUTH0_DOMAIN}/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "password",
    "username": "test@example.com",
    "password": "TestPassword123!",
    "audience": "'${API_IDENTIFIER}'",
    "client_id": "'${CLIENT_ID}'",
    "client_secret": "'${CLIENT_SECRET}'"
  }' | jq -r '.access_token')
```

### Option 3: Using Auth0 CLI
```bash
# Install Auth0 CLI first
auth0 login
auth0 test token -a ${API_IDENTIFIER} -s read:api write:api
```

## Testing the Protected API

```bash
export GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')

# Test with valid token (should work)
curl -H "Authorization: Bearer $TOKEN" $GATEWAY/hello | jq

# Test without token (should fail with 401)
curl -v $GATEWAY/hello

# Test with invalid token (should fail with 401)
curl -v -H "Authorization: Bearer invalid.token" $GATEWAY/hello
```

## Advanced Configuration

### Custom Claims with Auth0 Rules
Create a rule in Auth0 to add custom claims:

```javascript
function addCustomClaims(user, context, callback) {
  const namespace = 'https://rest-api.example.com/';
  
  context.accessToken[namespace + 'roles'] = user.app_metadata.roles || [];
  context.accessToken[namespace + 'department'] = user.user_metadata.department || 'default';
  
  callback(null, user, context);
}
```

### Update Authorization Policy for Custom Claims
```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: jwt-authz
  namespace: istio-ingress
spec:
  selector:
    matchLabels:
      app: hello-gateway
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["*"]
    when:
    - key: request.auth.claims[https://rest-api.example.com/roles]
      values: ["api-user", "admin"]
```

## Troubleshooting

### Verify Token Contents
```bash
# Decode and inspect the JWT
echo $TOKEN | cut -d. -f2 | base64 -d | jq
```

### Check Auth0 JWKS
```bash
curl "https://${AUTH0_DOMAIN}/.well-known/jwks.json" | jq
```

### Verify OpenID Configuration
```bash
curl "https://${AUTH0_DOMAIN}/.well-known/openid-configuration" | jq
```

### Check Istio Logs
```bash
oc logs -n istio-ingress deployment/istio-ingressgateway -c istio-proxy --tail=100 | grep -i jwt
```

### Common Issues
1. **Invalid audience**: Make sure the audience in your token matches what's configured in RequestAuthentication
2. **Expired token**: Auth0 tokens typically expire after 24 hours for M2M tokens
3. **Wrong issuer**: Ensure the issuer ends with a trailing slash (/)
4. **Rate limiting**: Auth0 has rate limits on token endpoint - cache tokens appropriately
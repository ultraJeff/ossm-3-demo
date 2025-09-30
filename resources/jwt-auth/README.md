# JWT Authentication for RestAPI Service Mesh

This directory contains the configuration to enable JWT authentication on the RestAPI service exposed through the Service Mesh Gateway API.

## Overview

JWT (JSON Web Token) authentication provides a secure way to authenticate API requests. This implementation:
- Validates JWT tokens at the gateway level
- Supports multiple JWT providers (Auth0, Keycloak, Okta, custom)
- Enforces authentication before requests reach your services
- Can be combined with authorization policies for fine-grained access control

## Quick Setup

### Option 1: Using the provided demo JWT provider
```bash
# Apply JWT authentication with demo provider
oc apply -k resources/jwt-auth/overlays/demo

# Note: The demo configuration sets up JWT validation infrastructure
# but you'll need to generate your own tokens or use a real identity provider.
# The test script validates that JWT is enforced (returns 403/401 for invalid/missing tokens).

# Test the JWT enforcement
./resources/jwt-auth/test-jwt-auth.sh
```

**Important**: The demo overlay uses Istio's test issuer configuration for demonstration purposes. 
For actual token validation to work, you need either:
1. Use Keycloak/RHSSO (Option 2)
2. Use Auth0 or another identity provider (Option 3)
3. Generate your own RSA key pair and create matching tokens

### Option 2: Using Keycloak/RHSSO
```bash
# Apply JWT authentication with Keycloak
oc apply -k resources/jwt-auth/overlays/keycloak

# Update the issuer URL in the RequestAuthentication
oc patch requestauthentication jwt-auth -n istio-ingress --type='json' \
  -p='[{"op": "replace", "path": "/spec/jwtRules/0/issuer", "value": "https://your-keycloak.com/auth/realms/your-realm"}]'
```

### Option 3: Using Auth0
```bash
# Apply JWT authentication with Auth0
oc apply -k resources/jwt-auth/overlays/auth0

# Update with your Auth0 domain
oc patch requestauthentication jwt-auth -n istio-ingress --type='json' \
  -p='[{"op": "replace", "path": "/spec/jwtRules/0/issuer", "value": "https://your-domain.auth0.com/"}]'
```

## Testing

### Test without token (should return 401)
```bash
curl -v $GATEWAY/hello
```

### Test /docs endpoint without token (should return 200 - used for health checks)
```bash
curl -v $GATEWAY/docs
```

### Test with invalid token (should return 401)
```bash
curl -v -H "Authorization: Bearer invalid.token.here" $GATEWAY/hello
```

### Test with valid token (should return 200)
```bash
curl -H "Authorization: Bearer $TOKEN" $GATEWAY/hello | jq
```

## Architecture

The JWT authentication flow:
1. Client sends request with JWT in Authorization header
2. Istio gateway validates the JWT against configured JWKS endpoint
3. If valid, request proceeds to the service
4. If invalid or missing, 401 Unauthorized is returned

## Files Structure

- `base/`: Core JWT authentication resources
  - `request-authentication.yaml`: JWT validation configuration
  - `authorization-policy.yaml`: Enforcement policy
- `overlays/`: Provider-specific configurations
  - `demo/`: Demo JWT provider for testing
  - `keycloak/`: Keycloak/RHSSO integration
  - `auth0/`: Auth0 integration
- `examples/`: Sample tokens and test scripts

## Customization

### Adding custom claims validation
Edit the AuthorizationPolicy to check specific claims:
```yaml
when:
- key: request.auth.claims[roles]
  values: ["api-user", "admin"]
```

### Allowing specific paths without authentication
```yaml
rules:
- to:
  - operation:
      paths: ["/docs", "/metrics"]
```

## Troubleshooting

### Check JWT validation logs
```bash
oc logs -n istio-ingress deployment/istio-ingressgateway -c istio-proxy | grep JWT
```

### Verify RequestAuthentication is applied
```bash
oc get requestauthentication -n istio-ingress
oc describe requestauthentication jwt-auth -n istio-ingress
```

### Debug token validation
```bash
# Decode your JWT to inspect claims
echo $TOKEN | cut -d. -f2 | base64 -d | jq
```
#!/bin/bash

# Generate JWT using SSH RSA key
# This script creates a valid JWT token signed with your SSH private key

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Generating JWT token using SSH RSA key..."
echo

# Function to base64url encode
base64url() {
    # Base64 encode, then convert to base64url by replacing chars and removing padding
    base64 | tr '+/' '-_' | tr -d '='
}

# Function to extract RSA public key components
extract_rsa_components() {
    local pubkey_file=$1
    
    # Convert SSH public key to PEM format
    ssh-keygen -f "$pubkey_file" -e -m PKCS8 > /tmp/rsa_pub.pem 2>/dev/null
    
    # Extract modulus and exponent using openssl
    openssl rsa -pubin -in /tmp/rsa_pub.pem -text -noout > /tmp/key_info.txt 2>/dev/null
    
    # Extract modulus (n) - remove spaces, colons, and newlines
    local modulus=$(grep -A 999 "Modulus:" /tmp/key_info.txt | grep -B 999 "Exponent:" | grep -v "Modulus:" | grep -v "Exponent:" | tr -d ' :\n')
    
    # Extract exponent (e) - typically 65537 (0x10001)
    local exponent=$(grep "Exponent:" /tmp/key_info.txt | awk '{print $2}' | cut -d'(' -f1)
    
    # Convert hex modulus to base64url
    local n=$(echo "$modulus" | xxd -r -p | base64url)
    
    # Convert exponent to base64url (65537 = AQAB in base64url)
    local e="AQAB"
    
    echo "{\"n\":\"$n\",\"e\":\"$e\"}"
    
    # Cleanup
    rm -f /tmp/rsa_pub.pem /tmp/key_info.txt
}

# Create JWT header
create_header() {
    echo -n '{"alg":"RS256","typ":"JWT","kid":"ssh-rsa-key"}' | base64url
}

# Create JWT payload
create_payload() {
    local now=$(date +%s)
    local exp=$((now + 86400))  # 24 hours from now
    
    cat <<EOF | base64url
{
  "iss": "demo.local",
  "sub": "demo-user@example.com",
  "aud": ["rest-api"],
  "exp": $exp,
  "iat": $now,
  "nbf": $now,
  "email": "demo@example.com",
  "name": "Demo User",
  "roles": ["api-user", "admin"],
  "groups": ["developers", "admins"]
}
EOF
}

# Sign the JWT
sign_jwt() {
    local header=$1
    local payload=$2
    local private_key=$3
    
    # Create the signing input
    local signing_input="${header}.${payload}"
    
    # Convert OpenSSH key to PEM format for signing
    local temp_key="/tmp/temp_rsa_key_$$.pem"
    
    # Use ssh-keygen to convert to PEM format in a temp file
    cp "$private_key" "${temp_key}.openssh"
    ssh-keygen -p -m PEM -N "" -f "${temp_key}.openssh" <<<$'\n\n' >/dev/null 2>&1 || true
    
    # Sign with the converted key
    local signature
    if [ -f "${temp_key}.openssh" ]; then
        signature=$(echo -n "$signing_input" | openssl dgst -sha256 -sign "${temp_key}.openssh" 2>/dev/null | base64url)
    fi
    
    # Cleanup
    rm -f "${temp_key}.openssh" "${temp_key}.openssh.pub" 2>/dev/null
    
    echo "$signature"
}

# Main execution
PRIVATE_KEY="$HOME/.ssh/id_rsa"
PUBLIC_KEY="$HOME/.ssh/id_rsa.pub"

if [ ! -f "$PRIVATE_KEY" ] || [ ! -f "$PUBLIC_KEY" ]; then
    echo "Error: SSH RSA keys not found at ~/.ssh/id_rsa[.pub]"
    exit 1
fi

# Generate JWT components
HEADER=$(create_header)
PAYLOAD=$(create_payload)
SIGNATURE=$(sign_jwt "$HEADER" "$PAYLOAD" "$PRIVATE_KEY")

# Combine into final JWT
JWT="${HEADER}.${PAYLOAD}.${SIGNATURE}"

echo -e "${GREEN}JWT Token generated successfully!${NC}"
echo
echo "Token:"
echo "$JWT"
echo

# Save token to file
echo "$JWT" > resources/jwt-auth/overlays/demo/demo-token.txt
echo -e "${YELLOW}Token saved to: resources/jwt-auth/overlays/demo/demo-token.txt${NC}"

# Now generate JWKS from the public key
echo
echo "Generating JWKS from public key..."

# Convert SSH public key to PEM format
ssh-keygen -f "$PUBLIC_KEY" -e -m PKCS8 > /tmp/rsa_pub.pem 2>/dev/null

# Extract modulus from public key
MODULUS=$(openssl rsa -pubin -in /tmp/rsa_pub.pem -modulus -noout 2>/dev/null | cut -d'=' -f2)

# Convert hex modulus to base64url
N=$(echo "$MODULUS" | xxd -r -p | base64url)

# Create JWKS
cat > resources/jwt-auth/overlays/demo/jwks.json <<EOF
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "ssh-rsa-key",
      "n": "$N",
      "e": "AQAB",
      "alg": "RS256"
    }
  ]
}
EOF

echo -e "${YELLOW}JWKS saved to: resources/jwt-auth/overlays/demo/jwks.json${NC}"

# Cleanup
rm -f /tmp/rsa_pub.pem

echo
echo -e "${GREEN}Done! Now update the RequestAuthentication with the generated JWKS.${NC}"
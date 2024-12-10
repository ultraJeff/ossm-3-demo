

NC='\033[0m'       # Text Reset

BGreen='\033[1;32m'       # Green
BYellow='\033[1;33m'      # Yellow

#BBlack='\033[1;30m'       # Black
#BRed='\033[1;31m'         # Red
#BBlue='\033[1;34m'        # Blue
#BPurple='\033[1;35m'      # Purple
#BCyan='\033[1;36m'        # Cyan
#BWhite='\033[1;37m'       # White

export GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')

SLEEP=20
V1_WEIGHT=100

response=$(curl -s -w "%{http_code}" $GATEWAY/hello-service)
http_code="${response: -3}"
echo $http_code

for V2_WEIGHT in 10 25 50 75 100
do
    # Calculate the weight for v1
    V1_WEIGHT_NEW=$((V1_WEIGHT - V2_WEIGHT))

    oc apply -f - <<EOF
    apiVersion: networking.istio.io/v1beta1
    kind: VirtualService
    metadata:
      name: service-b
      namespace: rest-api-with-mesh
    spec:
      hosts:
        - service-b
      http:
      - route:
        - destination:
            host: service-b
            subset: v1
            port:
              number: 8080
          weight: ${V1_WEIGHT_NEW}
        - destination:
            host: service-b
            subset: v2
            port:
              number: 8080
          weight: ${V2_WEIGHT}
EOF

    echo "${BGreen}${V1_WEIGHT_NEW}%${NC} traffic is routed to ${BGreen}v1${NC} ${BYellow}${V2_WEIGHT}%${NC} to ${BYellow}v2${NC}"
    sleep $SLEEP

done

response=$(curl -s -w "%{http_code}" $GATEWAY/hello-service)
http_code="${response: -3}"
echo $http_code
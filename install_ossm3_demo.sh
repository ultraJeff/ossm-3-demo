#!/bin/bash

NC=''          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow
#BBlack='\033[1;30m'  # Black
#BRed='\033[1;31m'    # Red
BBlue=''    # Blue
#BPurple='\033[1;35m' # Purple
#BCyan='\033[1;36m'   # Cyan
#BWhite='\033[1;37m'  # White

echo "This script set up the whole OSSM3 demo."

echo "Installing Minio for Tempo"
oc new-project tracing-system
oc apply -f ./resources/TempoOtel/minio.yaml -n tracing-system
echo "Waiting for Minio to become available..."
oc wait --for condition=Available deployment/minio --timeout 150s -n tracing-system

echo "Installing TempoCR"
oc apply -f ./resources/TempoOtel/tempo.yaml -n tracing-system
echo "Waiting for TempoStack to become ready..."
oc wait --for condition=Ready TempoStack/sample --timeout 150s -n tracing-system
echo "Waiting for Tempo deployment to become available..."
oc wait --for condition=Available deployment/tempo-sample-compactor --timeout 150s -n tracing-system

echo "Exposing Jaeger UI route (will be used in kiali ui)"
oc expose svc tempo-sample-query-frontend --port=jaeger-ui --name=tracing-ui -n tracing-system

echo "Installing OpenTelemetryCollector..."
oc new-project opentelemetrycollector
oc apply -f ./resources/TempoOtel/opentelemetrycollector.yaml -n opentelemetrycollector
echo "Waiting for OpenTelemetryCollector deployment to become available..."
oc wait --for condition=Available deployment/otel-collector --timeout 60s -n opentelemetrycollector

echo "Installing OSSM3 (Traditional Mode)..."
oc new-project istio-system
oc new-project istio-cni
oc new-project istio-ingress
echo "Installing OSSM3 Control Plane and CNI..."
oc apply -k ./resources/ossm3/overlays/traditional
echo "Waiting for istio to become ready..."
oc wait --for condition=Ready istio/default --timeout 60s  -n istio-system
echo "Waiting for istiocni to become ready..."
oc wait --for condition=Ready istiocni/default --timeout 60s -n istio-cni

echo "Installing Telemetry resource..."
oc apply -f ./resources/TempoOtel/istioTelemetry.yaml  -n istio-system
echo "Adding OTEL namespace as a part of the mesh"
oc label namespace opentelemetrycollector istio-injection=enabled

echo "Creating ingress gateways..."
echo "Adding istio-ingress namespace as a part of the mesh"
oc label namespace istio-ingress istio-injection=enabled
echo "Creating Gateway API ingress..."
oc apply -k ./resources/gateway
echo "Waiting for Istio ingress gateway deployment to become available..."
oc wait --for condition=Available deployment/istio-ingressgateway --timeout 60s -n istio-ingress
echo "Exposing Istio ingress route"
oc expose svc istio-ingressgateway --port=http2 --name=istio-ingressgateway -n istio-ingress

echo "Enabling user workload monitoring in OCP"
oc apply -f ./resources/Monitoring/ocpUserMonitoring.yaml
echo "Enabling service monitor in istio-system namespace"
oc apply -f ./resources/Monitoring/serviceMonitor.yaml -n istio-system
echo "Enabling pod monitor in istio-system namespace"
oc apply -f ./resources/Monitoring/podMonitor.yaml -n istio-system
echo "Enabling pod monitor in istio-ingress namespace"
oc apply -f ./resources/Monitoring/podMonitor.yaml -n istio-ingress

echo "Installing Kiali..."
oc project istio-system
echo "Creating cluster role binding for kiali to read ocp monitoring"
oc apply -f ./resources/Kiali/kialiCrb.yaml -n istio-system
echo "Installing KialiCR..."
export TRACING_INGRESS_ROUTE="http://$(oc get -n tracing-system route tracing-ui -o jsonpath='{.spec.host}')"
cat ./resources/Kiali/kialiCr.yaml | JAEGERROUTE="${TRACING_INGRESS_ROUTE}" envsubst | oc -n istio-system apply -f - 
echo "Waiting for kiali to become ready..."
oc wait --for condition=Successful kiali/kiali --timeout 150s -n istio-system 
oc annotate route kiali haproxy.router.openshift.io/timeout=60s -n istio-system 

echo "Install Kiali OSSM Console plugin..."
oc apply -f ./resources/Kiali/kialiOssmcCr.yaml -n istio-system

echo "Installing Sample RestAPI..."
oc apply -k ./resources/application/kustomize/overlays/pod 

echo "Installing Bookinfo (SM3 Sidecar)..."
oc apply -k ./resources/bookinfo/kustomize/overlays/traditional
# oc new-project bookinfo
# echo "Adding bookinfo namespace as a part of the mesh"
# oc label namespace bookinfo istio-injection=enabled
# echo "Enabling pod monitor in bookinfo namespac"
# oc apply -f ./resources/Monitoring/podMonitor.yaml -n bookinfo
# echo "Installing Bookinfo"
# oc apply -f ./resources/Bookinfo/bookinfo.yaml -n bookinfo
# oc apply -f ./resources/Bookinfo/bookinfo-gateway.yaml -n bookinfo
echo "Waiting for bookinfo pods to become ready..."
oc wait --for=condition=Ready pods --all -n bookinfo --timeout 60s

echo "Installation finished!"
echo "NOTE: Kiali will show metrics of bookinfo app right after pod monitor will be ready. You can check it in OCP console Observe->Metrics"

# this env will be used in traffic generator
# TODO: This is wrong for SM3
export INGRESSHOST=$(oc get route istio-ingressgateway -n istio-ingress -o=jsonpath='{.spec.host}')
KIALI_HOST=$(oc get route kiali -n istio-system -o=jsonpath='{.spec.host}')

echo "[optional] Installing Bookinfo traffic generator..."
cat ./resources/bookinfo/base/traffic-generator-configmap.yaml | ROUTE="http://${INGRESSHOST}/productpage" envsubst | oc -n bookinfo apply -f - 
oc apply -f ./resources/Bookinfo/traffic-generator.yaml -n bookinfo

echo "===================================================================================================="
echo "Ingress route for bookinfo is: http://${INGRESSHOST}/productpage"
echo "To test RestAPI: sh ./scripts/test-api.sh"
echo "Kiali route is: https://${KIALI_HOST}"
echo "===================================================================================================="

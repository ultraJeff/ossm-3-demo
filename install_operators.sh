#!/bin/bash

NC='\033[0m'          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow
#BBlack='\033[1;30m'  # Black
#BRed='\033[1;31m'    # Red
BBlue='\033[1;34m'    # Blue
#BPurple='\033[1;35m' # Purple
#BCyan='\033[1;36m'   # Cyan
#BWhite='\033[1;37m'  # White

echo "${BGreen}This script installs operators from OperatorHub${NC}"
echo "${BGreen}This script will also enable the Kubernetes Gateway API${NC}" #This may be an unessessary step in future OCP

oc apply -f ./resources/subscriptions.yaml
echo "${BYellow}Waiting till all operators pods are ready${NC}"
until oc get pods -n openshift-operators | grep servicemesh-operator3 | grep Running; do echo "Waiting for servicemesh-operator3 to be running."; sleep 10;done
until oc get pods -n openshift-operators | grep kiali-operator | grep Running; do echo "Waiting for kiali-operator to be running."; sleep 10;done
until oc get pods -n openshift-operators | grep opentelemetry-operator | grep Running; do echo "Waiting for opentelemetry-operator to be running."; sleep 10;done
until oc get pods -n openshift-operators | grep tempo-operator | grep Running; do echo "Waiting for tempo-operator to be running."; sleep 10;done

echo "${BGreen}All operators were installed successfully${NC}"
oc get pods -n openshift-operators

echo "${BYellow}Enabling Gateway API${NC}"
oc get crd gateways.gateway.networking.k8s.io &> /dev/null ||  { oc kustomize "github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.0.0" | oc apply -f -; }

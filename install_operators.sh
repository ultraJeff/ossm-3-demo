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

echo "This script installs operators from OperatorHub"
echo "This script will also enable the Kubernetes Gateway API" #This may be an unessessary step in future OCP

oc apply -f ./resources/subscriptions.yaml
echo "Waiting till all operators pods are ready"
until oc get pods -n openshift-operators | grep servicemesh-operator3 | grep Running; do echo "Waiting for servicemesh-operator3 to be running."; sleep 10;done
until oc get pods -n openshift-operators | grep kiali-operator | grep Running; do echo "Waiting for kiali-operator to be running."; sleep 10;done
until oc get pods -n openshift-opentelemetry-operator | grep opentelemetry-operator | grep Running; do echo "Waiting for opentelemetry-operator to be running."; sleep 10;done
until oc get pods -n openshift-tempo-operator | grep tempo-operator | grep Running; do echo "Waiting for tempo-operator to be running."; sleep 10;done

echo "All operators were installed successfully"
oc get pods -n openshift-operators

# This is for legacy OCP versions that do not have Gateway API enabled by default - safe to keep for now
echo "Enabling Gateway API"
oc get crd gateways.gateway.networking.k8s.io &> /dev/null ||  { oc kustomize "github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.0.0" | oc apply -f -; }

#!/bin/bash

export GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o template --template='{{(index .status.addresses 0).value}}')

export SLEEP=1

while true
do 
  date
  curl -s $GATEWAY/hello-service | jq
  sleep $SLEEP
done

#curl $GATEWAY/vm/hello-service #for vm-to-vm namespace
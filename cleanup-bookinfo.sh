#!/bin/bash

NC='\033[0m'          # Text Reset
BGreen='\033[1;32m'   # Green
BYellow='\033[1;33m'  # Yellow

echo -e "${BGreen}Cleaning up Bookinfo deployment${NC}"

echo -e "${BYellow}Deleting ossm-bookinfo namespace...${NC}"
oc delete namespace ossm-bookinfo

echo -e "${BYellow}Waiting for namespace deletion...${NC}"
while oc get namespace ossm-bookinfo &>/dev/null; do
    echo "Waiting for ossm-bookinfo namespace to be deleted..."
    sleep 5
done

echo -e "${BGreen}Bookinfo cleanup complete!${NC}"
echo "You can now redeploy the bookinfo application."

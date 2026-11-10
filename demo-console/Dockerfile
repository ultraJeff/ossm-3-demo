FROM registry.redhat.io/openshift4/ose-cli:latest AS oc-source

FROM node:22-slim

# Copy oc binary from the Red Hat image
COPY --from=oc-source /usr/bin/oc /usr/local/bin/oc
COPY --from=oc-source /usr/bin/kubectl /usr/local/bin/kubectl

# curl and jq for shell commands; tini as PID 1 so any orphaned child process gets reaped
RUN apt-get update && apt-get install -y --no-install-recommends curl jq tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY lib/ ./lib/
COPY public/ ./public/

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]

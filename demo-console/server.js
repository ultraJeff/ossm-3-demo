const express = require('express');
const path = require('path');
const { run } = require('./lib/run');
const { createCache } = require('./lib/cache');

const app = express();
const PORT = process.env.PORT || 3000;
let DOMAIN = 'apps.example.com';
const MODULES = {};
let KIALI_URL = '';
let CONSOLE_URL = '';
let BOOKINFO_URL = '';
let MODELS_NS = 'ossm-ai-models';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Liveness/readiness. Deliberately touches nothing outside the process --
// /api/health shells out to oc several times and is not a health check.
app.get('/healthz', (req, res) => res.send('ok'));

// Endpoints the browser polls are served through a shared cache (see lib/cache.js),
// so their cost no longer scales with the number of open tabs.
const pollCache = createCache();

function cachedGet(route, ttlMs, handler) {
  app.get(route, async (req, res) => {
    try {
      const body = await pollCache.get(route, ttlMs, () => new Promise((resolve, reject) => {
        Promise.resolve(handler(req, { json: resolve })).catch(reject);
      }));
      res.json(body);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// Any demo action may change what the status panels show; drop cached status
// when one starts and again when it finishes, so the next poll is current.
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  pollCache.clear();
  res.on('finish', () => pollCache.clear());
  next();
});

async function runCleanYaml(cmd) {
  var result = await run(cmd);
  if (result.exitCode !== 0 || !result.output.trim()) return result;
  var lines = result.output.split('\n');
  var filtered = [];
  var skip = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Skip status section entirely
    if (/^status:/.test(line)) break;
    // Skip annotations block
    if (/^  annotations:/.test(line)) { skip = true; continue; }
    if (skip && /^    /.test(line)) continue;
    if (skip && !/^    /.test(line)) skip = false;
    // Skip noisy metadata fields
    if (/creationTimestamp|generation:|resourceVersion|uid:|managedFields|fieldsType|fieldsV1|^ *f:|^ *manager:|^ *operation:|^ *time: /.test(line)) continue;
    filtered.push(line);
  }
  result.output = filtered.filter(function(l) { return l.trim() !== ''; }).join('\n');
  return result;
}

// --- Auto-detection ---

const NAMESPACES = [
  'tracing-system',
  'opentelemetrycollector',
  'istio-system',
  'istio-cni',
  'istio-ingress',
  'ossm-bookinfo',
  'ossm-restapi',
  'ztunnel',
  'ossm-httpbin',
  'ossm-ai-models',
  'super-slim-demo',
  'ossm-mesh-demo',
  'ossm-enrollment-test',
];

async function detectModules() {
  // Resolve which AI models namespace exists on this cluster
  const modelsNsCheck = await run('oc get namespace ossm-ai-models --no-headers 2>/dev/null');
  MODELS_NS = modelsNsCheck.exitCode === 0 ? MODELS_NS : 'super-slim-demo';

  const checks = {
    bookinfo: 'oc get namespace ossm-bookinfo --no-headers 2>/dev/null',
    restapi: 'oc get namespace ossm-restapi --no-headers 2>/dev/null',
    models: `oc get namespace ${MODELS_NS} --no-headers 2>/dev/null`,
    kiali: 'oc get kiali -n istio-system --no-headers 2>/dev/null',
    httpbin: 'oc get deployment httpbin -n ossm-httpbin --no-headers 2>/dev/null',
    enrollment: 'oc get deployment mesh-logger -n ossm-mesh-demo --no-headers 2>/dev/null',
  };
  for (const [key, cmd] of Object.entries(checks)) {
    const result = await run(cmd);
    MODULES[key] = result.exitCode === 0;
  }

  // Discover dashboard URLs
  const kialiRoute = await run("oc get route kiali -n istio-system -o jsonpath='{.spec.host}' 2>/dev/null");
  const host = kialiRoute.output.trim().replace(/'/g, '');
  KIALI_URL = host ? `https://${host}` : `https://kiali-istio-system.${DOMAIN}`;

  const consoleRoute = await run("oc get route console -n openshift-console -o jsonpath='{.spec.host}' 2>/dev/null");
  const cHost = consoleRoute.output.trim().replace(/'/g, '');
  CONSOLE_URL = cHost ? `https://${cHost}` : `https://console-openshift-console.${DOMAIN}`;

  // Discover bookinfo URL
  const bookinfoGw = await run("oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null");
  const bookinfoAddr = bookinfoGw.output.trim().replace(/'/g, '');
  BOOKINFO_URL = bookinfoAddr ? `http://${bookinfoAddr}/productpage` : '';

  console.log('Detected modules:', MODULES);
}

// Helper: get gateway address with graceful fallback
async function getGatewayAddress(gatewayName, ns) {
  const result = await run(`oc get gateway ${gatewayName} -n ${ns} -o jsonpath='{.status.addresses[0].value}' 2>/dev/null`);
  const addr = result.output.trim().replace(/'/g, '');
  return addr || null;
}

// --- Config ---

app.get('/api/config', (req, res) => {
  res.json({ domain: DOMAIN, modules: MODULES, kialiUrl: KIALI_URL, consoleUrl: CONSOLE_URL, bookinfoUrl: BOOKINFO_URL });
});

app.post('/api/config/redetect', async (req, res) => {
  await detectModules();
  res.json({ domain: DOMAIN, modules: MODULES, kialiUrl: KIALI_URL, consoleUrl: CONSOLE_URL, bookinfoUrl: BOOKINFO_URL });
});

app.get('/api/domain', (req, res) => {
  res.json({ domain: DOMAIN });
});

// --- Topology (Kiali graph API proxy) ---

cachedGet('/api/topology', 10000, async (req, res) => {
  const token = await run("oc whoami -t 2>/dev/null");
  const t = token.output.trim().replace(/'/g, '');
  if (!t) {
    res.json({ error: 'Not logged in to OpenShift' });
    return;
  }

  // Start with infra namespaces, then add all mesh-enrolled ossm-* namespaces
  const nsList = ['istio-ingress'];
  const enrolledNs = await run("oc get namespaces -l istio.io/dataplane-mode=ambient -o jsonpath='{.items[*].metadata.name}' 2>/dev/null");
  enrolledNs.output.replace(/'/g, '').trim().split(/\s+/).forEach(function(ns) {
    if (ns && nsList.indexOf(ns) === -1) nsList.push(ns);
  });
  const namespaces = nsList.join(',');

  if (!namespaces) {
    res.json({ elements: { nodes: [], edges: [] } });
    return;
  }

  const kialiHost = KIALI_URL.replace('https://', '');
  const graphUrl = `https://${kialiHost}/api/namespaces/graph?namespaces=${namespaces}&graphType=workload&duration=300s&injectServiceNodes=true&includeIdleEdges=true`;
  const result = await run(`curl -sk "${graphUrl}" -H "Authorization: Bearer ${t}" 2>/dev/null`);

  try {
    const data = JSON.parse(result.output);
    res.json(data);
  } catch (e) {
    res.json({ error: 'Failed to fetch topology', elements: { nodes: [], edges: [] } });
  }
});

// --- Core Mesh (always available) ---

app.get('/api/mesh/spiffe', async (req, res) => {
  const meshNamespaces = NAMESPACES.filter(ns => !['tracing-system', 'opentelemetrycollector', 'istio-cni', 'istio-ingress'].includes(ns));
  let output = 'istiod assigns a SPIFFE identity to every pod in the mesh.\n';
  output += 'ztunnel uses these identities for mTLS authentication on every connection.\n\n';
  output += 'Format: spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>\n\n';

  for (const ns of meshNamespaces) {
    const nsCheck = await run(`oc get namespace ${ns} --no-headers 2>/dev/null`);
    if (nsCheck.exitCode !== 0) continue;
    const pods = await run(`oc get pods -n ${ns} -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.name}{"\\t"}{.spec.serviceAccountName}{"\\n"}{end}' 2>/dev/null`);
    const lines = pods.output.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) continue;
    output += `--- ${ns} ---\n`;
    lines.forEach(line => {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        output += `  ${parts[0]}\n    spiffe://cluster.local/ns/${ns}/sa/${parts[1]}\n`;
      }
    });
    output += '\n';
  }
  res.json({ output, exitCode: 0 });
});

cachedGet('/api/health', 10000, async (req, res) => {
  const nodes = await run('oc get nodes --no-headers 2>/dev/null');
  const mesh = await run('oc get istio,istiocni,ztunnel -A --no-headers 2>/dev/null');
  const peerAuth = await run('oc get peerauthentication -A --no-headers 2>/dev/null');

  const INFRA_NS = ['istio-system', 'istio-cni', 'istio-ingress', 'ztunnel', 'tracing-system'];
  const APP_NS = NAMESPACES.filter(ns => !INFRA_NS.includes(ns) && !['opentelemetrycollector'].includes(ns));

  // Condensed infra status
  let infraPods = 0, infraRunning = 0;
  for (const ns of INFRA_NS) {
    const nsCheck = await run(`oc get namespace ${ns} --no-headers 2>/dev/null`);
    if (nsCheck.exitCode !== 0) continue;
    const pods = await run(`oc get pods -n ${ns} --no-headers 2>/dev/null | grep -v Completed | grep -v Terminating`);
    const lines = pods.output.trim().split('\n').filter(l => l.trim());
    infraPods += lines.length;
    infraRunning += lines.filter(l => l.includes('Running')).length;
  }

  // Per-app namespace status
  const appResults = {};
  for (const ns of APP_NS) {
    const nsCheck = await run(`oc get namespace ${ns} --no-headers 2>/dev/null`);
    if (nsCheck.exitCode === 0) {
      const pods = await run(`oc get pods -n ${ns} --no-headers 2>/dev/null | grep -v Completed | grep -v Terminating`);
      appResults[ns] = pods.output;
    }
  }

  res.json({
    nodes: nodes.output,
    mesh: mesh.output,
    peerAuth: peerAuth.output,
    infra: { running: infraRunning, total: infraPods },
    apps: appResults,
  });
});

app.get('/api/istio-crs', async (req, res) => {
  const result = await run('oc get istio,istiocni,ztunnel -A 2>/dev/null');
  res.json(result);
});

app.get('/api/ztunnel-pods', async (req, res) => {
  const result = await run(`echo 'ztunnel -- runs on every node, encrypts all pod traffic:'; echo ''; oc get pods -n ztunnel -o wide 2>/dev/null`);
  res.json(result);
});

app.get('/api/namespace-labels', async (req, res) => {
  const detectedNs = [];
  for (const ns of NAMESPACES) {
    const nsCheck = await run(`oc get namespace ${ns} --no-headers 2>/dev/null`);
    if (nsCheck.exitCode === 0) detectedNs.push(ns);
  }

  let output = 'Namespace mesh enrollment labels:\n\n';
  for (const ns of detectedNs) {
    const labels = await run(`oc get namespace ${ns} -o jsonpath='{.metadata.labels}' 2>/dev/null`);
    try {
      const parsed = JSON.parse(labels.output.replace(/'/g, ''));
      const meshLabels = Object.entries(parsed).sort().filter(function(e) { return e[0].includes('istio') || e[0].includes('dataplane'); });
      if (meshLabels.length === 0) continue;
      output += `--- ${ns} ---\n`;
      meshLabels.forEach(function(e) { output += `  ${e[0]}: ${e[1]}\n`; });
    } catch (e) {
      continue;
    }
    output += '\n';
  }
  res.json({ output, exitCode: 0 });
});

app.get('/api/peer-auth', async (req, res) => {
  const result = await run('oc get peerauthentication -A 2>/dev/null');
  res.json(result);
});

app.get('/api/mesh-resources', async (req, res) => {
  const result = await run(`echo 'Mesh custom resources on this cluster:'
echo ''
echo '=== Control Plane ==='
oc get istio -A -o custom-columns='NAME:.metadata.name,NS:.spec.namespace,STATUS:.status.state,VERSION:.spec.version' --no-headers 2>/dev/null | awk '{printf "  Istio/%s  namespace=%s  status=%s  version=%s\\n", $1, $2, $3, $4}'
oc get istiocni -A -o custom-columns='NAME:.metadata.name,STATUS:.status.state' --no-headers 2>/dev/null | awk '{printf "  IstioCNI/%s  status=%s\\n", $1, $2}'
oc get ztunnel -A -o custom-columns='NAME:.metadata.name,STATUS:.status.state' --no-headers 2>/dev/null | awk '{printf "  ZTunnel/%s  status=%s\\n", $1, $2}'
echo ''
echo '=== Gateway API ==='
oc get gateway -A --no-headers 2>/dev/null | awk '{printf "  Gateway/%s  namespace=%s  class=%s\\n", $2, $1, $3}'
oc get httproute -A --no-headers 2>/dev/null | awk '{printf "  HTTPRoute/%s  namespace=%s\\n", $2, $1}'
oc get gatewayclass --no-headers 2>/dev/null | awk '{printf "  GatewayClass/%s  controller=%s\\n", $1, $2}'
echo ''
echo '=== Security ==='
oc get peerauthentication -A --no-headers 2>/dev/null | awk '{printf "  PeerAuthentication/%s  namespace=%s  mode=%s\\n", $2, $1, $3}'
oc get authorizationpolicy -A --no-headers 2>/dev/null | awk '{printf "  AuthorizationPolicy/%s  namespace=%s\\n", $2, $1}' 2>/dev/null
if [ $(oc get authorizationpolicy -A --no-headers 2>/dev/null | wc -l) -eq 0 ]; then echo '  (none active)'; fi
echo ''
echo '=== Networking ==='
oc get virtualservice -A --no-headers 2>/dev/null | awk '{printf "  VirtualService/%s  namespace=%s\\n", $2, $1}'
oc get destinationrule -A --no-headers 2>/dev/null | awk '{printf "  DestinationRule/%s  namespace=%s\\n", $2, $1}'
if [ $(oc get virtualservice -A --no-headers 2>/dev/null | wc -l) -eq 0 ] && [ $(oc get destinationrule -A --no-headers 2>/dev/null | wc -l) -eq 0 ]; then echo '  (none active)'; fi
echo ''
echo '=== Observability ==='
oc get kiali -A --no-headers 2>/dev/null | awk '{printf "  Kiali/%s  namespace=%s\\n", $2, $1}'
oc get ossmconsole -A --no-headers 2>/dev/null | awk '{printf "  OSSMConsole/%s  namespace=%s\\n", $2, $1}'`);
  res.json(result);
});

// --- Bookinfo (if bookinfo namespace exists) ---

app.get('/api/bookinfo/status', async (req, res) => {
  const pods = await run('oc get pods -n ossm-bookinfo 2>/dev/null');
  const gw = await run('oc get gateway,httproute -n istio-ingress -l app=bookinfo-gateway 2>/dev/null; oc get httproute -n ossm-bookinfo 2>/dev/null');
  res.json({ output: pods.output + '\n' + gw.output, exitCode: 0 });
});

app.post('/api/bookinfo/traffic', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'Bookinfo gateway has no address yet. It may still be provisioning.'
  echo ''
  echo 'Gateway status:'
  oc get gateway bookinfo-gateway -n istio-ingress 2>/dev/null
  exit 1
fi
echo "Sending 10 requests to http://$GATEWAY/productpage ..."
echo ''
PASS=0; FAIL=0
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://$GATEWAY/productpage" 2>/dev/null)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
  sleep 0.3
done
echo ""
echo ""
echo "Results: $PASS succeeded, $FAIL failed out of 10 requests"
`);
  res.json(result);
});

app.get('/api/bookinfo/gateway', async (req, res) => {
  const gw = await runCleanYaml('oc get gateway bookinfo-gateway -n istio-ingress -o yaml 2>/dev/null');
  const routes = await run('oc get httproute -n ossm-bookinfo 2>/dev/null');
  res.json({ output: '=== Gateway ===\n' + gw.output + '\n=== HTTPRoutes ===\n' + routes.output, exitCode: 0 });
});

// --- RestAPI / Gateway API (if ossm-restapi namespace exists) ---

app.get('/api/restapi/status', async (req, res) => {
  const pods = await run('oc get pods -n ossm-restapi 2>/dev/null');
  const gw = await run('oc get gateway restapi-gateway -n istio-ingress 2>/dev/null');
  const routes = await run('oc get httproute -n ossm-restapi 2>/dev/null');
  res.json({ output: '=== Pods ===\n' + pods.output + '\n=== Gateway ===\n' + gw.output + '\n=== HTTPRoutes ===\n' + routes.output, exitCode: 0 });
});

app.post('/api/restapi/test', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway restapi-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'restapi-gateway has no address yet. It may still be provisioning.'
  echo ''
  echo 'Gateway status:'
  oc get gateway restapi-gateway -n istio-ingress 2>/dev/null
  exit 1
fi
echo "Gateway address: $GATEWAY"
echo ""
echo '$ curl $GATEWAY/hello'
curl -s "$GATEWAY/hello" 2>/dev/null | jq . 2>/dev/null || curl -s "$GATEWAY/hello" 2>/dev/null
echo ""
echo '$ curl $GATEWAY/hello-service'
curl -s "$GATEWAY/hello-service" 2>/dev/null | jq . 2>/dev/null || curl -s "$GATEWAY/hello-service" 2>/dev/null
`);
  res.json(result);
});

app.get('/api/restapi/canary', async (req, res) => {
  const hr = await runCleanYaml('oc get httproute service-b-canary -n ossm-restapi -o yaml 2>/dev/null');
  if (hr.exitCode !== 0 || !hr.output.trim()) {
    res.json({ output: 'No HTTPRoute canary configuration found.', exitCode: 1 });
    return;
  }
  res.json(hr);
});

app.post('/api/restapi/canary/apply', async (req, res) => {
  const v1 = req.body.v1 || 90;
  const v2 = req.body.v2 || 10;
  const result = await run(`oc apply -f - <<'EOF' 2>&1
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: service-b-canary
  namespace: ossm-restapi
spec:
  parentRefs:
    - kind: Service
      group: ""
      name: service-b
      port: 8080
  rules:
    - backendRefs:
        - name: service-b-v1
          port: 8080
          weight: ${v1}
        - name: service-b-v2
          port: 8080
          weight: ${v2}
EOF
echo ""
echo "Updated canary weight: v1=${v1}% / v2=${v2}%"
echo ""
echo "HTTPRoute service-b-canary backendRefs:"
oc get httproute service-b-canary -n ossm-restapi -o jsonpath='{range .spec.rules[0].backendRefs[*]}  {.name}: {.weight}%{"\\n"}{end}' 2>/dev/null`);
  res.json(result);
});

app.post('/api/restapi/test-canary', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway restapi-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'restapi-gateway has no address yet.'
  exit 1
fi
echo "Sending 20 requests to $GATEWAY/hello-service ..."
echo ""
V1=0; V2=0; FAIL=0
for i in $(seq 1 20); do
  RESP=$(curl -s --connect-timeout 5 "$GATEWAY/hello-service" 2>/dev/null)
  if echo "$RESP" | grep -q '"v1"\\|version.*1\\|service-b-v1'; then
    V1=$((V1+1)); printf "1"
  elif echo "$RESP" | grep -q '"v2"\\|version.*2\\|service-b-v2'; then
    V2=$((V2+1)); printf "2"
  elif [ -n "$RESP" ]; then
    V1=$((V1+1)); printf "?"
  else
    FAIL=$((FAIL+1)); printf "X"
  fi
  sleep 0.2
done
echo ""
echo ""
TOTAL=$((V1+V2))
if [ "$TOTAL" -gt 0 ]; then
  V1PCT=$((V1 * 100 / TOTAL))
  V2PCT=$((V2 * 100 / TOTAL))
  echo "Results: v1=$V1 ($V1PCT%)  v2=$V2 ($V2PCT%)  failed=$FAIL"
  echo ""
  BAR1=$(printf '%*s' $((V1PCT/5)) '' | tr ' ' '#')
  BAR2=$(printf '%*s' $((V2PCT/5)) '' | tr ' ' '#')
  echo "  v1 |$BAR1| $V1PCT%"
  echo "  v2 |$BAR2| $V2PCT%"
else
  echo "Results: $FAIL failed out of 20"
fi`);
  res.json(result);
});

// --- AI Models (if ossm-ai-models namespace exists) ---

app.get('/api/models/status', async (req, res) => {
  const models = await run(`echo '=== ${MODELS_NS} ==='
echo 'NAME          READY  URL'
oc get inferenceservice -n ${MODELS_NS} -o custom-columns='NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,URL:.status.url' --no-headers 2>/dev/null
echo ''
echo 'RUNTIME              MODEL_TYPE'
oc get servingruntime -n ${MODELS_NS} -o custom-columns='RUNTIME:.metadata.name,MODEL_TYPE:.spec.supportedModelFormats[0].name' --no-headers 2>/dev/null
echo ''
echo '=== llm ==='
echo 'NAME                                    READY  AGE'
oc get deploy -n llm --no-headers 2>/dev/null | grep -v waypoint | awk '{printf "%-40s %s    %s\\n", $1, $2, $5}'
`);
  res.json(models);
});

app.post('/api/models/infer-iris', async (req, res) => {
  const result = await run(`echo 'North-south call via external route + Gateway API'
echo 'Called from: this console (external to the cluster)'
echo 'Path: console -> OCP Route -> ai-models-gateway (Envoy) -> ztunnel -> waypoint -> iris-onnx'
echo ''
echo '$ curl -sk https://iris-onnx.${DOMAIN}/v2/models/iris-onnx/infer'
echo ''
RESULT=$(curl -sk https://iris-onnx.${DOMAIN}/v2/models/iris-onnx/infer -H 'Content-Type: application/json' -d '{"inputs":[{"name":"input","shape":[1,4],"datatype":"FP32","data":[5.1,3.5,1.4,0.2]}]}' 2>/dev/null)
if [ -n "$RESULT" ]; then
  echo "$RESULT" | jq .
else
  echo 'No response. Check the OCP Route and ai-models-gateway.'
fi`);
  res.json(result);
});

app.post('/api/models/infer-phi4', async (req, res) => {
  const result = await run(`echo 'East-west call via internal Service DNS (cross-namespace)'
echo 'Called from: test-client pod in ${MODELS_NS} (inside the mesh)'
echo 'Path: test-client -> ztunnel -> llm namespace -> OPT-125M'
echo ''
echo '$ oc exec test-client -- curl -sk https://facebook-opt-125m-...svc:8000/v1/chat/completions'
echo ''
RESULT=$(oc exec -n ${MODELS_NS} deploy/test-client -- curl -sk --connect-timeout 10 --max-time 30 https://facebook-opt-125m-simulated-kserve-workload-svc.llm.svc:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"facebook/opt-125m","messages":[{"role":"user","content":"What is a service mesh?"}],"max_tokens":50}' 2>/dev/null)
if [ -n "$RESULT" ]; then
  CONTENT=$(echo "$RESULT" | jq -r '.choices[0].message.content' 2>/dev/null)
  if [ -n "$CONTENT" ] && [ "$CONTENT" != "null" ]; then
    echo "Response:"
    echo "  $CONTENT"
  else
    echo "$RESULT" | jq . 2>/dev/null || echo "$RESULT"
  fi
else
  echo 'No response. Check that the model is running:'
  echo '  oc get pods -n llm'
fi`);
  res.json(result);
});

app.get('/api/models/spiffe', async (req, res) => {
  const result = await run(`echo 'SPIFFE identity format:'
echo '  spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>'
echo ''
echo 'Workload identities in ${MODELS_NS}:'
echo ''
oc get pods -n ${MODELS_NS} -o jsonpath='{range .items[?(@.status.phase=="Running")]}{.metadata.name}{"\\t"}{.spec.serviceAccountName}{"\\n"}{end}' 2>/dev/null | while read POD SA; do
  echo "  $POD"
  echo "    -> spiffe://cluster.local/ns/${MODELS_NS}/sa/$SA"
  echo ""
done
echo 'These identities are used for mTLS authentication and'
echo 'AuthorizationPolicy enforcement.'`);
  res.json(result);
});

app.get('/api/models/ztunnel-logs', async (req, res) => {
  const result = await run(`oc logs -n ztunnel -l app=ztunnel --since=300s 2>/dev/null | grep "access" | grep "${MODELS_NS}" | grep -v "prometheus" | grep -v "openshift-user-workload" | tail -8 | python3 -c "
import sys, re
for line in sys.stdin:
    fields = {}
    # Extract all key=\\\"value\\\" pairs
    for m in re.finditer(r'([\\w.]+)=\\"([^\\"]*)\\"', line):
        fields[m.group(1)] = m.group(2)
    # Extract unquoted numeric fields
    for m in re.finditer(r'\\b(bytes_sent|bytes_recv)=(\\d+)', line):
        if m.group(1) not in fields:
            fields[m.group(1)] = m.group(2)
    if not fields:
        continue
    ts_m = re.match(r'(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})', line)
    ts = ts_m.group(1).replace('T', ' ') if ts_m else '?'
    src_id = fields.get('src.identity', '')
    dst_id = fields.get('dst.identity', '')
    src_wl = fields.get('src.workload', fields.get('src.addr', '?'))
    dst_svc = fields.get('dst.service', '?').split('.')[0]
    direction = fields.get('direction', '?')
    sent = fields.get('bytes_sent', '?')
    recv = fields.get('bytes_recv', '?')
    dur = fields.get('duration', '?')
    err = fields.get('error', '')
    status = 'DENIED' if err else 'OK'
    src_label = src_id.split('/')[-1] if src_id else src_wl
    dst_label = dst_id.split('/')[-1] if dst_id else dst_svc
    print(f'{ts}  [{status}]  {src_label} -> {dst_label}')
    if src_id:
        print(f'  src: {src_id}')
    if dst_id:
        print(f'  dst: {dst_id}')
    print(f'  {sent}B sent / {recv}B recv  {dur}  ({direction})')
    if err:
        print(f'  reason: {err}')
    print()
" 2>/dev/null`);
  const output = result.output.trim() || 'No recent mesh traffic for models namespace. Run inference first, then check again.';
  res.json({ output, exitCode: result.exitCode });
});

// --- Security (always available) ---

app.get('/api/peer-auth/show', async (req, res) => {
  const result = await run(`echo '=== PeerAuthentication policies ==='
echo ''
oc get peerauthentication -A --no-headers 2>/dev/null
echo ''
echo '=== What this means ==='
echo ''
echo 'PeerAuthentication controls whether pods accept non-mTLS traffic:'
echo ''
echo '  STRICT     - Only mTLS connections accepted. Pods without a'
echo '               SPIFFE identity (outside the mesh) are rejected.'
echo '               This is what makes the "Bypass" test fail.'
echo ''
echo '  PERMISSIVE - Accept both mTLS and plaintext. Useful during migration'
echo '               when some traffic sources are not mesh-enrolled yet.'
echo '               The "Bypass" test would succeed in this mode.'
echo ''
echo '  Scope: can be set per-namespace, per-workload, or per-port.'`);
  res.json(result);
});

app.post('/api/peer-auth/strict', async (req, res) => {
  const targetNs = MODULES.models ? MODELS_NS : 'ossm-bookinfo';
  const result = await run(`oc apply -f - <<'EOF' 2>&1
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: ${targetNs}
spec:
  mtls:
    mode: STRICT
EOF
echo ""
echo "PeerAuthentication set to STRICT in ${targetNs}"
echo "All inbound connections must present a valid mTLS certificate."
echo "Pods outside the mesh will be rejected."`);
  res.json(result);
});

app.post('/api/peer-auth/permissive', async (req, res) => {
  const targetNs = MODULES.models ? MODELS_NS : 'ossm-bookinfo';
  const result = await run(`oc apply -f - <<'EOF' 2>&1
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: ${targetNs}
spec:
  mtls:
    mode: PERMISSIVE
EOF
echo ""
echo "PeerAuthentication set to PERMISSIVE in ${targetNs}"
echo "Both mTLS and plaintext connections are accepted."
echo "Pods outside the mesh CAN reach these services."`);
  res.json(result);
});

app.post('/api/authz-policy/apply-pod', async (req, res) => {
  const targetNs = MODULES.models ? MODELS_NS : 'ossm-bookinfo';
  const targetGateway = MODULES.models ? 'ai-models-waypoint' : 'bookinfo-waypoint';
  const principals = MODULES.models
    ? [`cluster.local/ns/istio-system/sa/ai-models-gateway-istio`, `cluster.local/ns/${MODELS_NS}/sa/ai-models-waypoint`]
    : ['cluster.local/ns/istio-ingress/sa/istio-ingressgateway'];
  const principalsYaml = principals.map(p => `              - "${p}"`).join('\n');

  const result = await run(`oc apply -f - <<'ENDOFPOLICY' 2>&1
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: demo-restrict-access
  namespace: ${targetNs}
spec:
  targetRefs:
    - kind: Gateway
      group: gateway.networking.k8s.io
      name: ${targetGateway}
  action: ALLOW
  rules:
    - from:
        - source:
            principals:
${principalsYaml}
ENDOFPOLICY
echo ""
echo "AuthorizationPolicy applied to ${targetNs}"
echo "Only the gateway identity can reach services through the waypoint."
echo "test-client (different identity) will get 403."`);
  res.json(result);
});

app.get('/api/authz-policy/show-pod', async (req, res) => {
  const targetNs = MODULES.models ? MODELS_NS : 'ossm-bookinfo';
  var result = await runCleanYaml(`oc get authorizationpolicy demo-restrict-access -n ${targetNs} -o yaml 2>/dev/null`);
  if (!result.output.trim()) result = { output: 'No pod-to-pod AuthorizationPolicy applied', exitCode: 1 };
  res.json(result);
});

app.post('/api/authz-policy/delete-pod', async (req, res) => {
  const targetNs = MODULES.models ? MODELS_NS : 'ossm-bookinfo';
  const result = await run(`oc delete authorizationpolicy demo-restrict-access -n ${targetNs} 2>&1`);
  res.json(result);
});

app.post('/api/authz-policy/apply-cross-ns', async (req, res) => {
  const result = await run(`oc apply -f - <<'ENDOFPOLICY' 2>&1
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: demo-restrict-cross-ns
  namespace: ossm-restapi
spec:
  targetRefs:
    - kind: Gateway
      group: gateway.networking.k8s.io
      name: restapi-waypoint
  action: ALLOW
  rules:
    - from:
        - source:
            namespaces:
              - ossm-restapi
              - istio-ingress
ENDOFPOLICY
echo ""
echo "AuthorizationPolicy applied to ossm-restapi"
echo "Only pods in ossm-restapi and istio-ingress namespaces can access services."
echo "Pods in ossm-httpbin (different namespace) will get 403."`);
  res.json(result);
});

app.get('/api/authz-policy/show-cross-ns', async (req, res) => {
  var result = await runCleanYaml('oc get authorizationpolicy demo-restrict-cross-ns -n ossm-restapi -o yaml 2>/dev/null');
  if (!result.output.trim()) result = { output: 'No cross-namespace AuthorizationPolicy applied', exitCode: 1 };
  res.json(result);
});

app.post('/api/authz-policy/delete-cross-ns', async (req, res) => {
  const result = await run('oc delete authorizationpolicy demo-restrict-cross-ns -n ossm-restapi 2>&1');
  res.json(result);
});

cachedGet('/api/authz-policy/status', 5000, async (req, res) => {
  const result = await run('oc get authorizationpolicy -A --no-headers 2>/dev/null');
  const active = result.output.trim().length > 0 && result.exitCode === 0;
  res.json({ active, output: result.output || 'No AuthorizationPolicy applied' });
});

app.post('/api/test-allowed-identity', async (req, res) => {
  const result = await run(`echo 'Test: Can the gateway identity reach the model service?'
echo ''
echo '  Identity: spiffe://cluster.local/ns/istio-system/sa/ai-models-gateway-istio'
echo '  Path: external request -> ai-models-gateway -> waypoint -> model'
echo ''
CODE=$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 5 https://iris-onnx.${DOMAIN}/v2/models/iris-onnx 2>/dev/null)
if [ "$CODE" = "200" ]; then
  echo "Result: HTTP $CODE -- ACCESS GRANTED"
  echo ""
  echo "The gateway identity is in the allowed principals list."
elif [ "$CODE" = "403" ]; then
  echo "Result: HTTP $CODE -- FORBIDDEN"
  echo ""
  echo "The gateway identity was not allowed. Check the AuthorizationPolicy."
else
  echo "Result: HTTP $CODE"
fi`);
  res.json(result);
});

app.post('/api/test-pod-to-pod', async (req, res) => {
  let targetSvc = 'productpage.ossm-bookinfo.svc:9080';
  let testPod = 'deploy/productpage-v1';
  let testNs = 'ossm-bookinfo';
  if (MODULES.models) {
    targetSvc = `iris-onnx-predictor.${MODELS_NS}.svc:80/v2/models/iris-onnx`;
    testPod = 'deploy/test-client';
    testNs = MODELS_NS;
  }
  const result = await run(`echo 'Test: Can a mesh-enrolled pod reach another mesh service?'
echo ''
echo '  Source: test-client in "${testNs}" (IN the mesh, has SPIFFE identity)'
echo '  Target: http://${targetSvc}'
echo ''
CODE=$(oc exec -n ${testNs} ${testPod} -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://${targetSvc} 2>/dev/null)
if [ "$CODE" = "200" ]; then
  echo "Result: HTTP $CODE -- ACCESS GRANTED"
  echo ""
  echo "The pod has a SPIFFE identity and is allowed by the current policy."
  echo "Apply an AuthorizationPolicy to restrict which identities can access this service."
elif [ "$CODE" = "403" ]; then
  echo "Result: HTTP $CODE -- FORBIDDEN (AuthorizationPolicy)"
  echo ""
  echo "An AuthorizationPolicy is blocking this identity."
  echo "The test-client SPIFFE identity is not in the allowed list."
  echo "Delete the AuthorizationPolicy to restore access."
else
  echo "Result: HTTP $CODE"
  echo ""
  echo "Unexpected response. Check that the target service is running."
fi`);
  res.json(result);
});

app.post('/api/test-bypass', async (req, res) => {
  let targetSvc = 'productpage.ossm-bookinfo.svc:9080/productpage';
  if (MODULES.models) {
    targetSvc = `iris-onnx-predictor.${MODELS_NS}.svc:80/v2/models/iris-onnx`;
  }
  const result = await run(`echo 'Test: Can a pod outside the mesh reach a mesh service directly?'
echo ''
echo '  Source: bypass-test pod in "default" namespace (NOT in the mesh)'
echo '  Target: http://${targetSvc}'
echo ''
CODE=$(oc run bypass-test --rm -i --restart=Never -n default --image=curlimages/curl -- -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://${targetSvc} 2>/dev/null | grep -oE '[0-9]{3}' | tail -1)
if [ "$CODE" = "200" ]; then
  echo "Result: HTTP $CODE -- ACCESS GRANTED"
  echo ""
  echo "The request succeeded. PeerAuthentication may be set to PERMISSIVE,"
  echo "which allows plaintext connections from outside the mesh."
else
  echo "Result: HTTP $CODE -- BLOCKED"
  echo ""
  echo "The pod has no SPIFFE identity (it is not in the mesh)."
  echo "PeerAuthentication STRICT mode requires a valid mTLS certificate"
  echo "on every inbound connection. No certificate = no access."
  echo ""
  echo "This is zero trust: identity is verified cryptographically on"
  echo "every connection, not by network position or shared secrets."
fi`);
  res.json({ output: result.output, exitCode: 1 });
});

app.post('/api/test-same-namespace', async (req, res) => {
  const result = await run(`echo 'Test: Can a pod in ossm-restapi reach another service in the same namespace?'
echo ''
echo '  Source: web-front-end in ossm-restapi (allowed namespace)'
echo '  Target: service-b.ossm-restapi.svc:8080'
echo ''
CODE=$(oc exec -n ossm-restapi deploy/web-front-end -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://service-b.ossm-restapi.svc:8080 2>/dev/null)
if [ "$CODE" = "200" ]; then
  echo "Result: HTTP $CODE -- ACCESS GRANTED"
  echo ""
  echo "Same-namespace access is allowed by the policy."
elif [ "$CODE" = "403" ]; then
  echo "Result: HTTP $CODE -- FORBIDDEN"
  echo ""
  echo "Unexpected. The policy should allow same-namespace access."
else
  echo "Result: HTTP $CODE"
fi`);
  res.json(result);
});

app.post('/api/test-cross-namespace', async (req, res) => {
  const result = await run(`echo 'Test: Can a pod in one namespace reach a service in another?'
echo ''
echo '  Source: test-client in "ossm-httpbin" namespace'
echo '  Target: web-front-end.ossm-restapi.svc:8080'
echo ''
CODE=$(oc exec -n ossm-httpbin deploy/test-client -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 http://web-front-end.ossm-restapi.svc:8080 2>/dev/null)
if [ "$CODE" = "200" ]; then
  echo "Result: HTTP $CODE -- ACCESS GRANTED"
  echo ""
  echo "Cross-namespace access is allowed. Both pods are in the mesh and"
  echo "no AuthorizationPolicy restricts this path."
  echo ""
  echo "Apply an AuthorizationPolicy to restrict which namespaces can"
  echo "reach this service."
elif [ "$CODE" = "403" ]; then
  echo "Result: HTTP $CODE -- FORBIDDEN"
  echo ""
  echo "An AuthorizationPolicy is blocking cross-namespace access."
  echo "The httpbin namespace identity is not in the allowed list."
else
  echo "Result: HTTP $CODE"
  echo ""
  echo "Check that web-front-end is running in ossm-restapi."
fi`);
  res.json(result);
});

cachedGet('/api/audit', 5000, async (req, res) => {
  const logsResult = await run("oc logs -n ztunnel -l app=ztunnel --since=5m 2>/dev/null | grep access | grep -v prometheus | grep -v metrics | grep -v openshift-user-workload | grep -v mesh-logger | grep -v mesh-pinger | tail -15");
  const lines = logsResult.output.trim().split('\n').filter(function(l) { return l.trim(); });
  var output = '';
  lines.forEach(function(line) {
    var tsMatch = line.match(/\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})/);
    var ts = tsMatch ? tsMatch[1] : '?';
    var fields = {};
    var m;
    var re1 = /(\w[\w.]+)="([^"]*)"/g;
    while ((m = re1.exec(line)) !== null) { fields[m[1]] = m[2]; }
    var re2 = /\b(bytes_sent|bytes_recv|duration)=(\d+\w*)/g;
    while ((m = re2.exec(line)) !== null) { if (!fields[m[1]]) fields[m[1]] = m[2]; }
    if (Object.keys(fields).length === 0) return;
    var srcId = fields['src.identity'] || '';
    var srcWl = fields['src.workload'] || '?';
    var srcLabel = srcId ? srcId.split('/').pop() : srcWl;
    var dstSvc = (fields['dst.service'] || '?').split('.')[0];
    var sent = fields['bytes_sent'] || '?';
    var recv = fields['bytes_recv'] || '?';
    var dur = fields['duration'] || '?';
    var err = fields['error'] || '';
    var status = err ? 'DENY' : ' OK ';
    output += ts + ' [' + status + '] ' + srcLabel + ' -> ' + dstSvc + '  ' + sent + 'B/' + recv + 'B ' + dur + '\n';
    if (err) output += '         reason: ' + err + '\n';
  });
  if (lines.length === 0) output = '(no recent traffic)';
  res.json({ output: output, exitCode: 0 });
});

// --- Traffic Management ---

cachedGet('/api/traffic-policy/status', 5000, async (req, res) => {
  const hrCheck = await run('oc get httproute httpbin-timeout -n ossm-httpbin --no-headers 2>/dev/null');
  const active = hrCheck.output.trim().length > 0 && hrCheck.exitCode === 0;
  if (!active) {
    res.json({ active, output: 'No traffic policy applied.\n\nApply the timeout policy to add a 5s request timeout via HTTPRoute.' });
    return;
  }
  const result = await runCleanYaml('oc get httproute httpbin-timeout -n ossm-httpbin -o yaml 2>/dev/null');
  res.json({ active, output: result.output });
});

app.post('/api/traffic-policy/apply', async (req, res) => {
  const result = await run(`oc apply -f - <<'EOF' 2>&1
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: httpbin-timeout
  namespace: ossm-httpbin
spec:
  parentRefs:
    - kind: Service
      group: ""
      name: httpbin
      port: 80
  rules:
    - backendRefs:
        - name: httpbin
          port: 80
      timeouts:
        request: 5s
EOF
echo ''
echo 'Applied: HTTPRoute httpbin-timeout (5s request timeout)'
echo 'The waypoint will cut off any response that takes longer than 5 seconds.'`);
  res.json(result);
});

app.post('/api/traffic-policy/delete', async (req, res) => {
  const result = await run('oc delete httproute httpbin-timeout -n ossm-httpbin 2>&1');
  res.json(result);
});

app.post('/api/test-timeout', async (req, res) => {
  const result = await run(`echo '$ curl http://httpbin.ossm-httpbin.svc/delay/10'
echo '  (httpbin delays response by 10 seconds)'
echo ''
START=$(date +%s)
CODE=$(oc exec -n ossm-httpbin deploy/test-client -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 15 http://httpbin.ossm-httpbin.svc/delay/10 2>/dev/null)
END=$(date +%s)
ELAPSED=$((END - START))
echo "Result: HTTP $CODE (took ~\${ELAPSED}s)"
echo ''
if [ "$CODE" = "504" ]; then
  echo "The waypoint enforced the 5s timeout -- request cut off before"
  echo "the 10s delay completed. The client gets a fast failure instead"
  echo "of waiting forever."
elif [ "$ELAPSED" -gt 8 ]; then
  echo "No traffic policy active -- the request waited the full delay."
  echo "Apply the traffic policy to see the difference."
else
  echo "Request completed in \${ELAPSED}s."
fi`);
  res.json(result);
});

app.post('/api/test-unstable', async (req, res) => {
  const result = await run(`echo '$ curl http://httpbin.ossm-httpbin.svc/unstable  (x50)'
echo '  (httpbin returns 500 ~50% of the time)'
echo ''
PASS=0; FAIL=0
for i in $(seq 1 50); do
  CODE=$(oc exec -n ossm-httpbin deploy/test-client -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://httpbin.ossm-httpbin.svc/unstable 2>/dev/null)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
done
echo ""
echo ""
echo "Results: $PASS succeeded, $FAIL failed out of 50"
PCT=$((PASS * 100 / 50))
echo "Success rate: $PCT%"
echo ""
if [ "$FAIL" -gt 15 ]; then
  echo "Without retries, the client sees the ~50% failure rate directly."
  echo "Apply the traffic policy to enable automatic retries."
elif [ "$FAIL" -le 3 ]; then
  echo "Retries are absorbing failures. httpbin still fails ~50% internally"
  echo "but the waypoint retries up to 5 times before the client sees an error."
else
  echo "Some failures getting through. Retries are helping but not catching all."
fi`);
  res.json(result);
});

// --- Mesh Enrollment Demo ---

app.get('/api/enrollment/status', async (req, res) => {
  const enrolled = await run("oc get namespace ossm-enrollment-test -o jsonpath='{.metadata.labels.istio\\.io/dataplane-mode}' 2>/dev/null");
  const isEnrolled = enrolled.output.replace(/'/g, '').trim() === 'ambient';
  const pingerLogs = await run('oc logs -n ossm-enrollment-test deploy/mesh-pinger --tail=8 2>/dev/null');
  const loggerLogs = await run('oc logs -n ossm-mesh-demo deploy/mesh-logger --tail=8 2>/dev/null');

  let identityInfo = '';
  if (isEnrolled) {
    const ztunnelLogs = await run("oc logs -n ztunnel -l app=ztunnel --since=30s 2>/dev/null | grep access | grep mesh-logger | grep -v error | tail -1");
    const identityMatch = ztunnelLogs.output.match(/src\.identity="([^"]*)"/);
    if (identityMatch) {
      identityInfo = '\n=== SPIFFE Identity (from ztunnel) ===\nPinger identity: ' + identityMatch[1] + '\n';
    }
  }

  res.json({
    enrolled: isEnrolled,
    output: '=== Pinger logs (ossm-enrollment-test) ===\n' + (pingerLogs.output || '(no logs)') +
      '\n=== Logger logs (ossm-mesh-demo) ===\n' + (loggerLogs.output || '(no pings received)') +
      identityInfo
  });
});

app.get('/api/enrollment/logger-pings', async (req, res) => {
  const result = await run("oc exec -n ossm-mesh-demo deploy/mesh-logger -- curl -s http://localhost:8080/pings 2>/dev/null");
  res.json(result);
});

app.post('/api/enrollment/enroll', async (req, res) => {
  const result = await run(`echo 'Enrolling ossm-enrollment-test namespace into the mesh...'
echo ''
echo '$ oc label namespace ossm-enrollment-test istio.io/dataplane-mode=ambient'
echo ''
oc label namespace ossm-enrollment-test istio.io/dataplane-mode=ambient --overwrite 2>&1
echo ''
echo 'Namespace labeled. ztunnel will pick up the pod within seconds.'
echo 'The pinger will get a SPIFFE identity and its connections to the'
echo 'logger will start succeeding through mTLS.'
echo ''
echo 'Watch the pinger logs and logger logs to see the transition.'`);
  res.json(result);
});

app.post('/api/enrollment/unenroll', async (req, res) => {
  const result = await run(`echo 'Removing mesh enrollment from ossm-enrollment-test...'
echo ''
oc label namespace ossm-enrollment-test istio.io/dataplane-mode- 2>&1
echo ''
echo 'Namespace label removed. The pinger will lose its SPIFFE identity'
echo 'and connections to the logger will start failing again.'`);
  res.json(result);
});

// --- RequestAuthentication ---

app.get('/api/request-auth/status', async (req, res) => {
  const ra = await run('oc get requestauthentication -A --no-headers 2>/dev/null');
  const ap = await run('oc get authorizationpolicy -n istio-ingress --no-headers 2>/dev/null | grep jwt');
  var output = '';
  if (ra.output.trim()) {
    output += '=== RequestAuthentication ===\n' + ra.output + '\n';
  } else {
    output += 'No RequestAuthentication policies configured.\n\n';
  }
  if (ap.output.trim()) {
    output += '=== JWT AuthorizationPolicy ===\n' + ap.output;
  }
  res.json({ output, exitCode: 0 });
});

app.post('/api/request-auth/apply', async (req, res) => {
  const result = await run(`echo 'Applying RequestAuthentication + AuthorizationPolicy to restapi-gateway...'
echo ''
oc apply -f - <<'EOF' 2>&1
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: demo-jwt-auth
  namespace: istio-ingress
spec:
  targetRefs:
    - kind: Gateway
      group: gateway.networking.k8s.io
      name: restapi-gateway
  jwtRules:
    - issuer: "testing@secure.istio.io"
      jwksUri: "https://raw.githubusercontent.com/istio/istio/release-1.24/security/tools/jwt/samples/jwks.json"
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: demo-jwt-require
  namespace: istio-ingress
spec:
  targetRefs:
    - kind: Gateway
      group: gateway.networking.k8s.io
      name: restapi-gateway
  action: ALLOW
  rules:
    - from:
        - source:
            requestPrincipals: ["*"]
EOF
echo ''
echo 'Applied. The restapi-gateway now requires a valid JWT.'
echo 'Requests without a token will be denied.'`);
  res.json(result);
});

app.post('/api/request-auth/test-no-token', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway restapi-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'restapi-gateway has no address.'
  exit 1
fi
echo '$ curl http://$GATEWAY/hello (no token)'
echo ''
CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://$GATEWAY/hello" 2>/dev/null)
echo "HTTP $CODE"
echo ''
if [ "$CODE" = "403" ]; then
  echo 'Denied. The gateway requires a valid JWT but none was provided.'
elif [ "$CODE" = "200" ]; then
  echo 'Allowed. No RequestAuthentication is active — requests pass without a token.'
else
  echo "Unexpected response."
fi`);
  res.json(result);
});

app.post('/api/request-auth/test-with-token', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway restapi-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'restapi-gateway has no address.'
  exit 1
fi
# Istio's test JWT token (issuer: testing@secure.istio.io)
TOKEN="eyJhbGciOiJSUzI1NiIsImtpZCI6IkRIRmJwb0lVcXJZOHQyenBBMnFYZkNtcjVWTzVaRXI0UnpIVV8tZW52dlEiLCJ0eXAiOiJKV1QifQ.eyJleHAiOjQ2ODU5ODk3MDAsImlhdCI6MTUzMjM4OTcwMCwiaXNzIjoidGVzdGluZ0BzZWN1cmUuaXN0aW8uaW8iLCJzdWIiOiJ0ZXN0aW5nQHNlY3VyZS5pc3Rpby5pbyJ9.CfNnDjMBWtYs3fhKPT1RSZhBwsvHzNaRFGtd0LH_5Ig6ECkGXj2YoU8Bpo1UcPVUBDiGJMwyYYMGm7KT7nBHQ-K2rBng0Av-v0EoeemRW_KhZ8BFQX5Yh0DE6L1h4KP0J1Hhqkk3Gj3jlINf4mJB3XSaGdQaI2FrQLYqRCUzXS_R05-AwC43AbGjWJB-nSEh57E-MC_37XPix0cUr12RXVNPmVOtlQQfFzJL45Best1HwrplI0J-ZFKR3EvH7ZPQajg2EPFSALJgXOQf7KaHEjSdrb6G5St3SA9d3M-y9LDzKqOdNC4iMrBYS0bfXMBPOAx7e5OkkhsFtCvnTCkGE0w"
echo '$ curl -H "Authorization: Bearer <istio-test-jwt>" http://$GATEWAY/hello'
echo ''
CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 -H "Authorization: Bearer $TOKEN" "http://$GATEWAY/hello" 2>/dev/null)
echo "HTTP $CODE"
echo ''
if [ "$CODE" = "200" ]; then
  echo 'Allowed. The JWT was validated by RequestAuthentication.'
  echo 'Issuer: testing@secure.istio.io'
elif [ "$CODE" = "401" ]; then
  echo 'Unauthorized. The token may be expired or the JWKS could not be fetched.'
elif [ "$CODE" = "403" ]; then
  echo 'Forbidden. Token validated but AuthorizationPolicy denied the request.'
else
  echo "Unexpected response."
fi`);
  res.json(result);
});

app.post('/api/request-auth/delete', async (req, res) => {
  const result = await run(`oc delete requestauthentication demo-jwt-auth -n istio-ingress 2>&1
oc delete authorizationpolicy demo-jwt-require -n istio-ingress 2>&1
echo ''
echo 'JWT validation removed. The restapi-gateway accepts all requests again.'`);
  res.json(result);
});

// --- ServiceEntry ---

app.get('/api/service-entry/status', async (req, res) => {
  const result = await run('oc get serviceentry -A --no-headers 2>/dev/null');
  if (!result.output.trim()) {
    res.json({ output: 'No ServiceEntries configured.\n\nServiceEntry registers external services in the mesh registry.\nThis enables observability, policy control, and egress governance\nfor traffic leaving the cluster.', exitCode: 0 });
    return;
  }
  res.json(result);
});

app.get('/api/service-entry/list', async (req, res) => {
  const result = await run(`oc get serviceentry -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,HOSTS:.spec.hosts[*],LOCATION:.spec.location,RESOLUTION:.spec.resolution' --no-headers 2>/dev/null`);
  if (!result.output.trim()) {
    res.json({ output: 'No ServiceEntries found', exitCode: 0 });
    return;
  }
  res.json(result);
});

app.post('/api/service-entry/test-external', async (req, res) => {
  const result = await run(`echo 'Calling httpbin.org from test-client in ossm-httpbin...'
echo ''
RESULT=$(oc exec -n ossm-httpbin deploy/test-client -- curl -s --connect-timeout 5 https://httpbin.org/get 2>/dev/null)
if [ -n "$RESULT" ]; then
  echo "$RESULT" | jq '{url, origin, headers: {Host: .headers.Host}}' 2>/dev/null || echo "$RESULT"
  echo ''
  HAS_SE=$(oc get serviceentry httpbin-org -n ossm-httpbin --no-headers 2>/dev/null | wc -l | tr -d ' ')
  if [ "$HAS_SE" = "0" ]; then
    echo 'This request succeeded but is invisible to the mesh.'
    echo 'The traffic bypasses ztunnel for external destinations.'
    echo 'Apply a ServiceEntry to bring it under mesh observability and policy.'
  else
    echo 'ServiceEntry is active. This traffic is now visible to the mesh'
    echo 'and subject to AuthorizationPolicy.'
  fi
else
  echo 'Could not reach httpbin.org. Check network connectivity.'
fi`);
  res.json(result);
});

app.post('/api/service-entry/apply', async (req, res) => {
  const result = await run(`oc apply -f - <<'EOF' 2>&1
apiVersion: networking.istio.io/v1
kind: ServiceEntry
metadata:
  name: httpbin-org
  namespace: ossm-httpbin
spec:
  hosts:
    - httpbin.org
  location: MESH_EXTERNAL
  ports:
    - number: 443
      name: https
      protocol: TLS
    - number: 80
      name: http
      protocol: HTTP
  resolution: DNS
EOF
echo ''
echo 'ServiceEntry applied. httpbin.org is now registered in the mesh.'
echo 'Traffic to httpbin.org will appear in Kiali and can be governed by AuthorizationPolicy.'`);
  res.json(result);
});

app.post('/api/service-entry/delete', async (req, res) => {
  const result = await run('oc delete serviceentry httpbin-org -n ossm-httpbin 2>&1');
  res.json(result);
});

// --- Scaling ---

app.get('/api/scaling/status', async (req, res) => {
  const result = await run(`echo '=== Gateway Deployments ==='
oc get deploy -n istio-ingress -o custom-columns='NAME:.metadata.name,READY:.status.readyReplicas,REPLICAS:.spec.replicas' --no-headers 2>/dev/null | grep -v '^$'
echo ''
echo '=== Waypoint Deployments ==='
for NS in ossm-bookinfo ossm-restapi ossm-httpbin ${MODELS_NS}; do
  oc get deploy -n $NS --no-headers 2>/dev/null | grep waypoint | awk -v ns=$NS '{printf "  %-40s %s (ns: %s)\\n", $1, $2, ns}'
done
echo ''
echo '=== HPAs ==='
oc get hpa -n istio-ingress --no-headers 2>/dev/null | awk '{printf "  %-40s min=%s max=%s cpu=%s\\n", $1, $4, $5, $3}' 2>/dev/null
for NS in ossm-bookinfo ossm-restapi ossm-httpbin ${MODELS_NS}; do
  oc get hpa -n $NS --no-headers 2>/dev/null | awk -v ns=$NS '{printf "  %-40s min=%s max=%s cpu=%s (ns: %s)\\n", $1, $4, $5, $3, ns}'
done
TOTAL_HPA=$(oc get hpa -n istio-ingress --no-headers 2>/dev/null | wc -l | tr -d ' ')
if [ "$TOTAL_HPA" = "0" ]; then
  echo '  (none configured — gateways are single-replica)'
fi`);
  res.json(result);
});

// --- HTTPRoutes ---

app.get('/api/httproutes/list', async (req, res) => {
  const result = await run(`echo '=== North-South (attached to Gateways) ==='
echo 'Required — without an HTTPRoute, the gateway returns 404.'
echo ''
printf '  %-20s %-42s %-20s %s\\n' 'NAMESPACE' 'HTTPROUTE' 'GATEWAY' 'HOSTNAME'
printf '  %-20s %-42s %-20s %s\\n' '---------' '---------' '-------' '--------'
oc get httproute -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,PARENT:.spec.parentRefs[0].name,HOSTNAMES:.spec.hostnames[*]' --no-headers 2>/dev/null | while read NS NAME PARENT HOSTS; do
  KIND=$(oc get httproute $NAME -n $NS -o jsonpath='{.spec.parentRefs[0].kind}' 2>/dev/null)
  if [ "$KIND" = "Gateway" ]; then
    HOSTS_CLEAN=$(echo "$HOSTS" | sed 's/<none>//')
    printf "  %-20s %-42s %-20s %s\\n" "$NS" "$NAME" "$PARENT" "$HOSTS_CLEAN"
  fi
done
echo ''
echo '=== East-West (attached to Services via Waypoint) ==='
echo 'Optional — adds L7 behavior like timeouts and canary splits.'
echo ''
printf '  %-20s %-42s %-20s %s\\n' 'NAMESPACE' 'HTTPROUTE' 'SERVICE' 'BEHAVIOR'
printf '  %-20s %-42s %-20s %s\\n' '---------' '---------' '-------' '--------'
oc get httproute -A -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,PARENT:.spec.parentRefs[0].name' --no-headers 2>/dev/null | while read NS NAME PARENT; do
  KIND=$(oc get httproute $NAME -n $NS -o jsonpath='{.spec.parentRefs[0].kind}' 2>/dev/null)
  if [ "$KIND" = "Service" ]; then
    TIMEOUT=$(oc get httproute $NAME -n $NS -o jsonpath='{.spec.rules[0].timeouts.request}' 2>/dev/null)
    WEIGHTS=$(oc get httproute $NAME -n $NS -o jsonpath='{.spec.rules[0].backendRefs[*].weight}' 2>/dev/null | tr -s ' ')
    BEHAVIOR=""
    if [ -n "$TIMEOUT" ]; then BEHAVIOR="timeout: $TIMEOUT"; fi
    if [ -n "$WEIGHTS" ]; then BEHAVIOR="weights: $WEIGHTS"; fi
    printf "  %-20s %-42s %-20s %s\\n" "$NS" "$NAME" "$PARENT" "$BEHAVIOR"
  fi
done`);
  res.json(result);
});

app.get('/api/httproutes/show', async (req, res) => {
  var name = req.query.name;
  var ns = req.query.ns;
  if (!name || !ns) {
    res.json({ output: 'Specify ?name=<name>&ns=<namespace>', exitCode: 1 });
    return;
  }
  var result = await runCleanYaml(`oc get httproute ${name} -n ${ns} -o yaml 2>/dev/null`);
  if (!result.output.trim()) result = { output: 'HTTPRoute not found', exitCode: 1 };
  res.json(result);
});

app.get('/api/httproutes/summary', async (req, res) => {
  const gateways = await run("oc get httproute -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name} {.spec.parentRefs[0].kind} {.spec.parentRefs[0].name}{\"\\n\"}{end}' 2>/dev/null");
  var gwCount = 0, svcCount = 0;
  gateways.output.split('\n').forEach(function(line) {
    if (line.includes('Gateway')) gwCount++;
    if (line.includes('Service')) svcCount++;
  });
  res.json({
    output: gwCount + ' attached to Gateways (north-south)\n' + svcCount + ' attached to Services (east-west)',
    gatewayCount: gwCount,
    serviceCount: svcCount
  });
});

app.post('/api/httproutes/demo-delete', async (req, res) => {
  const result = await run(`echo 'Deleting bookinfo-http-route...'
oc delete httproute bookinfo-http-route -n ossm-bookinfo 2>&1
echo ''
echo 'HTTPRoute deleted. The bookinfo-gateway no longer knows where to send traffic.'
echo 'Try curling the gateway — it should return 404.'`);
  res.json(result);
});

app.post('/api/httproutes/demo-test-gateway', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'Bookinfo gateway has no address.'
  exit 1
fi
echo "$ curl http://$GATEWAY/productpage"
echo ''
CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://$GATEWAY/productpage" 2>/dev/null)
echo "HTTP $CODE"
echo ''
if [ "$CODE" = "200" ]; then
  echo 'HTTPRoute is active — the gateway routed traffic to productpage.'
elif [ "$CODE" = "404" ]; then
  echo 'No HTTPRoute — the gateway has no routing rules and returns 404.'
  echo 'Recreate the HTTPRoute to restore access.'
else
  echo "Unexpected response."
fi`);
  res.json(result);
});

app.post('/api/httproutes/demo-recreate', async (req, res) => {
  const result = await run(`echo 'Recreating bookinfo-http-route...'
oc apply -f - <<'EOF' 2>&1
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: bookinfo-http-route
  namespace: ossm-bookinfo
spec:
  parentRefs:
    - group: gateway.networking.k8s.io
      kind: Gateway
      name: bookinfo-gateway
      namespace: istio-ingress
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: productpage
          port: 9080
EOF
echo ''
echo 'HTTPRoute recreated. The gateway can route traffic again.'`);
  res.json(result);
});

cachedGet('/api/httproutes/parents', 10000, async (req, res) => {
  const result = await run("oc get httproute -A -o jsonpath='{range .items[*]}{.spec.parentRefs[0].kind}/{.spec.parentRefs[0].name}@{.metadata.namespace}{\"\\n\"}{end}' 2>/dev/null");
  var parents = {};
  result.output.replace(/'/g, '').trim().split('\n').forEach(function(line) {
    if (!line.trim()) return;
    var parts = line.split('@');
    var ref = parts[0];
    var ns = parts[1];
    var key = ref + '@' + ns;
    parents[key] = (parents[key] || 0) + 1;
  });
  res.json({ parents: parents });
});

// --- Observability ---

app.post('/api/generate-traffic', async (req, res) => {
  let commands = 'echo "Generating traffic to detected workloads..."\necho ""\n';

  if (MODULES.bookinfo) {
    commands += `
echo 'Bookinfo (via Gateway API):'
GATEWAY=$(oc get gateway bookinfo-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -n "$GATEWAY" ]; then
  PASS=0; FAIL=0
  for i in $(seq 1 10); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "http://$GATEWAY/productpage" 2>/dev/null)
    if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
    sleep 0.2
  done
  echo "  $PASS/$((PASS+FAIL))"
else
  echo "  (gateway address not ready)"
fi
echo ''
`;
  }

  if (MODULES.restapi) {
    commands += `
echo 'REST API (via Gateway API):'
GATEWAY=$(oc get gateway restapi-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -n "$GATEWAY" ]; then
  PASS=0; FAIL=0
  for i in $(seq 1 5); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 "$GATEWAY/hello" 2>/dev/null)
    if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
    sleep 0.2
  done
  echo "  $PASS/$((PASS+FAIL))"
else
  echo "  (gateway address not ready)"
fi
echo ''
`;
  }

  if (MODULES.models) {
    commands += `
echo 'AI model inference (via mesh gateway):'
PASS=0; FAIL=0
for i in $(seq 1 5); do
  CODE=$(curl -k -s -o /dev/null -w '%{http_code}' --connect-timeout 5 https://iris-onnx.${DOMAIN}/v2/models/iris-onnx 2>/dev/null)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
  sleep 0.2
done
echo "  $PASS/$((PASS+FAIL))"
echo ''
`;
  }

  commands += `echo 'Done. Check Kiali to see the traffic topology.'`;

  const result = await run(commands);
  res.json({ output: result.output, exitCode: 0 });
});

app.get('/api/kiali-url', async (req, res) => {
  res.json({ url: KIALI_URL, consoleUrl: CONSOLE_URL, output: `Kiali: ${KIALI_URL}\nOCP Console: ${CONSOLE_URL}` });
});

// --- Startup ---

run("oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null").then(({ output: stdout }) => {
  if (stdout && stdout.trim()) DOMAIN = stdout.trim().replace(/'/g, '');
  console.log(`Cluster domain: ${DOMAIN}`);

  detectModules().then(() => {
    app.listen(PORT, () => {
      console.log(`OSSM3 Demo Console running at http://localhost:${PORT}`);
    });
  });
});

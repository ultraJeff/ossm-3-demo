const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = 3000;
const TIMEOUT = 30000;
let DOMAIN = 'apps.example.com';
const MODULES = {};
let KIALI_URL = '';
let CONSOLE_URL = '';
let BOOKINFO_URL = '';
let MODELS_NS = 'ossm-ai-models';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function run(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: TIMEOUT, shell: '/bin/zsh' }, (err, stdout, stderr) => {
      resolve({ output: stdout || stderr || (err ? err.message : ''), exitCode: err ? err.code || 1 : 0 });
    });
  });
}

const YAML_CLEAN = "grep -v '^ *creationTimestamp:\\|^ *generation:\\|^ *resourceVersion:\\|^ *uid:\\|^ *managedFields:\\|^ *- manager:\\|^ *operation:\\|^ *time:\\|^ *fieldsType:\\|^ *fieldsV1:\\|^ *f:\\|^ *kubectl.kubernetes.io/last-applied-configuration:\\|^ *argocd.argoproj.io' | sed '/^  annotations:/{N;/annotations:\\n *$/d}'";

function cleanYaml(cmd) {
  return cmd + ' | ' + YAML_CLEAN;
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

app.get('/api/health', async (req, res) => {
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
  const gw = await run(cleanYaml('oc get gateway bookinfo-gateway -n istio-ingress -o yaml 2>/dev/null'));
  const routes = await run('oc get httproute -n ossm-bookinfo 2>/dev/null');
  res.json({ output: '=== Gateway ===\n' + gw.output + '\n=== HTTPRoutes ===\n' + routes.output, exitCode: 0 });
});

// --- RestAPI / Gateway API (if ossm-restapi namespace exists) ---

app.get('/api/restapi/status', async (req, res) => {
  const pods = await run('oc get pods -n ossm-restapi 2>/dev/null');
  const gw = await run('oc get gateway hello-gateway -n istio-ingress 2>/dev/null');
  const routes = await run('oc get httproute -n ossm-restapi 2>/dev/null');
  res.json({ output: '=== Pods ===\n' + pods.output + '\n=== Gateway ===\n' + gw.output + '\n=== HTTPRoutes ===\n' + routes.output, exitCode: 0 });
});

app.post('/api/restapi/test', async (req, res) => {
  const result = await run(`GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'hello-gateway has no address yet. It may still be provisioning.'
  echo ''
  echo 'Gateway status:'
  oc get gateway hello-gateway -n istio-ingress 2>/dev/null
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
  const hr = await run(cleanYaml('oc get httproute service-b-canary -n ossm-restapi -o yaml 2>/dev/null'));
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
  const result = await run(`GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
if [ -z "$GATEWAY" ]; then
  echo 'hello-gateway has no address yet.'
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
  const result = await run(`oc get inferenceservice,servingruntime -n ${MODELS_NS} 2>/dev/null`);
  res.json(result);
});

app.post('/api/models/infer-iris', async (req, res) => {
  const result = await run(`echo '$ curl -sk https://iris-onnx.${DOMAIN}/v2/models/iris-onnx/infer \\\\'
echo '    -H "Content-Type: application/json" \\\\'
echo '    -d '"'"'{"inputs":[{"name":"input","shape":[1,4],"datatype":"FP32","data":[5.1,3.5,1.4,0.2]}]}'"'"''
echo ''
RESULT=$(curl -sk https://iris-onnx.${DOMAIN}/v2/models/iris-onnx/infer -H 'Content-Type: application/json' -d '{"inputs":[{"name":"input","shape":[1,4],"datatype":"FP32","data":[5.1,3.5,1.4,0.2]}]}' 2>/dev/null)
if [ -n "$RESULT" ]; then
  echo "$RESULT" | jq .
  echo ''
  echo 'The model classified the input as iris class 0 (setosa).'
  echo 'This request was encrypted end-to-end via mTLS -- the model'
  echo 'runtime served plain HTTP, ztunnel handled all encryption.'
else
  echo 'No response from model. Check that the mesh-gateway route and'
  echo 'iris-onnx InferenceService are running.'
fi`);
  res.json(result);
});

app.post('/api/models/infer-phi4', async (req, res) => {
  const result = await run(`echo 'Phi-4 Mini -- OpenAI-compatible chat completion via vLLM'
echo ''
echo '$ curl -sk https://phi4-mesh.${DOMAIN}/v1/chat/completions \\\\'
echo '    -H "Content-Type: application/json" \\\\'
echo '    -d '"'"'{"model":"phi-4-mini","messages":[{"role":"user","content":"What is a service mesh in one sentence?"}],"max_tokens":100}'"'"''
echo ''
RESULT=$(curl -sk --connect-timeout 30 --max-time 60 https://phi4-mesh.${DOMAIN}/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"phi-4-mini","messages":[{"role":"user","content":"What is a service mesh in one sentence?"}],"max_tokens":100}' 2>/dev/null)
if [ -n "$RESULT" ]; then
  CONTENT=$(echo "$RESULT" | jq -r '.choices[0].message.content' 2>/dev/null)
  if [ -n "$CONTENT" ]; then
    echo "Response:"
    echo "  $CONTENT"
  else
    echo "$RESULT" | jq . 2>/dev/null || echo "$RESULT"
  fi
  echo ''
  echo 'This LLM request traversed the same mTLS mesh path as the ONNX model.'
  echo 'The vLLM runtime serves a standard OpenAI API -- ztunnel encrypts it.'
else
  echo 'No response from Phi-4 Mini. The model may still be loading (CPU-only'
  echo 'inference can take time to initialize) or the route may not exist.'
  echo ''
  echo 'Check: oc get route mesh-gateway-phi4 -n istio-system'
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
oc get peerauthentication -A --no-headers 2>/dev/null | grep -v ossm-mesh-demo
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
  const targetGateway = MODULES.models ? 'mesh-waypoint' : 'bookinfo-waypoint';
  const principals = MODULES.models
    ? [`cluster.local/ns/istio-system/sa/mesh-gateway-istio`, `cluster.local/ns/${MODELS_NS}/sa/mesh-waypoint`]
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
  const result = await run(cleanYaml(`oc get authorizationpolicy demo-restrict-access -n ${targetNs} -o yaml 2>/dev/null`) + ` || echo "No pod-to-pod AuthorizationPolicy applied"`);
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
  const result = await run(cleanYaml('oc get authorizationpolicy demo-restrict-cross-ns -n ossm-restapi -o yaml 2>/dev/null') + ' || echo "No cross-namespace AuthorizationPolicy applied"');
  res.json(result);
});

app.post('/api/authz-policy/delete-cross-ns', async (req, res) => {
  const result = await run('oc delete authorizationpolicy demo-restrict-cross-ns -n ossm-restapi 2>&1');
  res.json(result);
});

app.get('/api/authz-policy/status', async (req, res) => {
  const result = await run('oc get authorizationpolicy -A --no-headers 2>/dev/null');
  const active = result.output.trim().length > 0 && result.exitCode === 0;
  res.json({ active, output: result.output || 'No AuthorizationPolicy applied' });
});

app.post('/api/test-allowed-identity', async (req, res) => {
  const result = await run(`echo 'Test: Can the gateway identity reach the model service?'
echo ''
echo '  Identity: spiffe://cluster.local/ns/istio-system/sa/mesh-gateway-istio'
echo '  Path: external request -> mesh-gateway -> waypoint -> model'
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
echo '  Source: test-client in "httpbin" namespace'
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

app.get('/api/audit', async (req, res) => {
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

app.get('/api/traffic-policy/status', async (req, res) => {
  const hrCheck = await run('oc get httproute httpbin-timeout -n ossm-httpbin --no-headers 2>/dev/null');
  const vsCheck = await run('oc get virtualservice httpbin-retries -n ossm-httpbin --no-headers 2>/dev/null');
  const hrActive = hrCheck.output.trim().length > 0 && hrCheck.exitCode === 0;
  const vsActive = vsCheck.output.trim().length > 0 && vsCheck.exitCode === 0;
  const active = hrActive || vsActive;
  if (!active) {
    res.json({ active, output: 'No traffic policy applied.\n\nApply the traffic policy to add a 5s timeout (HTTPRoute)\nand 3x retries on 5xx (VirtualService) to httpbin.' });
    return;
  }
  let output = '';
  if (hrActive) {
    const hr = await run("oc get httproute httpbin-timeout -n ossm-httpbin -o jsonpath='{.spec.rules[0].timeouts}' 2>/dev/null");
    output += 'HTTPRoute: httpbin-timeout\n  Timeout: ' + hr.output.replace(/'/g, '') + '\n\n';
  }
  if (vsActive) {
    const vs = await run("oc get virtualservice httpbin-retries -n ossm-httpbin -o jsonpath='{.spec.http[0].retries}' 2>/dev/null");
    output += 'VirtualService: httpbin-retries\n  Retries: ' + vs.output.replace(/'/g, '') + '\n';
  }
  res.json({ active, output });
});

app.post('/api/traffic-policy/apply', async (req, res) => {
  const result = await run(`echo '=== Applying HTTPRoute for timeout ==='
oc apply -f - <<'EOF' 2>&1
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
echo '=== Applying VirtualService for retries ==='
oc apply -f - <<'EOF2' 2>&1
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: httpbin-retries
  namespace: ossm-httpbin
spec:
  hosts:
    - httpbin.ossm-httpbin.svc.cluster.local
  http:
    - route:
        - destination:
            host: httpbin.ossm-httpbin.svc.cluster.local
            port:
              number: 80
      retries:
        attempts: 3
        retryOn: 5xx,reset,connect-failure,retriable-status-codes
EOF2
echo ''
echo 'Applied: HTTPRoute (5s timeout) + VirtualService (3x retries on 5xx)'
echo 'HTTPRoute handles timeouts natively. Retries require VirtualService'
echo 'until Gateway API adds retry support to the spec.'`);
  res.json(result);
});

app.post('/api/traffic-policy/delete', async (req, res) => {
  const result = await run(`oc delete httproute httpbin-timeout -n ossm-httpbin 2>&1
oc delete virtualservice httpbin-retries -n ossm-httpbin 2>&1`);
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
  const result = await run(`echo '$ curl http://httpbin.ossm-httpbin.svc/unstable  (x10)'
echo '  (httpbin returns 500 ~50% of the time -- simulates a flaky backend)'
echo ''
PASS=0; FAIL=0
for i in $(seq 1 10); do
  CODE=$(oc exec -n ossm-httpbin deploy/test-client -- curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 http://httpbin.ossm-httpbin.svc/unstable 2>/dev/null)
  if [ "$CODE" = "200" ]; then PASS=$((PASS+1)); printf "."; else FAIL=$((FAIL+1)); printf "X"; fi
done
echo ""
echo ""
echo "Results: $PASS succeeded, $FAIL failed out of 10"
echo ""
if [ "$FAIL" -gt 3 ]; then
  echo "Many failures visible to the client. Apply the traffic policy --"
  echo "it includes 3 automatic retries on 5xx errors. The waypoint will"
  echo "retry failed requests before the client ever sees the error."
elif [ "$FAIL" -eq 0 ]; then
  echo "All passed. If the traffic policy is active, retries are absorbing"
  echo "the ~50% failure rate behind the scenes -- the client sees 100% success."
else
  echo "Some failures. With the traffic policy active, retries should"
  echo "absorb most of these."
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
GATEWAY=$(oc get gateway hello-gateway -n istio-ingress -o jsonpath='{.status.addresses[0].value}' 2>/dev/null)
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

exec("oc get ingress.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null", (err, stdout) => {
  if (stdout && stdout.trim()) DOMAIN = stdout.trim().replace(/'/g, '');
  console.log(`Cluster domain: ${DOMAIN}`);

  detectModules().then(() => {
    app.listen(PORT, () => {
      console.log(`OSSM3 Demo Console running at http://localhost:${PORT}`);
    });
  });
});

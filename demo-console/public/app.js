async function api(method, path, body) {
  var btn = event ? event.target : null;
  if (btn && btn.classList.contains('btn')) {
    var group = btn.closest('.action-group');
    if (group) {
      group.querySelectorAll('.btn').forEach(function(b) { b.classList.remove('active'); });
    }
    btn.classList.add('active', 'running');
  }
  try {
    var opts = { method: method };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(path, opts);
    var data = await res.json();
    return data;
  } catch (e) {
    return { output: 'Error: ' + e.message, exitCode: 1 };
  } finally {
    if (btn) btn.classList.remove('running');
  }
}

function showOutput(id, data) {
  var el = document.getElementById(id);
  var text = typeof data === 'string' ? data : (data.output || JSON.stringify(data, null, 2));
  el.textContent = text.trim() || '(no output)';
  el.classList.add('visible');
  el.classList.toggle('error', data.exitCode > 0);
  el.classList.toggle('success-border', data.exitCode === 0);
}

async function runAction(path, outputId, method) {
  method = method || 'GET';
  var data = await api(method, path);
  showOutput(outputId, data);
  refreshAudit();
  if (path.includes('/enrollment/')) {
    updateEnrollmentDiagram(data);
  }
}

function updateEnrollmentDiagram(data) {
  var arrow = document.getElementById('enrollment-arrow');
  var leftBox = document.getElementById('enrollment-left-border');
  var leftIdentity = document.getElementById('enrollment-left-identity');
  var ztSrc = document.getElementById('enrollment-ztunnel-src');
  if (!arrow) return;
  if (data.enrolled) {
    arrow.innerHTML = '=== HBONE mTLS ===&rarr;';
    arrow.style.color = '#3fb950';
    if (leftBox) { leftBox.style.borderColor = '#3fb950'; }
    if (leftIdentity) { leftIdentity.textContent = 'SPIFFE identity assigned'; leftIdentity.style.color = '#3fb950'; }
    if (ztSrc) { ztSrc.style.opacity = '1'; ztSrc.style.borderColor = '#d29922'; }
  } else {
    arrow.innerHTML = '&#x2718; no mTLS';
    arrow.style.color = '#f85149';
    if (leftBox) { leftBox.style.borderColor = '#f85149'; }
    if (leftIdentity) { leftIdentity.textContent = 'no SPIFFE identity'; leftIdentity.style.color = '#f85149'; }
    if (ztSrc) { ztSrc.style.opacity = '0.4'; ztSrc.style.borderColor = '#30363d'; }
  }
}

function toggleSection(el) {
  el.closest('.section').classList.toggle('open');
}

// --- Canary weight control ---

async function applyCanaryWeight() {
  var v1 = parseInt(document.getElementById('canary-v1').value) || 0;
  var v2 = parseInt(document.getElementById('canary-v2').value) || 0;
  if (v1 + v2 !== 100) {
    showOutput('out-3b', { output: 'Weights must add up to 100 (currently ' + (v1 + v2) + ')', exitCode: 1 });
    return;
  }
  var data = await api('POST', '/api/restapi/canary/apply', { v1: v1, v2: v2 });
  showOutput('out-3b', data);
}

// --- Audit trail ---

async function refreshAudit() {
  try {
    var res = await fetch('/api/audit');
    var data = await res.json();
    var el = document.getElementById('audit-log');
    el.textContent = data.output.trim() || '(no recent traffic)';
    el.scrollTop = el.scrollHeight;
  } catch (e) {
    // silent
  }
}

// --- Module-aware initialization ---

async function applyConfig(config) {
  document.querySelectorAll('.section[data-module]').forEach(function(section) {
    var mod = section.dataset.module;
    if (mod === 'core') {
      section.style.display = '';
    } else {
      section.style.display = config.modules[mod] ? '' : 'none';
    }
  });

  var visibleSections = document.querySelectorAll('.section:not([style*="display: none"])');
  visibleSections.forEach(function(section, i) {
    var numEl = section.querySelector('.section-number');
    if (numEl) numEl.textContent = i + 1;
  });

  var kialiLink = document.getElementById('link-kiali');
  var consoleLink = document.getElementById('link-console');
  if (kialiLink && config.kialiUrl) kialiLink.href = config.kialiUrl;
  if (consoleLink && config.consoleUrl) consoleLink.href = config.consoleUrl + '/ossmconsole/overview';

  if (config.bookinfoUrl) {
    var bookinfoLink = document.getElementById('link-bookinfo');
    if (bookinfoLink) bookinfoLink.href = config.bookinfoUrl;
  }
}

async function loadConfig() {
  try {
    var res = await fetch('/api/config');
    var config = await res.json();
    await applyConfig(config);
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

async function redetectModules() {
  var btn = event.target;
  btn.classList.add('running');
  btn.textContent = 'Detecting...';
  try {
    var res = await fetch('/api/config/redetect', { method: 'POST' });
    var config = await res.json();
    await applyConfig(config);
    btn.textContent = 'Updated!';
    setTimeout(function() { btn.textContent = 'Re-detect Modules'; }, 2000);
  } catch (e) {
    btn.textContent = 'Error';
    setTimeout(function() { btn.textContent = 'Re-detect Modules'; }, 2000);
  } finally {
    btn.classList.remove('running');
  }
}

// --- Sidebar status polling ---

async function refreshStatus() {
  try {
    var health = await (await fetch('/api/health')).json();

    var nodeLines = health.nodes.trim().split('\n').filter(function(l) { return l.trim(); });
    var allReady = nodeLines.length > 0 && nodeLines.every(function(l) { return l.includes('Ready'); });
    document.getElementById('status-nodes').innerHTML =
      '<span class="status-dot ' + (allReady ? 'green' : 'red') + '"></span>' +
      nodeLines.length + ' nodes ' + (allReady ? 'Ready' : 'NOT READY');

    var meshLines = health.mesh.trim().split('\n').filter(function(l) { return l.trim(); });
    var meshHealthy = meshLines.length > 0 && meshLines.every(function(l) { return l.includes('Healthy') || l.includes('True'); });
    document.getElementById('status-mesh').innerHTML =
      '<span class="status-dot ' + (meshHealthy ? 'green' : 'yellow') + '"></span>' +
      (meshHealthy ? 'Healthy' : 'Degraded');

    // Infrastructure pods
    if (health.infra) {
      var infraOk = health.infra.running === health.infra.total && health.infra.total > 0;
      document.getElementById('status-infra').innerHTML =
        '<span class="status-dot ' + (infraOk ? 'green' : 'yellow') + '"></span>' +
        health.infra.running + '/' + health.infra.total + ' running';
    }

    // PeerAuthentication
    if (health.peerAuth) {
      var paLines = health.peerAuth.trim().split('\n').filter(function(l) { return l.trim(); });
      var strictCount = paLines.filter(function(l) { return l.includes('STRICT'); }).length;
      var permCount = paLines.filter(function(l) { return l.includes('PERMISSIVE'); }).length;
      var paColor = strictCount > 0 && permCount === 0 ? 'green' : permCount > 0 ? 'yellow' : 'green';
      var paText = strictCount > 0 ? strictCount + ' STRICT' : 'none';
      if (permCount > 0) paText += ', ' + permCount + ' PERMISSIVE';
      document.getElementById('status-peer-auth').innerHTML =
        '<span class="status-dot ' + paColor + '"></span>' + paText;
    }

    // App namespace status cards
    var nsContainer = document.getElementById('ns-status-cards');
    nsContainer.innerHTML = '';
    if (health.apps) {
      Object.keys(health.apps).forEach(function(ns) {
        var podOutput = health.apps[ns];
        var podLines = podOutput.trim().split('\n').filter(function(l) { return l.trim(); });
        var running = podLines.filter(function(l) { return l.includes('Running'); }).length;
        var total = podLines.length;
        var allGood = total > 0 && running === total;
        var card = document.createElement('div');
        card.className = 'status-card';
        card.innerHTML = '<h3>' + ns + '</h3>' +
          '<div><span class="status-dot ' + (allGood ? 'green' : total > 0 ? 'yellow' : 'red') + '"></span>' +
          running + '/' + total + ' running</div>';
        nsContainer.appendChild(card);
      });
    }

    var authz = await (await fetch('/api/authz-policy/status')).json();
    document.getElementById('status-authz').innerHTML =
      '<span class="status-dot ' + (authz.active ? 'yellow' : 'green') + '"></span>' +
      (authz.active ? 'ACTIVE (restricting access)' : 'None (open access)');

    var timeout = await (await fetch('/api/traffic-policy/status')).json();
    document.getElementById('status-timeout').innerHTML =
      '<span class="status-dot ' + (timeout.active ? 'yellow' : 'green') + '"></span>' +
      (timeout.active ? 'ACTIVE' : 'None');

  } catch (e) {
    document.getElementById('status-nodes').innerHTML =
      '<span class="status-dot red"></span>API unreachable';
  }
}

// --- Topology graph ---

var topoInstance = null;

function isWaypoint(node) {
  var labels = node.data.labels || {};
  return labels['gateway.networking.k8s.io/gateway-name'] ||
    (node.data.workload && node.data.workload.indexOf('waypoint') !== -1) ||
    node.data.isGateway;
}

function addNamespaceGroups(elements) {
  var namespaces = {};
  elements.nodes.forEach(function(n) {
    if (n.data.namespace) namespaces[n.data.namespace] = true;
  });
  Object.keys(namespaces).forEach(function(ns) {
    elements.nodes.push({ data: { id: 'ns-' + ns, label: ns }, classes: 'ns-group' });
  });
  elements.nodes.forEach(function(n) {
    if (n.data.namespace) n.data.parent = 'ns-' + n.data.namespace;
  });
  return elements;
}

function getNodeLabel(d) {
  if (d.workload) return d.workload.replace(/-[a-f0-9]{8,10}(-[a-z0-9]{5})?$/, '');
  if (d.service) return d.service;
  if (d.app) return d.app;
  return d.id.substring(0, 8);
}

async function refreshTopology() {
  var statusEl = document.getElementById('topo-status');
  if (statusEl) statusEl.textContent = 'loading...';
  try {
    var res = await fetch('/api/topology');
    var data = await res.json();
    if (data.error || !data.elements) {
      if (statusEl) statusEl.textContent = data.error || 'no data';
      return;
    }

    var elements = addNamespaceGroups(data.elements);
    var container = document.getElementById('topology-graph');
    if (!container) return;

    // Determine node classes
    elements.nodes.forEach(function(n) {
      if (n.classes) return;
      var classes = [];
      if (n.data.nodeType === 'service') classes.push('svc');
      else if (isWaypoint(n)) classes.push('waypoint');
      else if (n.data.nodeType === 'workload') classes.push('workload');
      if (n.data.isIdle) classes.push('idle');
      n.classes = classes.join(' ');
      if (!n.data.label) n.data.label = getNodeLabel(n.data);
    });

    // Determine edge classes
    elements.edges.forEach(function(e) {
      var classes = [];
      if (e.data.traffic && e.data.traffic.rates && Object.keys(e.data.traffic.rates).length > 0) {
        classes.push(e.data.healthStatus === 'Failure' ? 'error' : 'active');
      } else {
        classes.push('idle');
      }
      e.classes = classes.join(' ');
    });

    if (topoInstance) {
      topoInstance.destroy();
    }

    if (typeof cytoscape === 'undefined') {
      if (statusEl) statusEl.textContent = 'cytoscape not loaded';
      return;
    }

    if (typeof cytoscapeDagre !== 'undefined') {
      cytoscape.use(cytoscapeDagre);
    }

    topoInstance = cytoscape({
      container: container,
      elements: elements,
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 20,
        rankSep: 60,
        padding: 20
      },
      style: [
        {
          selector: 'node.ns-group',
          style: {
            'background-color': '#161b22',
            'border-color': '#30363d',
            'border-width': 1,
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'font-size': '11px',
            'color': '#8b949e',
            'padding': '16px',
            'text-margin-y': -4,
            'shape': 'roundrectangle'
          }
        },
        {
          selector: 'node.workload',
          style: {
            'background-color': '#3fb950',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#e6edf3',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'width': 20,
            'height': 20,
            'border-width': 0
          }
        },
        {
          selector: 'node.svc',
          style: {
            'background-color': '#58a6ff',
            'shape': 'roundrectangle',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#e6edf3',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'width': 16,
            'height': 16,
            'border-width': 0
          }
        },
        {
          selector: 'node.waypoint',
          style: {
            'background-color': '#d29922',
            'shape': 'diamond',
            'label': 'data(label)',
            'font-size': '9px',
            'color': '#e6edf3',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'width': 22,
            'height': 22,
            'border-width': 0
          }
        },
        {
          selector: 'node.idle',
          style: { 'opacity': 0.5 }
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#30363d',
            'target-arrow-color': '#30363d',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.6
          }
        },
        {
          selector: 'edge.active',
          style: {
            'line-color': '#3fb950',
            'target-arrow-color': '#3fb950',
            'width': 2
          }
        },
        {
          selector: 'edge.error',
          style: {
            'line-color': '#f85149',
            'target-arrow-color': '#f85149',
            'width': 2
          }
        },
        {
          selector: 'edge.idle',
          style: {
            'line-style': 'dashed',
            'opacity': 0.4
          }
        }
      ],
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false
    });

    var nodeCount = elements.nodes.filter(function(n) { return !n.classes || n.classes.indexOf('ns-group') === -1; }).length;
    var edgeCount = elements.edges.length;
    var activeEdges = elements.edges.filter(function(e) { return e.classes && e.classes.indexOf('active') !== -1; }).length;
    if (statusEl) statusEl.textContent = nodeCount + ' nodes, ' + edgeCount + ' edges (' + activeEdges + ' active)';

  } catch (e) {
    if (statusEl) statusEl.textContent = 'error: ' + e.message;
  }
}

// --- Init ---

window.addEventListener('DOMContentLoaded', function() {
  loadConfig();
  refreshStatus();
  refreshAudit();
  refreshTopology();
});

setInterval(refreshStatus, 5000);
setInterval(function() {
  if (document.getElementById('audit-auto') && document.getElementById('audit-auto').checked) {
    refreshAudit();
  }
}, 5000);
setInterval(function() {
  if (document.getElementById('topo-auto') && document.getElementById('topo-auto').checked) {
    refreshTopology();
  }
}, 10000);

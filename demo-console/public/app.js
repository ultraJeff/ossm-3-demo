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
var MODELS_NS_FRONTEND = 'ossm-ai-models';

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

  // Build lookup maps
  var nodeById = {};
  elements.nodes.forEach(function(n) { nodeById[n.data.id] = n.data; });
  var existingEdges = {};
  elements.edges.forEach(function(e) { existingEdges[e.data.source + '->' + e.data.target] = true; });

  var edgeCounter = 0;
  function addStructEdge(srcId, tgtId) {
    var key = srcId + '->' + tgtId;
    if (existingEdges[key]) return;
    elements.edges.push({ data: { id: 'struct-' + (edgeCounter++), source: srcId, target: tgtId }, classes: 'structural' });
    existingEdges[key] = true;
  }

  // Add structural edges: service → workload (strict: same namespace, same app label)
  var services = elements.nodes.filter(function(n) { return n.data.nodeType === 'service'; });
  var workloads = elements.nodes.filter(function(n) { return n.data.nodeType === 'workload'; });

  services.forEach(function(svc) {
    var svcName = svc.data.service || '';
    if (svcName.indexOf('waypoint') !== -1) return;
    if (svcName.indexOf('-metrics') !== -1) return;
    workloads.forEach(function(wl) {
      if (svc.data.namespace !== wl.data.namespace) return;
      if (isWaypoint(wl)) return;
      var wlApp = wl.data.app || '';
      var wlName = wl.data.workload || '';
      // Skip when service and workload have the same name (looks like a self-loop)
      if (svcName === wlName) return;
      if (wlApp && wlApp === svcName) {
        addStructEdge(svc.data.id, wl.data.id);
      }
    });
  });

  // Add structural edges: waypoint → app workloads/services in same namespace
  var waypointNodes = elements.nodes.filter(function(n) { return isWaypoint(n) && n.data.nodeType === 'workload'; });
  waypointNodes.forEach(function(wp) {
    // Connect to services that still exist
    services.forEach(function(svc) {
      if (svc.data.namespace !== wp.data.namespace) return;
      var svcName = svc.data.service || '';
      if (svcName.indexOf('waypoint') !== -1) return;
      if (svcName.indexOf('-metrics') !== -1) return;
      addStructEdge(wp.data.id, svc.data.id);
    });
    // Connect to workloads that have no corresponding service node
    workloads.forEach(function(wl) {
      if (wl.data.namespace !== wp.data.namespace) return;
      if (isWaypoint(wl)) return;
      var wlName = wl.data.workload || '';
      if (wlName.indexOf('traffic-generator') !== -1) return;
      if (wlName === 'test-client') return;
      // Check if there's already a service node for this workload
      var hasService = services.some(function(s) { return s.data.namespace === wl.data.namespace && s.data.service === wl.data.app; });
      if (!hasService) {
        addStructEdge(wp.data.id, wl.data.id);
      }
    });
  });

  // Add structural edges: ingress gateway workloads → waypoints in target namespaces
  var gatewayTargets = {
    'bookinfo-gateway-istio': 'ossm-bookinfo',
    'restapi-gateway-istio': 'ossm-restapi',
    'mesh-gateway-istio': 'ossm-ai-models',
  };
  workloads.forEach(function(gw) {
    var wlName = gw.data.workload || '';
    var targetNs = gatewayTargets[wlName];
    if (!targetNs) return;
    var waypoint = elements.nodes.find(function(n) {
      return n.data.namespace === targetNs && isWaypoint(n) && n.data.nodeType === 'workload';
    });
    if (waypoint) {
      addStructEdge(gw.data.id, waypoint.data.id);
    }
  });

  // Add synthetic nodes for non-mesh gateways (RHOAI, MaaS)
  elements.nodes.push({
    data: { id: 'syn-rhoai-gw', label: 'data-science-gateway', namespace: 'openshift-ingress', nodeType: 'workload' },
    classes: 'external-gateway'
  });
  elements.nodes.push({
    data: { id: 'syn-rhoai-ns', label: 'openshift-ingress', nodeType: 'group' },
    classes: 'ns-group'
  });
  elements.nodes.forEach(function(n) {
    if (n.data.id === 'syn-rhoai-gw') n.data.parent = 'syn-rhoai-ns';
  });

  // Connect RHOAI gateway to AI model workloads
  workloads.forEach(function(wl) {
    var wlName = wl.data.workload || '';
    if (wl.data.namespace === MODELS_NS_FRONTEND && (wlName.indexOf('predictor') !== -1)) {
      addStructEdge('syn-rhoai-gw', wl.data.id);
    }
  });

  // Add MaaS gateway if llm namespace is enrolled
  var llmNodes = elements.nodes.filter(function(n) { return n.data.namespace === 'llm'; });
  if (llmNodes.length > 0) {
    elements.nodes.push({
      data: { id: 'syn-maas-gw', label: 'maas-default-gateway', namespace: 'openshift-ingress', nodeType: 'workload' },
      classes: 'external-gateway'
    });
    elements.nodes.forEach(function(n) {
      if (n.data.id === 'syn-maas-gw') n.data.parent = 'syn-rhoai-ns';
    });
    llmNodes.forEach(function(n) {
      if (n.data.nodeType === 'workload' && !isWaypoint(n)) {
        addStructEdge('syn-maas-gw', n.data.id);
      }
    });
  }

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

    // Filter out monitoring noise
    data.elements.nodes = data.elements.nodes.filter(function(n) {
      var ns = n.data.namespace || '';
      var svc = n.data.service || '';
      var wl = n.data.workload || '';
      // Remove prometheus/monitoring namespaces
      if (ns === 'openshift-user-workload-monitoring') return false;
      if (ns === 'istio-system') return false;
      // Filter legacy ingress gateway
      if (wl === 'istio-ingressgateway') return false;
      // Filter Kiali-returned MaaS gateway (we add a synthetic one)
      if (wl && wl.indexOf('maas-default-gateway') !== -1) return false;
      // Remove metrics services
      if (svc.indexOf('-metrics') !== -1) return false;
      // Remove service nodes from istio-ingress (duplicates of workload nodes)
      if (ns === 'istio-ingress' && n.data.nodeType === 'service') return false;
      // Remove service nodes from istio-system (keep workloads only)
      if (ns === 'istio-system' && n.data.nodeType === 'service') return false;
      // Remove waypoint service nodes (the diamond workload node represents them)
      if (n.data.nodeType === 'service' && svc.indexOf('waypoint') !== -1) return false;
      // Remove service nodes that duplicate a workload (same name or service is workload+suffix)
      if (n.data.nodeType === 'service') {
        var hasSameNameWorkload = data.elements.nodes.some(function(other) {
          if (other.data.nodeType !== 'workload' || other.data.namespace !== ns) return false;
          var owlName = other.data.workload || '';
          return owlName === svc || svc.indexOf(owlName) === 0;
        });
        if (hasSameNameWorkload) return false;
      }
      return true;
    });
    var keepIds = {};
    data.elements.nodes.forEach(function(n) { keepIds[n.data.id] = true; });
    data.elements.edges = data.elements.edges.filter(function(e) {
      return keepIds[e.data.source] && keepIds[e.data.target];
    });

    var elements = addNamespaceGroups(data.elements);
    var container = document.getElementById('topology-graph');
    if (!container) return;

    // Determine node classes
    elements.nodes.forEach(function(n) {
      if (n.classes) return;
      var classes = [];
      if (n.data.nodeType === 'service') classes.push('svc');
      else if (n.data.workload && n.data.workload.indexOf('-gateway-') !== -1) classes.push('gateway');
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

    if (typeof cytoscape === 'undefined') {
      if (statusEl) statusEl.textContent = 'cytoscape not loaded';
      return;
    }

    if (topoInstance) {
      // Update existing graph without re-laying out
      var existingIds = {};
      topoInstance.nodes().forEach(function(n) { existingIds[n.id()] = true; });
      // Add new nodes
      elements.nodes.forEach(function(n) {
        if (!existingIds[n.data.id]) topoInstance.add(n);
      });
      // Remove nodes that no longer exist
      var newIds = {};
      elements.nodes.forEach(function(n) { newIds[n.data.id] = true; });
      topoInstance.nodes().forEach(function(n) {
        if (!newIds[n.id()]) topoInstance.remove(n);
      });
      // Update edges
      topoInstance.edges().remove();
      elements.edges.forEach(function(e) { topoInstance.add(e); });

      var nodeCount = elements.nodes.filter(function(n) { return !n.classes || n.classes.indexOf('ns-group') === -1; }).length;
      var edgeCount = elements.edges.length;
      if (statusEl) statusEl.textContent = nodeCount + ' nodes, ' + edgeCount + ' edges (updated)';
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
        rankDir: 'TB',
        nodeSep: 40,
        rankSep: 80,
        padding: 30,
        spacingFactor: 1.3
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
          selector: 'node.gateway',
          style: {
            'background-color': '#bc8cff',
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
          selector: 'node.external-gateway',
          style: {
            'background-color': '#f85149',
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
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#484f58',
            'target-arrow-color': '#484f58',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.7
          }
        },
        {
          selector: 'edge.active',
          style: {
            'line-color': '#3fb950',
            'target-arrow-color': '#3fb950',
            'width': 3
          }
        },
        {
          selector: 'edge.error',
          style: {
            'line-color': '#f85149',
            'target-arrow-color': '#f85149',
            'width': 3
          }
        },
        {
          selector: 'edge.idle',
          style: {
            'line-style': 'dashed',
            'opacity': 0.5
          }
        },
        {
          selector: 'edge.structural',
          style: {
            'line-color': '#484f58',
            'target-arrow-color': '#484f58',
            'line-style': 'solid',
            'width': 2,
            'opacity': 0.7
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

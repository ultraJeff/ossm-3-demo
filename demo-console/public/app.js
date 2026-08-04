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

// --- Init ---

window.addEventListener('DOMContentLoaded', function() {
  loadConfig();
  refreshStatus();
  refreshAudit();
});

setInterval(refreshStatus, 5000);
setInterval(function() {
  if (document.getElementById('audit-auto') && document.getElementById('audit-auto').checked) {
    refreshAudit();
  }
}, 5000);

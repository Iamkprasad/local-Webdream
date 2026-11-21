/* Local Dream — static UI, no framework. */
(function () {
  'use strict';

  var HISTORY_KEY = 'localdream-image-history';
  var PARAMS_KEY = 'localdream-image-params';
  var DEFAULTS = {
    width: 256, height: 256, method: 'dpm++2m',
    steps: 10, cfg: 7.5, batch: 1, seed: -1
  };
  var METHOD_LABELS = {
    'dpm++2m': 'DPM++ 2M', 'euler_a': 'Euler A', 'euler': 'Euler',
    'heun': 'Heun', 'dpm++2m_sde': 'DPM++ 2M SDE', 'lcm': 'LCM',
    'ddim_trailing': 'DDIM'
  };
  var state = {
    engine: {}, busy: false, loading: null,
    startedAt: 0, loadingAt: 0,
    params: readParams(), pendingSize: null
  };

  function byId(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }
  function fmt(n) { return n === null || n === undefined ? '?' : Number(n).toLocaleString(); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function readParams() {
    try {
      var saved = JSON.parse(localStorage.getItem(PARAMS_KEY) || 'null');
      if (saved && saved.width && saved.height) {
        return Object.assign({}, DEFAULTS, saved);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }
  function say(text, bad) {
    var node = byId('message');
    node.textContent = text || '';
    node.className = 'message' + (bad ? ' bad' : '');
  }
  function setStatus(text, mode) {
    var node = byId('status-detail');
    node.textContent = text || '';
    node.className = 'status-detail' + (mode ? ' ' + mode : '');
  }
  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().then(function (body) {
        if (!body || body.success === false) {
          throw new Error((body && body.error) || 'HTTP ' + res.status);
        }
        return body.data;
      });
    });
  }
  function get(path) { return api(path, { credentials: 'same-origin' }); }
  function post(path, body) {
    return api(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  function switchTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
    }
    var views = document.querySelectorAll('.view');
    for (var j = 0; j < views.length; j++) {
      views[j].classList.toggle('active', views[j].id === 'view-' + name);
    }
  }

  function renderCapacity(data) {
    var node = byId('capacity');
    node.textContent = '';
    var c = data.capacity || {};
    var low = c.free_mb !== null && c.free_mb !== undefined && c.free_mb < 1800;
    var line = el('div', '');
    line.appendChild(el('i', 'dot' + (low ? ' low' : '')));
    line.appendChild(document.createTextNode(' RAM free '));
    line.appendChild(el('b', '', fmt(c.free_mb) + ' MB'));
    line.appendChild(document.createTextNode(' / ' + fmt(c.total_mb) + ' MB total'));
    node.appendChild(line);
    var resident = null;
    (data.models || []).forEach(function (m) {
      if (m.status === 'loaded') { resident = m; }
    });
    node.appendChild(el('div', low ? 'low' : '',
      resident
        ? ('Loaded: ' + resident.name + ' · needs ≥' + fmt(resident.min_ram_mb) + ' MB free')
        : (low ? 'Low RAM — use a smaller model or close other apps.'
               : 'Load a model to start generating.')));
  }

  function loadModel(m) {
    state.loading = m.name;
    state.loadingAt = Date.now();
    setStatus('Loading ' + m.name + '…', 'busy');
    say('Starting the engine and loading weights — this can take up to 90s.');
    post('/api/load', { id: m.id }).then(function () {
      state.loading = null;
      state.params.width = m.size;
      state.params.height = m.size;
      state.params.steps = m.steps;
      saveParams();
      syncSettings();
      say(m.name + ' ready.');
      refresh();
    }).catch(function (e) {
      state.loading = null;
      say(e.message, true);
      refresh();
    });
  }

  function renderModels(data) {
    var list = byId('models');
    list.textContent = '';
    (data.models || []).forEach(function (m) {
      var card = el('div', 'model');
      var head = el('div', 'model-head');
      head.appendChild(el('span', 'model-name', m.name));
      head.appendChild(el('span', 'badge-cpu', 'CPU'));
      head.appendChild(el('span', 'chip ' + (
        m.status === 'loaded' ? 'loaded' :
        (m.installed ? 'installed' : '')), cap(m.status.replace('_', ' '))));
      card.appendChild(head);
      card.appendChild(el('p', 'model-meta',
        '~' + fmt(m.size_mb) + ' MB · needs ≥' + fmt(m.min_ram_mb) + ' MB free · ' +
        m.license + ' · ' + m.notes));
      var actions = el('div', 'model-actions');
      if (!m.installed) {
        var dl = el('button', 'primary', 'Download');
        dl.type = 'button';
        dl.addEventListener('click', function () {
          post('/api/download', { id: m.id }).then(function (r) {
            say(r.status === 'started' ? 'Downloading ' + m.name + '…' : cap(r.status));
            pollDownload();
          }).catch(function (e) { say(e.message, true); });
        });
        actions.appendChild(dl);
      } else if (m.status === 'loaded') {
        var off = el('button', '', 'Unload');
        off.type = 'button';
        off.addEventListener('click', function () {
          post('/api/unload', { id: m.id }).then(function () {
            say('Engine unloaded.'); refresh();
          }).catch(function (e) { say(e.message, true); });
        });
        actions.appendChild(off);
      } else {
        var on = el('button', 'primary', 'Load');
        on.type = 'button';
        on.addEventListener('click', function () { loadModel(m); });
        actions.appendChild(on);
      }
      var link = el('a', '', 'Model page ↗');
      link.href = m.source; link.target = '_blank';
      link.rel = 'noopener noreferrer';
      actions.appendChild(link);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  function refresh() {
    return get('/api/models').then(function (data) {
      state.engine = data.engine || {};
      renderModels(data);
      renderCapacity(data);
      var running = !!state.engine.running;
      var pill = byId('engine');
      pill.textContent = running ? 'Engine online' : 'Engine offline';
      pill.className = 'pill' + (running ? ' on' : '');
      byId('go').disabled = !running || state.busy || !!state.loading;
      byId('cancel').disabled = !state.busy;
      if (!state.busy && !state.loading) {
        setStatus(running
          ? ('Model ready · ' + (state.engine.loaded_id || 'unknown'))
          : 'Load a model to begin');
      }
    }).catch(function (e) { say(e.message, true); });
  }

  function pollDownload() {
    get('/api/download/status').then(function (d) {
      var node = byId('download');
      node.textContent = '';
      if (d.status === 'downloading') {
        node.appendChild(el('div', '', 'Downloading ' + fmt(d.downloaded_mb) + ' / ' +
          fmt(d.total_mb) + ' MB (' + (d.percent || 0) + '%)'));
        var track = el('div', 'track');
        track.appendChild(el('div', '', ''));
        track.firstChild.id = 'dl-bar';
        track.firstChild.style.width = (d.percent || 0) + '%';
        track.firstChild.style.height = '100%';
        track.firstChild.style.background = 'var(--accent)';
        node.appendChild(track);
        setStatus('Downloading model — ' + (d.percent || 0) + '%', 'busy');
      } else if (d.status === 'completed') {
        node.appendChild(el('div', '', 'Download complete.'));
        say('Download complete — tap Load on the model.');
        setStatus('Download complete');
        refresh();
      } else if (d.status === 'error') {
        node.appendChild(el('div', '', 'Download failed: ' + d.error));
        say('Download failed: ' + d.error, true);
      } else {
        node.hidden = true;
        return;
      }
      node.hidden = false;
    }).catch(function () {});
  }

  function saveParams() {
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(state.params)); } catch (e) {}
  }
  function methodLabel(value) { return METHOD_LABELS[value] || value || '-'; }
  function renderParamSummary() {
    var p = state.params;
    byId('param-summary').textContent =
      p.width + '×' + p.height + ' · ' + methodLabel(p.method) + ' · ' +
      p.steps + ' steps · CFG ' + p.cfg + ' · batch ' + p.batch + ' · ' +
      (p.seed === -1 ? 'random seed' : 'seed ' + p.seed);
  }
  function syncSettings() {
    var p = state.params;
    byId('method').value = p.method;
    byId('steps').value = p.steps;
    byId('cfg').value = p.cfg;
    byId('batch').value = p.batch;
    byId('seed').value = p.seed;
    byId('steps-val').textContent = p.steps;
    byId('cfg-val').textContent = p.cfg;
    byId('batch-val').textContent = p.batch;
    var chips = document.querySelectorAll('#res-chips button');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('selected',
        Number(chips[i].getAttribute('data-w')) === p.width &&
        Number(chips[i].getAttribute('data-h')) === p.height);
    }
    renderParamSummary();
  }
  function openSettings(which) {
    state.pendingSize = null;
    syncSettings();
    byId(which).hidden = false;
  }
  function closeSettings(which) { byId(which).hidden = true; }

  function history() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30))); }
    catch (e) {}
  }
  function paramLine(item) {
    var p = item.params || {};
    return 'steps: ' + (p.steps || '-') + ' / CFG: ' + (p.cfg || '-') +
      ' / seed: ' + (p.seed === undefined ? '-' : p.seed) +
      ' / size: ' + (p.width || '-') + '×' + (p.height || '-') +
      ' / time: ' + Math.round((item.ms || 0) / 1000) + 's' +
      ' / ' + methodLabel(p.method);
  }
  function makeCard(item) {
    var card = el('div', 'card-image');
    var img = el('img');
    img.src = item.path; img.alt = 'generated image'; img.loading = 'lazy';
    card.appendChild(img);
    var body = el('div', 'card-body');
    var box = el('div', 'params-box');
    box.appendChild(el('b', '', 'Prompt: '));
    box.appendChild(document.createTextNode((item.params && item.params.prompt) || ''));
    box.appendChild(el('br'));
    box.appendChild(document.createTextNode(paramLine(item)));
    body.appendChild(box);
    var actions = el('div', 'card-actions');
    var save = el('a', '', 'Save PNG');
    save.href = item.path;
    save.download = (item.id || 'image') + '.png';
    actions.appendChild(save);
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }
  function renderCards() {
    var items = history();
    [['result-list', 'No images yet. Generate one from the Prompt tab.'],
     ['history-list', 'No generations yet.']].forEach(function (pair) {
      var node = byId(pair[0]);
      node.textContent = '';
      if (!items.length) { node.appendChild(el('p', 'muted', pair[1])); return; }
      items.forEach(function (item) { node.appendChild(makeCard(item)); });
    });
    byId('result-count').textContent = items.length ? items.length + ' image(s)' : '';
  }

  function generate() {
    var prompt = byId('prompt').value.trim();
    if (!prompt) { say('Enter a prompt first.', true); return; }
    var p = state.params;
    var body = {
      prompt: prompt,
      negative_prompt: byId('negative').value,
      width: p.width, height: p.height, steps: p.steps,
      cfg: p.cfg, method: p.method, batch: p.batch, seed: p.seed
    };
    state.busy = true;
    state.startedAt = Date.now();
    byId('go').disabled = true;
    byId('cancel').disabled = false;
    byId('progress').hidden = false;
    byId('bar').style.width = '0%';
    byId('stage').textContent = 'starting';
    byId('steps-label').textContent = '';
    byId('elapsed').textContent = '0s elapsed';
    setStatus('Generating — starting up', 'busy');
    say('');

    fetch('/api/generate', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok || !res.body) { throw new Error('HTTP ' + res.status); }
      var reader = res.body.getReader(), decoder = new TextDecoder(), buffer = '';
      function pump() {
        return reader.read().then(function (out) {
          if (out.done) { return; }
          buffer += decoder.decode(out.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(function (line) {
            var ev;
            try { ev = JSON.parse(line.trim()); } catch (e) { return; }
            if (ev.t === 'progress') {
              byId('stage').textContent = cap((ev.stage || 'working').replace('_', ' '));
              if (typeof ev.completed === 'number' && typeof ev.total === 'number' && ev.total) {
                byId('bar').style.width =
                  Math.min(100, Math.round(ev.completed * 100 / ev.total)) + '%';
                byId('steps-label').textContent = ev.completed + ' / ' + ev.total + ' steps';
                setStatus('Generating — step ' + ev.completed + ' of ' + ev.total, 'busy');
              }
            } else if (ev.t === 'done') {
              byId('bar').style.width = '100%';
              var images = ev.images || (ev.path ? [{ id: ev.id, path: ev.path }] : []);
              var all = history();
              images.forEach(function (image) {
                all.unshift({
                  id: image.id, path: image.path,
                  ms: ev.ms || 0, params: ev.params || body,
                  time: Date.now()
                });
              });
              saveHistory(all);
              renderCards();
              byId('progress').hidden = true;
              switchTab('result');
              say('Done in ' + Math.round((ev.ms || 0) / 1000) + 's.');
              setStatus('Ready — ' + images.length + ' image(s) generated');
            } else if (ev.t === 'error') {
              say(ev.e || 'Generation failed.', true);
              setStatus('Generation failed', 'warn');
            }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      say(e.message, true);
      setStatus('Generation failed', 'warn');
    }).then(function () {
      state.busy = false;
      byId('cancel').disabled = true;
      refresh();
    });
  }

  byId('go').addEventListener('click', generate);
  byId('cancel').addEventListener('click', function () {
    post('/api/cancel', {}).then(function () {
      say('Cancel requested — stopping after the current step.');
    }).catch(function (e) { say(e.message, true); });
  });
  byId('refresh-btn').addEventListener('click', function () { refresh(); pollDownload(); });
  byId('advanced-btn').addEventListener('click', function () { openSettings('settings-modal'); });
  byId('settings-btn').addEventListener('click', function () { openSettings('settings-modal'); });
  byId('info-btn').addEventListener('click', function () { openSettings('info-modal'); });
  byId('close-info').addEventListener('click', function () { closeSettings('info-modal'); });
  byId('confirm-settings').addEventListener('click', function () {
    if (state.pendingSize) {
      state.params.width = state.pendingSize.w;
      state.params.height = state.pendingSize.h;
    }
    state.params.method = byId('method').value;
    state.params.steps = parseInt(byId('steps').value, 10);
    state.params.cfg = parseFloat(byId('cfg').value);
    state.params.batch = parseInt(byId('batch').value, 10);
    state.params.seed = parseInt(byId('seed').value, 10);
    if (isNaN(state.params.seed)) { state.params.seed = -1; }
    saveParams();
    syncSettings();
    closeSettings('settings-modal');
    say('Settings saved.');
  });
  byId('cancel-settings').addEventListener('click', function () {
    closeSettings('settings-modal');
  });
  byId('settings-modal').addEventListener('click', function (e) {
    if (e.target === byId('settings-modal')) { closeSettings('settings-modal'); }
  });
  byId('info-modal').addEventListener('click', function (e) {
    if (e.target === byId('info-modal')) { closeSettings('info-modal'); }
  });
  byId('reset-settings').addEventListener('click', function () {
    state.params = Object.assign({}, DEFAULTS);
    state.pendingSize = null;
    saveParams(); syncSettings();
  });
  byId('res-chips').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-w]');
    if (!btn) { return; }
    state.pendingSize = {
      w: Number(btn.getAttribute('data-w')),
      h: Number(btn.getAttribute('data-h'))
    };
    var chips = document.querySelectorAll('#res-chips button');
    for (var i = 0; i < chips.length; i++) { chips[i].classList.remove('selected'); }
    btn.classList.add('selected');
  });
  ['steps', 'cfg', 'batch'].forEach(function (id) {
    byId(id).addEventListener('input', function () {
      byId(id + '-val').textContent = byId(id).value;
    });
  });
  document.getElementById('tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) { switchTab(tab.getAttribute('data-tab')); }
  });
  byId('clear-history').addEventListener('click', function () {
    saveHistory([]); renderCards(); say('History cleared.');
  });

  setInterval(function () {
    if (state.busy && state.startedAt) {
      byId('elapsed').textContent =
        Math.floor((Date.now() - state.startedAt) / 1000) + 's elapsed';
    }
    if (state.loading && state.loadingAt) {
      setStatus('Loading ' + state.loading + '… ' +
        Math.floor((Date.now() - state.loadingAt) / 1000) +
        's (engine may take up to 90s)', 'busy');
    }
  }, 1000);

  syncSettings();
  renderCards();
  refresh();
  pollDownload();
  setInterval(refresh, 8000);
  setInterval(pollDownload, 3000);
})();

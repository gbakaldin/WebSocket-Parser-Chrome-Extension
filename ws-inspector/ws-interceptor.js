(function () {
  'use strict';

  // Per-site configs injected by config.js before this script runs.
  const _configs = Array.isArray(window.__WSI_CONFIG__) ? window.__WSI_CONFIG__ : [];

  // Config is resolved once against the page hostname, not the WS server hostname.
  const _pageHostname = window.location.hostname;
  const _pageCfg = _configs.find(c => _pageHostname.includes(c.website)) ?? null;

  const _keyCache = new Map(); // b64 key string -> CryptoKey

  function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  async function getKey(keyB64) {
    if (_keyCache.has(keyB64)) return _keyCache.get(keyB64);
    const key = await crypto.subtle.importKey(
      'raw', b64ToBytes(keyB64), { name: 'AES-CBC' }, false, ['decrypt']
    );
    _keyCache.set(keyB64, key);
    return key;
  }

  async function tryDecrypt(data) {
    const cfg = _pageCfg;

    if (!cfg) {
      if (typeof data === 'string')        return data;
      if (data instanceof Blob)            return await data.text();
      if (data instanceof ArrayBuffer)     return new TextDecoder('utf-8').decode(data);
      return null;
    }

    // Config present — attempt AES-CBC decryption.
    let buf;
    if (data instanceof ArrayBuffer) {
      buf = data;
    } else if (data instanceof Blob) {
      buf = await data.arrayBuffer();
    } else if (typeof data === 'string') {
      return data;
    } else {
      return null;
    }

    try {
      const key = await getKey(cfg.key);
      const iv  = b64ToBytes(cfg.iv);
      const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, buf);
      return new TextDecoder('utf-8').decode(plain);
    } catch (err) {
      console.error('[WSI] decrypt failed:', err.message);
      return null;
    }
  }

  function deepFindCmd(val) {
    if (val == null || typeof val !== 'object') return null;
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = deepFindCmd(item);
        if (found !== null) return found;
      }
      return null;
    }
    const raw = val.cmd ?? val.c;
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    }
    for (const v of Object.values(val)) {
      const found = deepFindCmd(v);
      if (found !== null) return found;
    }
    return null;
  }

  function buildRecord(direction, url, raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const cmd = deepFindCmd(parsed);
    return {
      id: crypto.randomUUID(),
      ts: Date.now(),
      direction,
      url,
      raw,
      parsed,
      cmd,
      preview: raw.slice(0, 120),
    };
  }

  function emit(type, payload) {
    window.postMessage({ type: 'WS_INSPECTOR_' + type, payload }, '*');
  }

  // ---- window.innerHeight / innerWidth proxy ----
  const _realH = window.innerHeight;
  const _realW = window.innerWidth;
  let _availH  = _realH;
  let _availW  = _realW;

  Object.defineProperty(window, 'innerHeight', { get: () => _availH, configurable: true });
  Object.defineProperty(window, 'innerWidth',  { get: () => _availW, configurable: true });

  window.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'WS_INSPECTOR_RESIZE') return;
    _availH = typeof e.data.height === 'number' ? e.data.height : _realH;
    _availW = typeof e.data.width  === 'number' ? e.data.width  : _realW;
    window.dispatchEvent(new Event('resize'));
  });

  const OrigWS = window.WebSocket;

  function PatchedWebSocket(url, protocols) {
    const ws = protocols != null ? new OrigWS(url, protocols) : new OrigWS(url);

    emit('OPEN', { url: ws.url });

    ws.addEventListener('message', async (event) => {
      const raw = await tryDecrypt(event.data);
      if (raw == null) return;
      const record = buildRecord('server', ws.url, raw);
      if (record) emit('MESSAGE', record);
    });

    ws.addEventListener('close', () => emit('CLOSE', { url: ws.url }));

    const origSend = ws.send.bind(ws);
    ws.send = function (data) {
      origSend(data);
      Promise.resolve().then(async () => {
        const raw = await tryDecrypt(data);
        if (raw == null) return;
        const record = buildRecord('client', ws.url, raw);
        if (record) emit('MESSAGE', record);
      });
    };

    return ws;
  }

  PatchedWebSocket.prototype = OrigWS.prototype;
  PatchedWebSocket.CONNECTING = OrigWS.CONNECTING;
  PatchedWebSocket.OPEN       = OrigWS.OPEN;
  PatchedWebSocket.CLOSING    = OrigWS.CLOSING;
  PatchedWebSocket.CLOSED     = OrigWS.CLOSED;

  window.WebSocket = PatchedWebSocket;
})();

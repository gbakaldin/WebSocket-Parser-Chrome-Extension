(function () {
  'use strict';

  // ---- State ----
  const msgs = [];
  const msgMap = new Map();  // id -> record
  const tabs = new Map();    // url -> { filter }
  let activeTab = null;
  let selectedId = null;
  const filter = { dir: 'all', cmd: '', text: '', hideHb: false, cmdRangeMode: false, rx: false };
  let atBottom = true;
  let visible = true;
  let dockMode = 'right';    // 'top' | 'bottom' | 'left' | 'right' | 'float'
  let floatW = null, floatH = null;
  let floatX = null, floatY = null;
  // Saved pixel sizes per docked mode (null = use CSS default).
  let dockedSizes = { top: null, bottom: null, left: null, right: null };
  let sheetH = null;   // null = use CSS 50% default

  // ---- DOM refs ----
  let $root, $pageWrap, $panel, $showBtn, $tabsEl, $dirBtn, $cmdInput, $textInput;
  let $list, $sheet, $sheetResize, $sheetMeta, $sheetCode, $copyBtn, $modeMenu, $resizeHandle;
  let $floatResizeS, $floatResizeE, $floatResizeSE;

  // ---- Build UI ----

  function buildUI() {
    // Wrap all existing body children so they become a flex sibling of our panel.
    // Snapshot first to avoid live-collection weirdness during the move.
    $pageWrap = document.createElement('div');
    $pageWrap.id = 'wsi-page-wrap';
    const existing = [...document.body.childNodes];
    existing.forEach(n => $pageWrap.appendChild(n));

    $root = document.createElement('div');
    $root.id = 'wsi-root';
    $root.innerHTML = `
      <div id="wsi-show-btn" title="Show WS Inspector (Alt+W)">WS</div>
      <div id="wsi-resize-handle"></div>
      <div id="wsi-float-resize-s" hidden></div>
      <div id="wsi-float-resize-e" hidden></div>
      <div id="wsi-float-resize-se" hidden></div>
      <div id="wsi-panel">
        <div id="wsi-topbar">
          <div id="wsi-tabs"></div>
          <div id="wsi-topbar-actions">
            <div id="wsi-mode-wrap">
              <button id="wsi-mode-btn" title="Panel position">▼</button>
              <div id="wsi-mode-menu" hidden>
                <button data-mode="top">▲ Top</button>
                <button data-mode="bottom">▼ Bottom</button>
                <button data-mode="left">◀ Left</button>
                <button data-mode="right">▶ Right</button>
                <button data-mode="float">⊡ Float</button>
              </div>
            </div>
            <button id="wsi-clear-btn">Clear</button>
            <button id="wsi-hide-btn" title="Alt+W">Hide</button>
          </div>
        </div>
        <div id="wsi-filterbar">
          <button id="wsi-dir-btn" data-dir="all">All</button>
          <input id="wsi-cmd-input"  type="text" placeholder="CMD  e.g. 1,5,42" spellcheck="false" autocomplete="off">
          <button id="wsi-cmd-range-btn" title="Range mode: match A ≤ cmd &lt; B  (enter as  A, B)">↔</button>
          <input id="wsi-text-input" type="text" placeholder="Search…"           spellcheck="false" autocomplete="off">
          <button id="wsi-rx-btn" title="Regex mode (JS RegExp, case-sensitive). Matches the raw wire JSON, which is compact — no space after a colon, so use \s* :  &quot;cmd&quot;:\s*14\d\d">.*</button>
          <label id="wsi-hb-label"><input id="wsi-hb-chk" type="checkbox"> Hide HB</label>
        </div>
        <div id="wsi-list"></div>
        <div id="wsi-sheet" hidden>
          <div id="wsi-sheet-resize"></div>
          <div id="wsi-sheet-header">
            <span id="wsi-sheet-meta"></span>
            <button id="wsi-copy-btn">Copy</button>
            <button id="wsi-sheet-close">×</button>
          </div>
          <div id="wsi-sheet-body">
            <pre><code id="wsi-sheet-code" class="language-json"></code></pre>
          </div>
        </div>
      </div>
    `;

    // Make body a flex column: page content on top, our panel pinned below.
    document.body.style.display       = 'flex';
    document.body.style.flexDirection = 'column';
    document.body.style.height        = '100vh';
    document.body.style.margin        = '0';
    document.body.style.padding       = '0';
    document.body.style.overflow      = 'hidden';
    document.body.appendChild($pageWrap);
    document.body.appendChild($root);

    // Keep the wrapper as the target for anything the page appends to body later.
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node !== $root && node !== $pageWrap) {
            $pageWrap.appendChild(node);
          }
        }
      }
    });
    obs.observe(document.body, { childList: true });

    $panel      = $root.querySelector('#wsi-panel');
    $showBtn    = $root.querySelector('#wsi-show-btn');
    $tabsEl     = $root.querySelector('#wsi-tabs');
    $dirBtn     = $root.querySelector('#wsi-dir-btn');
    $cmdInput   = $root.querySelector('#wsi-cmd-input');
    $textInput  = $root.querySelector('#wsi-text-input');
    $list       = $root.querySelector('#wsi-list');
    $sheet      = $root.querySelector('#wsi-sheet');
    $sheetResize = $root.querySelector('#wsi-sheet-resize');
    $sheetMeta  = $root.querySelector('#wsi-sheet-meta');
    $sheetCode  = $root.querySelector('#wsi-sheet-code');
    $copyBtn    = $root.querySelector('#wsi-copy-btn');
    $modeMenu       = $root.querySelector('#wsi-mode-menu');
    $resizeHandle   = $root.querySelector('#wsi-resize-handle');
    $floatResizeS   = $root.querySelector('#wsi-float-resize-s');
    $floatResizeE   = $root.querySelector('#wsi-float-resize-e');
    $floatResizeSE  = $root.querySelector('#wsi-float-resize-se');

    $dirBtn.addEventListener('click', cycleDir);
    $cmdInput.addEventListener('input', applyFilters);
    $textInput.addEventListener('input', applyFilters);
    $root.querySelector('#wsi-cmd-range-btn').addEventListener('click', () => {
      filter.cmdRangeMode = !filter.cmdRangeMode;
      const btn = $root.querySelector('#wsi-cmd-range-btn');
      btn.classList.toggle('active', filter.cmdRangeMode);
      $cmdInput.placeholder = filter.cmdRangeMode ? 'CMD range  e.g. 10, 50' : 'CMD  e.g. 1,5,42';
      applyFilters();
    });
    $root.querySelector('#wsi-rx-btn').addEventListener('click', () => {
      filter.rx = !filter.rx;
      const btn = $root.querySelector('#wsi-rx-btn');
      btn.classList.toggle('active', filter.rx);
      $textInput.placeholder = filter.rx ? 'Search regex  e.g.  "cmd":\\s*14\\d\\d' : 'Search…';
      applyFilters();
    });
    $root.querySelector('#wsi-hb-chk').addEventListener('change', (e) => {
      filter.hideHb = e.target.checked;
      applyFilters();
    });
    $root.querySelector('#wsi-clear-btn').addEventListener('click', clearAll);
    $root.querySelector('#wsi-hide-btn').addEventListener('click', () => setVisible(false));
    $root.querySelector('#wsi-sheet-close').addEventListener('click', closeSheet);
    $copyBtn.addEventListener('click', copySheet);
    $showBtn.addEventListener('click', () => setVisible(true));

    $root.querySelector('#wsi-mode-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $modeMenu.hidden = !$modeMenu.hidden;
    });
    for (const btn of $modeMenu.querySelectorAll('button[data-mode]')) {
      btn.addEventListener('click', () => applyDockMode(btn.dataset.mode));
    }
    document.addEventListener('click', () => { $modeMenu.hidden = true; });

    $list.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = $list;
      atBottom = scrollHeight - scrollTop - clientHeight < 4;
    });

    initResizeHandle();
    initFloatHandles();
    initFloatDrag();
    initSheetResize();
  }

  // ---- Visibility ----

  function setVisible(v) {
    visible = v;
    $panel.style.display   = v ? '' : 'none';
    $showBtn.style.display = v ? 'none' : '';
    if (v) {
      applyDockMode(dockMode);   // restores size and triggers resize
    } else {
      // Collapse root so page content reclaims the space it was occupying.
      if (dockMode === 'float') {
        // Fixed root has no layout impact; just let Cocos resize to the full pageWrap.
        requestAnimationFrame(resizeCocos);
      } else if (dockMode === 'left' || dockMode === 'right') {
        $root.style.flex  = '0 0 0';
        $root.style.width = '0';
        requestAnimationFrame(resizeCocos);
      } else {
        $root.style.flex   = '0 0 0';
        $root.style.height = '0';
        requestAnimationFrame(resizeCocos);
      }
    }
  }

  // ---- Dock mode ----

  const COCOS_W    = 1560;
  const COCOS_H    = 720;
  const PANEL_MAIN = '40vh';   // height for top / bottom
  const PANEL_SIDE = '360px';  // width  for left / right
  const MODE_ICONS = { bottom: '▼', top: '▲', left: '◀', right: '▶', float: '⊡' };

  function applyDockMode(mode) {
    dockMode = mode;
    $modeMenu.hidden = true;

    // Clear all inline overrides that vary by mode.
    Object.assign($root.style, {
      position: '', bottom: '', top: '', left: '', right: '',
      width: '', height: '', flex: '',
    });

    if (mode === 'float') {
      // Lazy-initialise float geometry on first switch to float.
      if (floatW === null) {
        const cw = document.documentElement.clientWidth;
        const ch = document.documentElement.clientHeight;
        floatW = Math.round(cw / 3);
        floatH = Math.round(ch / 3);
        floatX = cw - floatW - 20;   // 20px from right edge
        floatY = ch - floatH - 20;   // 20px from bottom edge
      }
      // Root is taken out of the flex flow with position:fixed, anchored top-left.
      Object.assign($root.style, {
        position: 'fixed',
        top: floatY + 'px', left: floatX + 'px',
        width: floatW + 'px', height: floatH + 'px',
      });
      document.body.style.flexDirection = 'column';
      $pageWrap.style.order = '';
      $root.style.order     = '';
      $root.classList.add('is-float');
    } else if (mode === 'bottom' || mode === 'top') {
      $root.classList.remove('is-float');
      document.body.style.flexDirection = 'column';
      const h = dockedSizes[mode] ? dockedSizes[mode] + 'px' : PANEL_MAIN;
      $root.style.height = h;
      $root.style.flex   = `0 0 ${h}`;
      $pageWrap.style.order = mode === 'bottom' ? '0' : '1';
      $root.style.order     = mode === 'bottom' ? '1' : '0';
    } else {                   // left | right
      $root.classList.remove('is-float');
      document.body.style.flexDirection = 'row';
      const w = dockedSizes[mode] ? dockedSizes[mode] + 'px' : PANEL_SIDE;
      $root.style.width  = w;
      $root.style.height = '100%';
      $root.style.flex   = `0 0 ${w}`;
      $pageWrap.style.order = mode === 'right' ? '0' : '1';
      $root.style.order     = mode === 'right' ? '1' : '0';
    }

    $root.querySelector('#wsi-mode-btn').textContent = MODE_ICONS[mode];
    updateResizeHandle();
    requestAnimationFrame(resizeCocos);
    saveState();
  }

  // ---- Resize handle ----

  function initResizeHandle() {
    let activePointerId = null;

    $resizeHandle.addEventListener('pointerdown', (e) => {
      if (dockMode === 'float') return;
      e.preventDefault();
      activePointerId = e.pointerId;
      $resizeHandle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    });

    $resizeHandle.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      const cw = document.documentElement.clientWidth;
      const ch = document.documentElement.clientHeight;
      let newSize;
      if      (dockMode === 'bottom') newSize = ch - e.clientY;
      else if (dockMode === 'top')    newSize = e.clientY;
      else if (dockMode === 'right')  newSize = cw - e.clientX;
      else                            newSize = e.clientX;  // left

      const horizontal = dockMode === 'left' || dockMode === 'right';
      const min = 120;
      const max = horizontal ? cw * 0.9 : ch * 0.9;
      newSize = Math.max(min, Math.min(max, newSize));

      if (horizontal) {
        $root.style.width = newSize + 'px';
        $root.style.flex  = `0 0 ${newSize}px`;
      } else {
        $root.style.height = newSize + 'px';
        $root.style.flex   = `0 0 ${newSize}px`;
      }
      dockedSizes[dockMode] = newSize;
    });

    $resizeHandle.addEventListener('pointerup', (e) => {
      if (e.pointerId !== activePointerId) return;
      $resizeHandle.releasePointerCapture(e.pointerId);
      activePointerId = null;
      document.body.style.userSelect = '';
      requestAnimationFrame(resizeCocos);
      saveState();
    });
  }

  function initFloatHandles() {
    function attachDrag(el, axis) {
      let activePointerId = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        activePointerId = e.pointerId;
        el.setPointerCapture(e.pointerId);
        document.body.style.userSelect = 'none';
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointerId) return;
        const cw = document.documentElement.clientWidth;
        const ch = document.documentElement.clientHeight;
        // Panel anchored at top-left (floatX, floatY); right/bottom edges follow cursor.
        if (axis === 'h' || axis === 'both') {
          floatW = Math.max(100, Math.min(Math.round(cw * 0.9), e.clientX - floatX));
          $root.style.width = floatW + 'px';
        }
        if (axis === 'v' || axis === 'both') {
          floatH = Math.max(70, Math.min(Math.round(ch * 0.9), e.clientY - floatY));
          $root.style.height = floatH + 'px';
        }
      });
      el.addEventListener('pointerup', (e) => {
        if (e.pointerId !== activePointerId) return;
        el.releasePointerCapture(e.pointerId);
        activePointerId = null;
        document.body.style.userSelect = '';
        requestAnimationFrame(resizeCocos);
        saveState();
      });
    }

    attachDrag($floatResizeS,  'v');    // bottom edge → height only
    attachDrag($floatResizeE,  'h');    // right edge  → width only
    attachDrag($floatResizeSE, 'both'); // corner      → both
  }

  function initFloatDrag() {
    const $topbar = $root.querySelector('#wsi-topbar');
    let activePointerId = null;
    let offsetX = 0, offsetY = 0;

    $topbar.addEventListener('pointerdown', (e) => {
      if (dockMode !== 'float') return;
      if (e.target.closest('button, input')) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      offsetX = e.clientX - floatX;
      offsetY = e.clientY - floatY;
      $topbar.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      $root.classList.add('is-dragging');
    });

    $topbar.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      const cw = document.documentElement.clientWidth;
      const ch = document.documentElement.clientHeight;
      floatX = Math.max(-(floatW - 80), Math.min(cw - 80, e.clientX - offsetX));
      floatY = Math.max(0, Math.min(ch - 30, e.clientY - offsetY));
      $root.style.left = floatX + 'px';
      $root.style.top  = floatY + 'px';
    });

    $topbar.addEventListener('pointerup', (e) => {
      if (e.pointerId !== activePointerId) return;
      $topbar.releasePointerCapture(e.pointerId);
      activePointerId = null;
      document.body.style.userSelect = '';
      $root.classList.remove('is-dragging');
      saveState();
    });
  }

  function updateResizeHandle() {
    if (!$resizeHandle) return;
    const isFloat = dockMode === 'float';

    $floatResizeS.hidden  = !isFloat;
    $floatResizeE.hidden  = !isFloat;
    $floatResizeSE.hidden = !isFloat;
    $resizeHandle.hidden  = isFloat;

    if (isFloat) return;

    Object.assign($resizeHandle.style, { top: '', bottom: '', left: '', right: '', width: '', height: '', cursor: '' });
    if (dockMode === 'bottom') {
      Object.assign($resizeHandle.style, { top: '0', left: '0', right: '0', height: '6px', cursor: 'ns-resize' });
    } else if (dockMode === 'top') {
      Object.assign($resizeHandle.style, { bottom: '0', left: '0', right: '0', height: '6px', cursor: 'ns-resize' });
    } else if (dockMode === 'right') {
      Object.assign($resizeHandle.style, { left: '0', top: '0', bottom: '0', width: '6px', cursor: 'ew-resize' });
    } else {  // left
      Object.assign($resizeHandle.style, { right: '0', top: '0', bottom: '0', width: '6px', cursor: 'ew-resize' });
    }
  }

  function initSheetResize() {
    let activePointerId = null;
    $sheetResize.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      activePointerId = e.pointerId;
      $sheetResize.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    });
    $sheetResize.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      const bottom  = $sheet.getBoundingClientRect().bottom;
      const panelH  = $panel.getBoundingClientRect().height;
      sheetH = Math.max(60, Math.min(panelH * 0.85, bottom - e.clientY));
      $sheet.style.flex = `0 0 ${sheetH}px`;
    });
    $sheetResize.addEventListener('pointerup', (e) => {
      if (e.pointerId !== activePointerId) return;
      $sheetResize.releasePointerCapture(e.pointerId);
      activePointerId = null;
      document.body.style.userSelect = '';
      saveState();
    });
  }

  // ---- Persist UI state ----

  function saveState() {
    chrome.storage.local.set({
      wsi_state: { dockMode, dockedSizes, floatX, floatY, floatW, floatH, sheetH },
    });
  }

  function loadState() {
    chrome.storage.local.get('wsi_state', (result) => {
      const s = result.wsi_state || {};
      if (s.dockedSizes)   dockedSizes = { ...dockedSizes, ...s.dockedSizes };
      if (s.floatW != null) floatW = s.floatW;
      if (s.floatH != null) floatH = s.floatH;
      if (s.floatX != null) floatX = s.floatX;
      if (s.floatY != null) floatY = s.floatY;
      if (s.sheetH != null) {
        sheetH = s.sheetH;
        $sheet.style.flex = `0 0 ${sheetH}px`;
      }
      applyDockMode(s.dockMode || 'right');
    });
  }

  // ---- Cocos resize ----
  // Sizes #GameDiv to the largest 1560×720 box that fits $pageWrap,
  // then tells the MAIN-world proxy what innerHeight/innerWidth to report
  // so Cocos reads the right value when it handles the resize event.

  function resizeCocos() {
    const rect = $pageWrap.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) return;

    const scale   = Math.min(rect.width / COCOS_W, rect.height / COCOS_H);
    const targetW = Math.floor(COCOS_W * scale);
    const targetH = Math.floor(COCOS_H * scale);

    const gameDiv = $pageWrap.querySelector('#GameDiv');
    if (gameDiv) {
      gameDiv.style.width  = targetW + 'px';
      gameDiv.style.height = targetH + 'px';
    }

    window.postMessage({
      type:   'WS_INSPECTOR_RESIZE',
      height: Math.floor(rect.height),
      width:  Math.floor(rect.width),
    }, '*');
  }

  // ---- Tabs ----

  function ensureTab(url) {
    if (tabs.has(url)) return;
    tabs.set(url, { filter: { dir: 'all', cmd: '', text: '' } });
    if (activeTab === null) activeTab = url;
    renderTabs();
  }

  function renderTabs() {
    $tabsEl.innerHTML = '';
    for (const [url] of tabs) {
      const btn = document.createElement('button');
      btn.className = 'wsi-tab' + (url === activeTab ? ' active' : '');
      btn.dataset.url = url;
      let pathname = url;
      try { pathname = new URL(url).pathname; } catch { /* keep raw url */ }
      btn.textContent = pathname;
      btn.addEventListener('click', () => selectTab(url));
      $tabsEl.appendChild(btn);
    }
  }

  const DIR_LABELS = { all: 'All', server: '↓ Server', client: '↑ Client' };

  function saveFilterToTab(url) {
    const tab = tabs.get(url);
    if (tab) tab.filter = { dir: filter.dir, cmd: filter.cmd, text: filter.text };
  }

  function loadFilterFromTab(url) {
    const tab = tabs.get(url);
    const f = tab?.filter ?? { dir: 'all', cmd: '', text: '' };
    filter.dir  = f.dir;
    filter.cmd  = f.cmd;
    filter.text = f.text;
    $dirBtn.dataset.dir = f.dir;
    $dirBtn.textContent = DIR_LABELS[f.dir];
    $cmdInput.value  = f.cmd;
    $textInput.value = f.text;
  }

  function selectTab(url) {
    if (activeTab) saveFilterToTab(activeTab);
    activeTab = url;
    loadFilterFromTab(url);
    renderTabs();
    applyFilters();
    if (atBottom) scrollToBottom();
  }

  // ---- Messages ----

  function handleMsg(record) {
    msgs.push(record);
    msgMap.set(record.id, record);
    ensureTab(record.url);
    appendRow(record);
  }

  function appendRow(record) {
    const row = document.createElement('div');
    row.className = 'wsi-row';
    row.dataset.id  = record.id;
    row.dataset.url = record.url;
    row.dataset.dir = record.direction;
    row.dataset.cmd = record.cmd != null ? String(record.cmd) : '';

    const ts  = new Date(record.ts);
    const tsStr = ts.toTimeString().slice(0, 8) + '.' + String(ts.getMilliseconds()).padStart(3, '0');
    const dirArrow = record.direction === 'server' ? '↓' : '↑';
    const dirClass = record.direction === 'server' ? 'wsi-server' : 'wsi-client';
    const cmdStr   = record.cmd != null ? String(record.cmd) : '--';

    row.innerHTML =
      `<span class="wsi-ts">${tsStr}</span>` +
      `<span class="wsi-dir ${dirClass}">${dirArrow}</span>` +
      `<span class="wsi-cmd">${cmdStr}</span>` +
      `<span class="wsi-preview">${escHtml(record.preview)}</span>`;

    row.addEventListener('click', () => selectMsg(record.id));

    const cmdFilter = parseCmdFilter(filter.cmd);
    row.hidden = !rowVisible(row, record, cmdFilter, buildTextMatcher().fn);

    $list.appendChild(row);
    if (atBottom && !row.hidden) scrollToBottom();
  }

  function scrollToBottom() {
    $list.scrollTop = $list.scrollHeight;
  }

  // ---- Filtering ----

  // Cache of the last successfully built matcher: { src, rx, fn }.
  // On an invalid pattern we fall back to this, so a half-typed regex leaves
  // the current result set alone instead of blanking the list.
  let matcherCache = null;

  function buildTextMatcher() {
    const src = filter.text;
    if (!src) {
      matcherCache = null;
      return { fn: null, invalid: false };
    }
    if (matcherCache && matcherCache.src === src && matcherCache.rx === filter.rx) {
      return { fn: matcherCache.fn, invalid: false };
    }
    if (filter.rx) {
      let re;
      try {
        re = new RegExp(src);
      } catch {
        return { fn: matcherCache?.fn ?? null, invalid: true };
      }
      matcherCache = { src, rx: true, fn: (raw) => re.test(raw) };
    } else {
      matcherCache = { src, rx: false, fn: (raw) => raw.includes(src) };
    }
    return { fn: matcherCache.fn, invalid: false };
  }

  function parseCmdFilter(raw) {
    if (!raw.trim()) return null;
    if (filter.cmdRangeMode) {
      const parts = raw.split(',').map(t => parseInt(t.trim(), 10));
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return { range: true, from: parts[0], to: parts[1] };
      }
      return null;
    }
    const s = new Set();
    for (const tok of raw.split(',')) {
      const n = parseInt(tok.trim(), 10);
      if (Number.isFinite(n)) s.add(n);
    }
    return s.size > 0 ? s : null;
  }

  function isInt(v) {
    return Number.isFinite(parseInt(v, 10));
  }

  function isHeartbeat(record) {
    const p = record.parsed;
    if (!Array.isArray(p)) return false;
    // Client HB: [intOrStr, string, intOrStr, number] — length 4
    if (p.length === 4 && isInt(p[0]) && typeof p[1] === 'string' && isInt(p[2]) && typeof p[3] === 'number') return true;
    // Server HB: [intOrStr, intOrStr, intOrStr] — length 3, all int-coercible
    if (p.length === 3 && isInt(p[0]) && isInt(p[1]) && isInt(p[2])) return true;
    return false;
  }

  function rowVisible(row, record, cmdFilter, textFn) {
    if (activeTab && row.dataset.url !== activeTab) return false;
    if (filter.dir !== 'all' && row.dataset.dir !== filter.dir) return false;
    if (cmdFilter) {
      if (row.dataset.cmd === '') return false;
      const cmd = parseInt(row.dataset.cmd, 10);
      if (cmdFilter instanceof Set) {
        if (!cmdFilter.has(cmd)) return false;
      } else {
        if (cmd < cmdFilter.from || cmd >= cmdFilter.to) return false;
      }
    }
    if (textFn) {
      const r = record ?? msgMap.get(row.dataset.id);
      if (!r || !textFn(r.raw)) return false;
    }
    if (filter.hideHb) {
      const r = record ?? msgMap.get(row.dataset.id);
      if (r && isHeartbeat(r)) return false;
    }
    return true;
  }

  function applyFilters() {
    filter.dir  = $dirBtn.dataset.dir;
    filter.cmd  = $cmdInput.value;
    filter.text = $textInput.value;
    if (activeTab) saveFilterToTab(activeTab);
    const { fn: textFn, invalid } = buildTextMatcher();
    $textInput.classList.toggle('wsi-invalid', invalid);
    const cmdFilter = parseCmdFilter(filter.cmd);
    for (const row of $list.querySelectorAll('.wsi-row')) {
      row.hidden = !rowVisible(row, null, cmdFilter, textFn);
    }
    if (atBottom) scrollToBottom();
  }

  function cycleDir() {
    const order  = ['all', 'server', 'client'];
    const labels = { all: 'All', server: '↓ Server', client: '↑ Client' };
    const next = order[(order.indexOf($dirBtn.dataset.dir) + 1) % order.length];
    $dirBtn.dataset.dir = next;
    $dirBtn.textContent = labels[next];
    applyFilters();
  }

  // ---- Detail sheet ----

  function selectMsg(id) {
    $list.querySelector('.wsi-row.selected')?.classList.remove('selected');
    $list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
    selectedId = id;

    const record = msgMap.get(id);
    if (!record) return;

    const ts = new Date(record.ts);
    const tsStr  = ts.toTimeString().slice(0, 8) + '.' + String(ts.getMilliseconds()).padStart(3, '0');
    const dirStr = record.direction === 'server' ? '↓ server' : '↑ client';
    const cmdStr = record.cmd != null ? String(record.cmd) : '--';
    $sheetMeta.textContent = `${tsStr}  ${dirStr}  cmd:${cmdStr}  ${record.url}`;

    const pretty = JSON.stringify(record.parsed, null, 2);
    $sheetCode.innerHTML = Prism.highlight(pretty, Prism.languages.json, 'json');

    $sheet.hidden = false;
  }

  function closeSheet() {
    $sheet.hidden = true;
    $list.querySelector('.wsi-row.selected')?.classList.remove('selected');
    selectedId = null;
  }

  function copySheet() {
    const record = msgMap.get(selectedId);
    if (!record) return;
    navigator.clipboard.writeText(JSON.stringify(record.parsed, null, 2)).then(() => {
      const orig = $copyBtn.textContent;
      $copyBtn.textContent = 'Copied!';
      setTimeout(() => { $copyBtn.textContent = orig; }, 1500);
    });
  }

  // ---- Clear ----

  function clearAll() {
    msgs.length = 0;
    msgMap.clear();
    $list.innerHTML = '';
    renderTabs();
    closeSheet();
    atBottom = true;
  }

  // ---- Helpers ----

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Wire up ----

  window.addEventListener('message', (e) => {
    if (!e.data || typeof e.data.type !== 'string') return;
    const { type, payload } = e.data;
    if (type === 'WS_INSPECTOR_MESSAGE') handleMsg(payload);
    else if (type === 'WS_INSPECTOR_OPEN') ensureTab(payload.url);
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'w') setVisible(!visible);
  });

  buildUI();
  $panel.style.display   = '';
  $showBtn.style.display = 'none';
  loadState();
  setTimeout(resizeCocos, 2000);
})();

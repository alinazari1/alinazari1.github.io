(() => {
  'use strict';
  if (window.ForentureResizers) return;
  const LEFT_KEY = 'forenture.layout.sidebar-width.v1';
  const RIGHT_KEY = 'forenture.layout.discussion-width.v1';
  const BAR = 8;
  const controllers = new Map();
  let outer = null, frameRequest = 0, disposed = false, id = 0;
  const style = document.createElement('style');
  style.id = 'forenture-resizer-styles-v1';
  style.textContent = `
.fr-outer:not([hidden]){display:grid!important;grid-template-columns:var(--fr-left-width,300px) ${BAR}px minmax(0,1fr)!important;gap:0!important;padding-inline:0!important;max-width:none!important;width:100%!important;box-sizing:border-box;align-items:start}
.fr-side{grid-column:1!important;grid-row:1!important;min-width:0!important;max-width:none!important;width:auto!important;margin-inline:0!important;box-sizing:border-box;resize:none!important}
.fr-main{grid-column:3!important;grid-row:1!important;min-width:0!important;max-width:none!important;width:100%!important;margin:0!important;padding:0!important;box-sizing:border-box}
.fr-main>.card{box-sizing:border-box;max-width:none!important;width:100%!important;margin-inline:0!important}
.fr-divider{position:relative;align-self:stretch;min-height:48px;width:${BAR}px;min-width:${BAR}px;padding:0;border:0;background:transparent;cursor:col-resize;touch-action:none;user-select:none;-webkit-user-select:none;z-index:4;box-sizing:border-box}
.fr-divider::after{content:'';position:absolute;inset:0 3px;background:#c6d7cb;border-radius:2px;transition:background .12s}
.fr-divider:hover::after,.fr-divider:focus-visible::after,.fr-divider.fr-dragging::after{background:#17643b}
.fr-divider:focus-visible{outline:2px solid #17643b;outline-offset:-2px}
.fr-outer>.fr-divider{grid-column:2!important;grid-row:1!important;height:100%}
body.fr-resizing,body.fr-resizing *{cursor:col-resize!important;user-select:none!important;-webkit-user-select:none!important}
.cn-stage.fr-network{display:grid!important;grid-template-columns:minmax(0,1fr) ${BAR}px var(--fr-right-width,330px)!important;gap:0!important;min-width:0}
.fr-network>.cn-canvas{grid-column:1!important;grid-row:1!important;min-width:0!important;max-width:none!important;width:auto!important;margin:0!important}
.fr-network>.fr-divider{grid-column:2!important;grid-row:1!important;height:100%}
.fr-network>.cn-drawer{grid-column:3!important;grid-row:1!important;min-width:0!important;max-width:none!important;width:auto!important;margin:0!important;box-sizing:border-box}
.fr-outer.fr-compact:not([hidden]){display:block!important}
.fr-outer.fr-compact>.fr-divider{display:none!important}
.fr-outer.fr-compact>.fr-side{width:100%!important}
.fr-outer.fr-compact>.fr-main{width:100%!important}
.cn-stage.fr-network.fr-compact{grid-template-columns:minmax(0,1fr)!important;row-gap:12px!important}
.fr-network.fr-compact>.fr-divider{display:none!important}
.fr-network.fr-compact>.cn-canvas{grid-column:1!important;grid-row:1!important}
.fr-network.fr-compact>.cn-drawer{grid-column:1!important;grid-row:2!important}
@media(max-width:800px){
  .fr-outer:not([hidden]){display:block!important}
  .fr-outer>.fr-divider{display:none!important}
  .cn-stage.fr-network{grid-template-columns:minmax(0,1fr)!important;row-gap:12px!important}
  .fr-network>.fr-divider{display:none!important}
  .fr-network>.cn-canvas{grid-column:1!important;grid-row:1!important}
  .fr-network>.cn-drawer{grid-column:1!important;grid-row:2!important}
}
`;
  document.head.append(style);
  function stored(key) {
    try { const raw = localStorage.getItem(key); const n = raw === null ? NaN : Number(raw); return Number.isFinite(n) && n > 0 ? n : null; }
    catch { return null; }
  }
  function save(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
  function removeStored(key) { try { localStorage.removeItem(key); } catch {} }
  function identify(node, prefix) { if (!node.id) node.id = prefix + (++id); return node.id; }
  function installSplitter({ root, pane, handle, property, key, sign, minimum, remaining, fallback, compactAt, undo }) {
    let requested = stored(key) ?? fallback;
    let drag = null, lastNonMinimum = requested, dead = false;
    function bounds() {
      const width = root.getBoundingClientRect().width;
      return { width, min: minimum, max: Math.max(minimum, width - remaining - BAR) };
    }
    function narrow() { return window.innerWidth <= 800 || root.getBoundingClientRect().width < compactAt; }
    function paint() {
      if (dead) return;
      const b = bounds();
      // Hidden account views have zero width; do not overwrite their preference.
      if (b.width <= 0) return;
      const compact = narrow(); root.classList.toggle('fr-compact', compact);
      handle.tabIndex = compact ? -1 : 0;
      handle.setAttribute('aria-disabled', String(compact));
      const width = Math.round(Math.max(b.min, Math.min(b.max, requested)));
      root.style.setProperty(property, width + 'px');
      handle.setAttribute('aria-valuemin', String(b.min));
      handle.setAttribute('aria-valuemax', String(Math.round(b.max)));
      handle.setAttribute('aria-valuenow', String(width));
      handle.setAttribute('aria-valuetext', width + ' pixels');
    }
    function set(value, persist = false) {
      const b = bounds(); if (b.width <= 0) return;
      requested = Math.round(Math.max(b.min, Math.min(b.max, value))); paint();
      if (persist) save(key, requested);
    }
    function finish(event, cancel = false) {
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return;
      const finished = drag; drag = null;
      if (cancel) requested = finished.width; else save(key, requested);
      handle.classList.remove('fr-dragging'); document.body.classList.remove('fr-resizing');
      if (handle.hasPointerCapture(finished.id)) handle.releasePointerCapture(finished.id);
      paint();
    }
    function down(event) {
      if (dead || narrow() || drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); event.stopPropagation(); handle.focus({ preventScroll: true });
      drag = { id: event.pointerId, x: event.clientX, width: Number(handle.getAttribute('aria-valuenow')) || requested };
      handle.setPointerCapture(event.pointerId); handle.classList.add('fr-dragging'); document.body.classList.add('fr-resizing');
    }
    function move(event) {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault(); set(drag.width + sign * (event.clientX - drag.x));
    }
    function up(event) { finish(event); }
    function cancel(event) { finish(event, true); }
    function keydown(event) {
      if (narrow()) return;
      if (event.key === 'Escape' && drag) { event.preventDefault(); finish(null, true); return; }
      const step = event.shiftKey ? 40 : 10;
      const value = Number(handle.getAttribute('aria-valuenow')) || requested;
      const b = bounds();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); set(value + sign * (event.key === 'ArrowRight' ? step : -step), true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); set(event.key === 'Home' ? b.min : b.max, true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (value > b.min + 1) { lastNonMinimum = value; set(b.min, true); }
        else set(lastNonMinimum || fallback, true);
      }
    }
    function reset() { requested = fallback; removeStored(key); paint(); }
    handle.addEventListener('pointerdown', down); handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel); handle.addEventListener('keydown', keydown);
    handle.addEventListener('dblclick', reset); window.addEventListener('blur', cancel);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null;
    observer?.observe(root); window.addEventListener('resize', paint); paint();
    const controller = {
      reset,
      destroy() {
        if (dead) return; finish(null, true); dead = true;
        observer?.disconnect(); window.removeEventListener('resize', paint); window.removeEventListener('blur', cancel);
        handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', cancel);
        handle.removeEventListener('lostpointercapture', cancel); handle.removeEventListener('keydown', keydown); handle.removeEventListener('dblclick', reset);
        handle.remove(); root.classList.remove('fr-compact'); root.style.removeProperty(property); undo?.();
      }
    };
    controllers.set(root, controller); return controller;
  }
  function divider(label, pane) {
    const h = document.createElement('div'); h.className = 'fr-divider'; h.tabIndex = 0;
    h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', 'vertical');
    h.setAttribute('aria-label', label); h.setAttribute('aria-controls', identify(pane, 'fr-pane-'));
    h.title = label + '. Drag or use Left/Right arrows. Double-click to reset.';
    return h;
  }
  function installOuter() {
    if (outer?.root.isConnected) return;
    const workspace = document.getElementById('workspace');
    const sidebar = workspace?.querySelector('aside.card');
    const chat = document.getElementById('composer')?.closest('section.card');
    if (!workspace || !sidebar || !chat || !workspace.contains(chat)) return;
    let root = sidebar.parentElement;
    while (root && !root.contains(chat)) root = root.parentElement;
    if (!root || !workspace.contains(root) || root === sidebar) return;
    let sideBranch = sidebar;
    while (sideBranch.parentElement !== root) sideBranch = sideBranch.parentElement;
    // Group only this layout's existing non-sidebar children. Existing nodes,
    // event listeners, IDs and form values are retained.
    const content = document.createElement('div'); content.className = 'fr-main';
    const initialWidth = sidebar.getBoundingClientRect().width;
    for (const child of [...root.childNodes]) {
      if (child === sideBranch) continue;
      if (child.nodeType === 1 && ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue;
      content.append(child);
    }
    const handle = divider('Resize topic sidebar', sideBranch);
    root.append(handle, content); root.classList.add('fr-outer'); sideBranch.classList.add('fr-side');
    const controller = installSplitter({ root, pane: sideBranch, handle, property: '--fr-left-width', key: LEFT_KEY,
      sign: 1, minimum: 220, remaining: 420, fallback: Math.max(240, Math.min(360, initialWidth || 300)), compactAt: 720,
      undo() {
        root.classList.remove('fr-outer'); sideBranch.classList.remove('fr-side');
        if (content.parentElement === root) { while (content.firstChild) root.insertBefore(content.firstChild, content); content.remove(); }
      }
    });
    outer = { root, controller };
  }
  function installNetwork(stage) {
    if (controllers.has(stage)) return;
    const canvas = [...stage.children].find(n => n.classList.contains('cn-canvas'));
    const drawer = [...stage.children].find(n => n.classList.contains('cn-drawer'));
    if (!canvas || !drawer || stage.closest('[aria-hidden="true"]')) return;
    const root = stage.closest('.cn');
    if (root && getComputedStyle(root).visibility === 'hidden') return;
    const handle = divider('Resize discussion panel', drawer);
    stage.insertBefore(handle, drawer); stage.classList.add('fr-network');
    installSplitter({ root: stage, pane: drawer, handle, property: '--fr-right-width', key: RIGHT_KEY,
      sign: -1, minimum: 250, remaining: 300, fallback: 330, compactAt: 610,
      undo() { stage.classList.remove('fr-network'); }
    });
  }
  function scan() {
    frameRequest = 0; if (disposed) return;
    for (const [root, controller] of controllers) {
      if (!root.isConnected) { controller.destroy(); controllers.delete(root); }
    }
    installOuter();
    document.querySelectorAll('.cn-stage').forEach(installNetwork);
  }
  function schedule() { if (!frameRequest && !disposed) frameRequest = requestAnimationFrame(scan); }
  const mutations = new MutationObserver(records => {
    let relevant = [...controllers.keys()].some(root => !root.isConnected);
    if (!outer) relevant = true;
    if (!relevant) for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1 && (node.matches('#workspace,.cn-stage') || node.querySelector('#workspace,.cn-stage'))) { relevant = true; break; }
      }
      if (relevant) break;
    }
    if (relevant) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });
  window.ForentureResizers = {
    reset() { removeStored(LEFT_KEY); removeStored(RIGHT_KEY); controllers.forEach(c => c.reset()); },
    destroy() {
      disposed = true; mutations.disconnect(); cancelAnimationFrame(frameRequest);
      [...controllers.values()].forEach(c => c.destroy()); controllers.clear(); style.remove();
      delete window.ForentureResizers;
    }
  };
  scan();
})();

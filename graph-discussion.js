function ensureStyles() {
  if (document.getElementById('graph-discussion-styles-2')) return;
  const style = document.createElement('style');
  style.id = 'graph-discussion-styles-2';
  style.textContent = `
.cn-stage{grid-template-columns:minmax(0,1fr) 330px}
.cn-comment-badge{cursor:pointer}
.cn-comment-badge:focus>rect{stroke:#b66a00;stroke-width:3}
.cn-review-header{display:flex;justify-content:flex-end;margin-bottom:10px}
.cn-review-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.cn-review-tabs button[aria-pressed=true]{background:#17643b;color:#fff}
.cn-review-messages{max-height:270px;overflow-y:auto;overscroll-behavior:contain;padding:2px}
.cn-review-message{margin:0 0 10px;padding:10px;border:1px solid #dbe6dd;border-radius:8px;background:#f6faf7}
.cn-review-message.is-own{background:#eaf4ed}
.cn-review-message.is-reply{margin-left:12px;border-left:3px solid #80b491}
.cn-review-message .cn-review-author{margin-top:0;font-size:11px;font-weight:600}
.cn-review-body{white-space:pre-wrap;overflow-wrap:anywhere}
.cn-review-form{margin-top:14px;padding-top:12px;border-top:1px solid #dbe6dd}
.cn-review-form label{display:block;margin:8px 0}
.cn-review-form textarea{box-sizing:border-box;display:block;width:100%;min-height:95px;margin-top:5px;padding:9px;border:1px solid #a8bdb0;border-radius:6px;background:#fff;color:#111;font:inherit;resize:vertical;user-select:text;-webkit-user-select:text}
.cn-review-form button[type=submit]{background:#17643b;color:#fff}
@media(max-width:800px){.cn-stage{grid-template-columns:1fr}.cn-drawer{max-height:600px}}
`;
  document.head.append(style);
}
function el(tag, value, parent) {
  const n = document.createElement(tag);
  if (value != null) n.textContent = String(value);
  if (parent) parent.append(n);
  return n;
}
function who(m) {
  if (m.is_own) return 'You';
  const role = m.author_role === 'business_owner' ? 'Business user' : 'Advisor';
  return `${role} · ${String(m.author_id || '').slice(0, 8)}`;
}
function time(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}
export function createGraphDiscussion({ row, options, onCountsChanged }) {
  ensureStyles();
  const actor = options.getSession?.()?.user?.id;
  const enabled = !!actor && typeof options.getDb === 'function';
  let dead = false, frame = null, active = null, reading = false;
  let countBusy = false, countSerial = 0, counts = new Map();
  const drafts = new Map(), pendingReads = new Set();
  const current = () => !dead && enabled &&
    options.getSession?.()?.user?.id === actor && options.isCurrent?.() !== false;
  const base = () => ({ p_snapshot_id: String(row.id), p_revision: row.revision });
  const key = (kind, id) => JSON.stringify([kind, String(id)]);
  const draftKey = s => JSON.stringify([s.turnId, s.kind, s.id]);
  const params = s => ({ ...base(), p_turn_id: s.turnId,
    p_target_kind: s.kind, p_target_id: s.id });
  const notify = () => { if (!dead) onCountsChanged?.(); };
  async function rpc(name, args) {
    if (!current()) throw new Error('The account or topic changed. Reopen this review.');
    const result = await options.getDb().rpc(name, args);
    if (result.error) throw result.error;
    if (!current()) throw new Error('The account or topic changed.');
    return result.data;
  }
  function updateForm(s) {
    if (active !== s) return;
    s.input.disabled = s.posting || !current() || s.denied;
    s.send.disabled = s.input.disabled || s.loading;
    s.send.textContent = s.posting ? 'Posting…' : s.replyTo ? 'Send reply' : 'Post comment';
    s.replyLabel.textContent = s.replyTo ? `Replying to ${s.replyTo.label}` : 'New comment';
    s.cancel.hidden = !s.replyTo;
  }
  function failure(s, error) {
    if (active !== s) return;
    s.status.textContent = error.message || String(error);
    if (error.code === '42501' || !current()) {
      s.denied = true;
      s.observer?.disconnect();
      s.list.replaceChildren();
      updateForm(s);
    }
  }
  async function refreshCounts() {
    if (!frame || dead || countBusy) return;
    if (!current()) { counts.clear(); notify(); if (active) failure(active, new Error('Review session ended.')); return; }
    const turn = String(frame.turnId), serial = ++countSerial;
    countBusy = true;
    try {
      const data = await rpc('graph_review_counts', { ...base(), p_turn_id: turn });
      if (dead || serial !== countSerial || String(frame?.turnId) !== turn) return;
      counts = new Map((data || []).map(x => [key(x.target_kind, x.target_id),
        { total: Number(x.total_count) || 0, unread: Number(x.unread_count) || 0 }]));
      notify();
    } catch (e) {
      if (!dead && serial === countSerial) {
        counts.clear(); notify(); if (active) failure(active, e);
      }
    } finally {
      countBusy = false;
      if (!dead && String(frame?.turnId) !== turn) void refreshCounts();
    }
  }
  async function flushReads() {
    if (reading || !pendingReads.size || !current()) return;
    reading = true;
    const ids = [...pendingReads].slice(0, 200);
    ids.forEach(id => pendingReads.delete(id));
    try {
      await rpc('graph_review_mark_read', { ...base(), p_comment_ids: ids });
      if (active) for (const m of active.messages) if (ids.includes(m.id)) m.is_unread = false;
      void refreshCounts();
    } catch (e) { if (active) failure(active, e); }
    finally { reading = false; }
  }
  function observe(s) {
    s.observer?.disconnect();
    if (active !== s || !s.open || s.denied || document.visibilityState !== 'visible' || !current()) return;
    if (typeof IntersectionObserver !== 'function') return;
    s.observer = new IntersectionObserver(entries => {
      if (active !== s || !s.open || document.visibilityState !== 'visible' || !current()) return;
      for (const entry of entries) {
        if (entry.intersectionRatio < 1) continue;
        pendingReads.add(entry.target.dataset.messageId);
        s.observer.unobserve(entry.target);
      }
    }, { root: null, threshold: 1 });
    for (const m of s.messages) if (m.is_unread && s.headings.has(m.id)) s.observer.observe(s.headings.get(m.id));
  }
  function append(s, m) {
    const card = el('article', null, s.list);
    card.className = 'cn-review-message' + (m.is_own ? ' is-own' : '') + (m.parent_id ? ' is-reply' : '');
    const h = el('p', `${who(m)} · ${time(m.created_at)}`, card);
    h.className = 'cn-review-author'; h.dataset.messageId = m.id; s.headings.set(m.id, h);
    if (m.parent_id) {
      const parent = s.messages.find(x => x.id === m.parent_id);
      el('p', parent ? `Reply to ${who(parent)}` : 'Reply to an earlier message', card).className = 'cn-note';
    }
    el('p', m.body, card).className = 'cn-review-body';
    const reply = el('button', 'Reply', card); reply.type = 'button';
    reply.onclick = () => { s.replyTo = { id: m.id, label: who(m) }; updateForm(s); s.input.focus(); };
  }
  async function load(s, { seekUnread = false, drain = false } = {}) {
    if (active !== s || s.loading || s.denied || !current()) return false;
    s.loading = true; updateForm(s); s.status.textContent = 'Loading discussion…';
    try {
      let batch;
      do {
        batch = await rpc('graph_review_messages', { ...params(s), p_after_sequence: s.cursor }) || [];
        if (active !== s) return false;
        for (const m of batch) {
          const sequence = Number(m.sequence_no);
          if (!Number.isSafeInteger(sequence)) throw new Error('Unsupported message sequence.');
          s.cursor = Math.max(s.cursor, sequence);
          if (!s.messages.some(x => x.id === m.id)) { s.messages.push(m); append(s, m); }
        }
        s.more.hidden = batch.length < 200;
      } while (batch.length === 200 && (drain || (seekUnread && !s.messages.some(m => m.is_unread))));
      s.status.textContent = s.messages.length ? '' : 'No comments yet. Start the discussion below.';
      if (seekUnread) {
        const m = s.messages.find(x => x.is_unread), h = m && s.headings.get(m.id);
        if (h) s.list.scrollTop += h.getBoundingClientRect().top - s.list.getBoundingClientRect().top - 8;
      }
      observe(s); return true;
    } catch (e) { failure(s, e); return false; }
    finally { s.loading = false; updateForm(s); }
  }
  function detach() {
    if (!active) return;
    drafts.set(draftKey(active), { body: active.input.value, replyTo: active.replyTo });
    active.observer?.disconnect(); active = null;
  }
  function mount(drawer, { frame: slice, kind, item }) {
    detach();
    const overview = el('div'); overview.append(...drawer.childNodes);
    const header = el('div'); header.className = 'cn-review-header';
    const start = el('button', 'New comment', header); start.type = 'button';
    const tabs = el('div'); tabs.className = 'cn-review-tabs';
    const details = el('button', 'Details & sources', tabs), discussion = el('button', 'Discussion', tabs);
    details.type = discussion.type = 'button';
    const pane = el('div'); pane.hidden = true;
    drawer.replaceChildren(header, tabs, overview, pane);
    if (!enabled) {
      start.disabled = true;
      el('p', 'Sign-in/database connection is required for this graph’s discussion.', pane);
      details.onclick = () => { overview.hidden = false; pane.hidden = true; };
      discussion.onclick = () => { overview.hidden = true; pane.hidden = false; };
      return;
    }
    const s = { turnId: String(slice.turnId), kind, id: String(item.id), messages: [],
      headings: new Map(), cursor: 0, loading: false, posting: false, denied: false,
      open: false, observer: null, replyTo: null };
    s.status = el('p', '', pane); s.status.className = 'cn-note'; s.status.setAttribute('role', 'status');
    s.list = el('div', null, pane); s.list.className = 'cn-review-messages';
    s.more = el('button', 'Load more messages', pane); s.more.type = 'button'; s.more.hidden = true;
    s.more.onclick = () => void load(s);
    const form = el('form', null, pane); form.className = 'cn-review-form';
    s.replyLabel = el('p', 'New comment', form);
    s.cancel = el('button', 'Cancel reply', form); s.cancel.type = 'button';
    const label = el('label', 'Your message', form);
    s.input = el('textarea', null, label); s.input.rows = 4; s.input.maxLength = 8000;
    s.input.placeholder = 'Ask a question, add evidence, or leave feedback…';
    s.send = el('button', 'Post comment', form); s.send.type = 'submit';
    const draft = drafts.get(draftKey(s));
    if (draft) { s.input.value = draft.body; s.replyTo = draft.replyTo; }
    active = s;
    function switchView(open) {
      if (active !== s) return;
      s.open = open; pane.hidden = !open; overview.hidden = open;
      details.setAttribute('aria-pressed', String(!open)); discussion.setAttribute('aria-pressed', String(open));
      if (!open) s.observer?.disconnect();
    }
    s.openDiscussion = ({ firstUnread = false, focus = false } = {}) => {
      switchView(true); void load(s, { seekUnread: firstUnread }); if (focus) s.input.focus();
    };
    details.onclick = () => switchView(false);
    discussion.onclick = () => s.openDiscussion({ firstUnread: true });
    start.onclick = () => { s.replyTo = null; updateForm(s); s.openDiscussion({ focus: true }); };
    s.cancel.onclick = () => { s.replyTo = null; updateForm(s); s.input.focus(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if (active !== s || s.posting || s.loading || !current() || s.denied) return;
      const body = s.input.value.trim();
      if (!body) { s.status.textContent = 'Write a message first.'; s.input.focus(); return; }
      s.posting = true; updateForm(s); s.status.textContent = 'Posting message…';
      try {
        await rpc('graph_review_post', { ...params(s), p_body: body, p_parent_id: s.replyTo?.id || null });
        // Preserve a newer draft written after switching away from this target.
        const saved = drafts.get(draftKey(s));
        if (saved?.body === body) drafts.delete(draftKey(s));
        if (active === s) {
          s.input.value = ''; s.replyTo = null;
          await load(s, { drain: true });
        }
        void refreshCounts();
      } catch (e) {
        failure(s, { ...e, message: `Could not confirm posting: ${e.message}. Refresh the discussion before retrying to avoid duplicates.` });
      } finally { s.posting = false; updateForm(s); }
    };
    switchView(false); updateForm(s);
  }
  function visibility() { if (active?.open && document.visibilityState === 'visible') { observe(active); void load(active); } }
  document.addEventListener('visibilitychange', visibility);
  const readsTimer = setInterval(() => void flushReads(), 750);
  const poll = setInterval(() => {
    if (document.visibilityState !== 'visible' || dead) return;
    void refreshCounts(); if (active?.open) void load(active);
  }, 15000);
  return {
    setFrame(slice) {
      const changed = String(frame?.turnId) !== String(slice?.turnId); frame = slice;
      if (changed) { counts.clear(); countSerial++; notify(); void refreshCounts(); }
    },
    getCount(kind, id) { return counts.get(key(kind, id)) || { total: 0, unread: 0 }; },
    mount, detach,
    openDiscussion(settings) { active?.openDiscussion?.(settings); },
    destroy() {
      detach(); dead = true; clearInterval(poll); clearInterval(readsTimer);
      pendingReads.clear(); drafts.clear(); document.removeEventListener('visibilitychange', visibility);
    }
  };
}

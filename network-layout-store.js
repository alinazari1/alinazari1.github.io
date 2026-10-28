function element(tag, value, parent) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = String(value);
  if (parent) parent.append(node);
  return node;
}

export function validateLayout(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.positions)) {
    throw new Error('The saved layout format is not supported.');
  }
  if (value.positions.length > 10000) throw new Error('The saved layout is too large.');
  const finite = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1000000;
  const used = new Set();
  const positions = value.positions.map(p => {
    if (!p || typeof p.id !== 'string' || !p.id || used.has(p.id) || !finite(p.x) || !finite(p.y)) {
      throw new Error('The saved layout contains invalid node positions.');
    }
    used.add(p.id);
    return { id: p.id, x: p.x, y: p.y };
  });
  const v = value.view;
  if (!v || !finite(v.zoom) || v.zoom < 0.45 || v.zoom > 3 || !finite(v.panX) || !finite(v.panY)) {
    throw new Error('The saved layout contains an invalid camera view.');
  }
  return {
    version: 1,
    positions,
    view: { zoom: v.zoom, panX: v.panX, panY: v.panY },
    selectedTurnId: value.selectedTurnId == null ? null : String(value.selectedTurnId)
  };
}

export function attachAccountLayout({ root, row, options = {}, readState, applyState }) {
  const controls = element('div', null, root);
  controls.className = 'cn-controls';
  const saveButton = element('button', 'Save layout', controls);
  saveButton.type = 'button';
  saveButton.disabled = true;
  const retryButton = element('button', 'Retry loading layout', controls);
  retryButton.type = 'button';
  retryButton.hidden = true;
  const status = element('span', '', controls);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.className = 'cn-note';

  let dead = false, loading = false, saving = false, loaded = false;
  let baseline = null, dirty = false, notice = '';
  const userId = options.getSession?.()?.user?.id || null;
  const reportId = row?.id == null ? '' : String(row.id);
  const db = options.getDb?.();
  const current = () => !dead && options.getSession?.()?.user?.id === userId &&
    (!options.isCurrent || options.isCurrent());
  const stateString = () => JSON.stringify(validateLayout(readState()));

  function update() {
    if (dead) return;
    saveButton.disabled = !loaded || loading || saving || !current();
    retryButton.disabled = loading || saving || !current();
    if (!loaded || loading || saving) return;
    dirty = stateString() !== baseline;
    status.textContent = dirty ? 'Unsaved layout changes. Select Save layout to keep them across devices.' : notice;
  }

  async function restore() {
    if (!current() || loading || saving) return;
    if (loaded && dirty && !window.confirm('Discard your unsaved layout changes and reload the saved layout?')) return;
    loading = true;
    loaded = false;
    root.inert = true;
    saveButton.disabled = true;
    retryButton.hidden = true;
    status.textContent = 'Loading your saved layout…';
    try {
      const result = await db.from('research_network_layouts')
        .select('layout,updated_at')
        .eq('user_id', userId)
        .eq('report_snapshot_id', reportId)
        .maybeSingle();
      if (!current()) return;
      if (result.error) throw result.error;
      if (result.data) {
        applyState(validateLayout(result.data.layout));
        notice = 'Your saved account layout has been restored.';
      } else {
        notice = 'No saved layout for this report. Arrange the graph, then select Save layout.';
      }
      baseline = stateString();
      dirty = false;
      loaded = true;
    } catch (error) {
      if (!current()) return;
      notice = '';
      status.textContent = 'Could not load your layout: ' + error.message +
        '. You can still explore the graph, but saving is disabled until loading succeeds.';
      retryButton.hidden = false;
    } finally {
      loading = false;
      if (current()) {
        root.inert = false;
        update();
      }
    }
  }

  async function save() {
    if (!current() || !loaded || loading || saving) return;
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    status.textContent = 'Saving layout to your account…';
    try {
      const state = validateLayout(readState());
      const signature = JSON.stringify(state);
      const result = await db.from('research_network_layouts')
        .upsert({ user_id: userId, report_snapshot_id: reportId, layout: state },
          { onConflict: 'user_id,report_snapshot_id' })
        .select('report_snapshot_id,updated_at')
        .single();
      if (!current()) return;
      if (result.error) throw result.error;
      if (!result.data) throw new Error('The database did not confirm the save.');
      baseline = signature;
      notice = 'Layout saved to your account.';
    } catch (error) {
      if (current()) {
        notice = 'Could not save layout: ' + error.message;
        status.textContent = notice;
      }
      saving = false;
      if (current()) {
        saveButton.textContent = 'Save layout';
        saveButton.disabled = !loaded;
      }
      return;
    } finally {
      saving = false;
      if (!dead) saveButton.textContent = 'Save layout';
    }
    if (current()) update();
  }

  saveButton.onclick = save;
  retryButton.onclick = restore;
  function beforeUnload(event) {
    if (current() && loaded && stateString() !== baseline) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', beforeUnload);

  if (!userId || !reportId || reportId.length > 200 || !db || !current()) {
    status.textContent = 'Account layout saving is unavailable in this viewer.';
  } else {
    restore();
  }
  return {
    changed() { if (!dead && loaded && !loading && !saving && current()) update(); },
    save,
    destroy() {
      dead = true;
      window.removeEventListener('beforeunload', beforeUnload);
      controls.remove();
    }
  };
}

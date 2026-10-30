import { renderLatestDevelopment } from './latest-development.js?v=latest-1';
import {
  renderConceptsNetwork,
  normalizeNetwork
} from './concepts-network.js?v=connection-1';
import { createTopicPdfWindow, fillTopicPdfWindow, showTopicPdfError } from './topic-pdf-export.js?v=direct-pdf-1';

const list = v => Array.isArray(v) ? v : [];
function el(tag, value, parent) {
  const n = document.createElement(tag);
  if (value != null) n.textContent = String(value);
  if (parent) parent.append(n);
  return n;
}
function date(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Date unavailable' : d.toLocaleString();
}
export function mountAdvisorReportTabs({ container, topic, ownerId, getDb, getSession, isCurrent }) {
  const actor = getSession()?.user?.id;
  let dead = false, loading = false, pdfBusy = false, serial = 0, graphSerial = 0;
  let row = null, graph = null, tab = 'concepts_network';
  const current = () => !dead && !!actor && getSession()?.user?.id === actor && isCurrent();
  const root = el('section', null, container); root.className = 'advisor-saved-reports';
  const heading = el('div', null, root); heading.className = 'report-heading';
  const pdf = el('button', 'PDF', heading); pdf.type = 'button';
  el('h3', 'Topic reports', heading);
  el('p', 'View saved reports and inspect the graph. The original conversation and reports are read-only. Graph comments use your own advisor identity and their separate access checks.', root).className = 'small';
  const controls = el('div', null, root); controls.className = 'row';
  const label = el('label', 'Saved report ', controls);
  const select = el('select', null, label); select.setAttribute('aria-label', 'Advisor report snapshot');
  const refresh = el('button', 'Refresh reports', controls); refresh.type = 'button';
  const tabs = el('div', null, root); tabs.className = 'row';
  const status = el('p', '', root); status.className = 'small'; status.setAttribute('role', 'status');
  const content = el('div', null, root);
  const buttons = new Map();
  const names = { quick_summary: 'Quick summary', conversation_insights: 'Conversation insights', concepts_network: 'Concepts network' };
  for (const [id, name] of Object.entries(names)) {
    const b = el('button', name, tabs); b.type = 'button'; buttons.set(id, b);
    b.onclick = () => { if (!current() || loading || pdfBusy) return; tab = id; render(); };
  }
  function sync() {
    pdf.disabled = !row || loading || pdfBusy || !current();
    refresh.disabled = loading || pdfBusy || !current();
    select.disabled = loading || pdfBusy || !current() || !select.options.length;
    for (const [id, b] of buttons) {
      b.disabled = loading || pdfBusy || !current();
      b.setAttribute('aria-pressed', String(id === tab));
    }
  }
  function dispose() { graphSerial++; graph?.destroy(); graph = null; }
  function evidence(item, parent) {
    if (!list(item.evidence).length) return;
    const d = el('details', null, parent); el('summary', 'Source passages', d);
    for (const e of list(item.evidence)) el('blockquote', `${e.speaker || 'Source'} · ${e.turn_id || ''}\n${e.quote || ''}`, d);
  }
  function render() {
    dispose(); content.replaceChildren(); sync();
    if (!row) {
      el('p', 'No saved report is available for this selection. The topic owner must generate a report before an advisor can review its graph. The conversation below remains available.', content);
      return;
    }
    try {
      if (tab === 'concepts_network') {
        const ticket = graphSerial;
        graph = renderConceptsNetwork(row, content, {
          getDb, getSession, reviewMode: true,
          isCurrent: () => current() && ticket === graphSerial && tab === 'concepts_network'
        });
      } else if (tab === 'quick_summary') {
        el('h4', 'What the business user mentioned', content);
        el('p', `Based on ${row.quick_summary?.prompt_count ?? '?'} completed user prompts.`, content);
        const groups = list(row.quick_summary?.groups);
        for (const group of groups) {
          const d = el('details', null, content); el('summary', group.label, d);
          for (const e of list(group.evidence)) el('blockquote', e.quote, d);
        }
        if (!groups.length) el('p', 'No predefined categories were recorded.', content);
        const unmatched = list(row.quick_summary?.unmatched);
        if (unmatched.length) {
          const d = el('details', null, content); el('summary', 'Other passages', d);
          for (const e of unmatched) el('blockquote', e.quote, d);
        }
      } else {
        const slices = list(row.conversation_insights?.snapshots), model = slices.at(-1)?.model;
        el('h4', 'Conversation insights', content);
        el('p', 'AI-proposed interpretations, not verified business facts. Assistant suggestions are not business-user decisions.', content);
        if (!model) { el('p', 'No saved concept model.', content); return; }
        renderLatestDevelopment(row, content);
        for (const [title, roles] of [['Goals and limits', ['goal','constraint']], ['Factors discussed', ['concept','driver','outcome']], ['Directions and options', ['direction']]]) {
          el('h4', title, content);
          const found = list(model.concepts).filter(c => roles.includes(c.role));
          if (!found.length) el('p', 'Not identified in this report.', content);
          for (const c of found) {
            const d = el('details', null, content); el('summary', c.label || c.id, d);
            el('p', c.definition, d); el('p', `Role: ${c.role} · Review: ${c.review_status || 'Not recorded'}`, d);
            if (c.state_estimate) el('p', `Recorded user estimate: ${c.state_estimate.probability} — ${c.state_estimate.proposition}`, d);
            evidence(c, d);
          }
        }
        el('h4', 'Possible connections — not established causes', content);
        const labels = new Map(list(model.concepts).map(c => [c.id, c.label]));
        for (const edge of list(model.relationships)) {
          const d = el('details', null, content);
          el('summary', `${labels.get(edge.from_id) || edge.from_id} ${edge.directed === true ? '→' : '—'} ${labels.get(edge.to_id) || edge.to_id}`, d);
          el('p', edge.description, d); evidence(edge, d);
        }
        el('h4', 'How the discussion developed', content);
        for (const slice of slices) {
          const d = el('details', null, content); el('summary', `Exchange ${slice.sequence} · ${date(slice.created_at)}`, d);
          const changes = list(slice.model?.changes).filter(c => c.kind !== 'unchanged');
          if (!changes.length) el('p', 'No substantive changes identified.', d);
          for (const change of changes) el('p', change.description, d);
        }
        el('h4', 'Questions still open', content);
        for (const question of list(model.open_questions)) el('p', question, content);
      }
    } catch (error) { content.replaceChildren(); el('p', `Could not display this report: ${error.message}`, content); }
  }
  async function allSnapshots() {
    const records = [];
    for (let start = 0; ; start += 100) {
      const response = await getDb().from('research_report_snapshots')
        .select('id,revision,requested_at,generation_completed_at,created_at')
        .eq('conversation_id', String(topic.id)).eq('user_id', ownerId)
        .order('created_at', { ascending: false }).order('id').range(start, start + 99);
      if (!current()) throw new Error('Review closed.');
      if (response.error) throw response.error;
      records.push(...(response.data || []));
      if ((response.data || []).length < 100) return records;
    }
  }
  async function fetchSelected() {
    const response = await getDb().from('research_report_snapshots').select('*')
      .eq('id', select.value).eq('conversation_id', String(topic.id)).eq('user_id', ownerId).single();
    if (response.error) throw response.error;
    return response.data;
  }
  async function load(reloadList) {
    if (!current() || pdfBusy || loading) return;
    const ticket = ++serial;
    loading = true; row = null; dispose(); content.replaceChildren(); sync();
    status.textContent = 'Loading saved reports…';
    try {
      if (reloadList) {
        const previous = select.value, records = await allSnapshots();
        if (!current() || ticket !== serial) return;
        select.replaceChildren();
        for (const record of records) {
          const o = el('option', `${date(record.requested_at)} · revision ${record.revision}`, select); o.value = String(record.id);
        }
        if (records.some(r => String(r.id) === previous)) select.value = previous;
      }
      const loaded = select.value ? await fetchSelected() : null;
      if (!current() || ticket !== serial) return;
      row = loaded;
      status.textContent = row ? `Saved report revision ${row.revision} · completed ${date(row.generation_completed_at)}.` : 'No saved reports. Ask the owner to generate the report pair.';
    } catch (error) {
      if (current() && ticket === serial) status.textContent = `Could not load reports: ${error.message}`;
    } finally {
      if (current() && ticket === serial) { loading = false; render(); }
    }
  }
  pdf.onclick = async () => {
    if (!current() || !row || pdfBusy || loading) return;
    const captured = row, ticket = serial;
    let win = null, temp = null, tempView = null;
    const assertCurrent = () => {
      if (!current() || row !== captured || ticket !== serial) throw new Error('Review changed. Export cancelled.');
      if (win?.closed) throw new Error('The preparation document closed.');
    };
    pdfBusy = true; sync();
    try {
      win = createTopicPdfWindow();
      const verify = await getDb().from('research_report_snapshots').select('id,revision')
        .eq('id', captured.id).eq('revision', captured.revision).eq('user_id', ownerId).single();
      if (verify.error) throw verify.error; assertCurrent();
      let asset;
      if (graph) asset = graph.captureForPdf();
      else {
        temp = document.createElement('div'); temp.style.cssText = 'position:fixed;left:-20000px;width:1100px;visibility:hidden'; document.body.append(temp);
        tempView = renderConceptsNetwork(captured, temp, { exportMode: true }); asset = tempView.captureForPdf();
      }
      await fillTopicPdfWindow({ win, row: captured, frames: normalizeNetwork(captured), networkSvg: asset.svg, assertCurrent });
      if (current()) status.textContent = 'PDF generated for the selected saved report.';
    } catch (error) {
      showTopicPdfError(win, error.message); if (current()) status.textContent = `PDF export failed: ${error.message}`;
    } finally {
      tempView?.destroy(); temp?.remove(); win?.__forenturePdfFrame?.remove(); pdfBusy = false; if (current()) sync();
    }
  };
  select.onchange = () => void load(false);
  refresh.onclick = () => void load(true);
  void load(true);
  return { destroy() { dead = true; serial++; dispose(); root.remove(); } };
}

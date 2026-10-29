import { renderConceptsNetwork } from './concepts-network.js?v=comments-2';
import { renderLatestDevelopment } from './latest-development.js?v=latest-1';
import { createTopicPdfWindow, fillTopicPdfWindow, showTopicPdfError } from './topic-pdf-export.js?v=direct-pdf-1';
function el(tag, value, parent) {
  const n = document.createElement(tag);
  if (value != null) n.textContent = String(value);
  if (parent) parent.append(n);
  return n;
}
const arr = v => Array.isArray(v) ? v : [];
export function mountAdvisorTopicReviews({ container, getDb, getSession }) {
  container.hidden = true;
  container.classList.add('advisor-topic-reviews');
  if (!document.getElementById('advisor-review-styles-2')) {
    const style = document.createElement('style');
    style.id = 'advisor-review-styles-2';
    style.textContent = '.advisor-topic-reviews{margin:18px 0;padding:14px;border:1px solid #b9cebf;border-radius:8px;background:#fff;color:#183c2b;font:14px/1.5 system-ui,sans-serif}.advisor-topic-reviews>details>summary{cursor:pointer;font-weight:600}.advisor-topic-reviews label{display:inline-block;margin:8px 10px 8px 0}.advisor-topic-reviews select{max-width:100%;padding:6px}.advisor-topic-reviews p,.advisor-topic-reviews blockquote{overflow-wrap:anywhere}.advisor-topic-reviews button{cursor:pointer;padding:6px 10px}.advisor-topic-reviews button[aria-pressed=true]{background:#17643b;color:#fff}';
    document.head.append(style);
  }
  const box = el('details', null, container);
  el('summary', 'Advisor review — assigned and shared topics', box);
  const note = el('p', 'Only topics both assigned and shared with you appear here.', box);
  const refresh = el('button', 'Refresh topics', box); refresh.type = 'button';
  const topicLabel = el('label', 'Topic ', box), topics = el('select', null, topicLabel);
  topics.setAttribute('aria-label', 'Assigned and shared topic');
  const snapshotLabel = el('label', ' Saved report ', box), snapshots = el('select', null, snapshotLabel);
  const status = el('p', '', box); status.setAttribute('role', 'status');
  const actions = el('div', null, box); actions.className = 'cn-controls';
  const body = el('div', null, box);
  let actor = null, serial = 0, viewSerial = 0, dead = false, checking = false;
  let view = null, selectedTopic = null, row = null, tab = 'network', busyPdf = false;
  let knownTopics = [], lastCheck = 0;
  const uid = () => getSession()?.user?.id || null;
  const valid = (token, person) => !dead && token === serial && uid() === person;
  const dispose = () => { view?.destroy(); view = null; };
  function clearSelection() {
    viewSerial++; dispose(); selectedTopic = null; row = null;
    snapshots.replaceChildren(); actions.replaceChildren(); body.replaceChildren();
  }
  async function all(query, pageSize = 100) {
    const result = [];
    for (let start = 0; ; start += pageSize) {
      const response = await query().range(start, start + pageSize - 1);
      if (response.error) throw response.error;
      result.push(...(response.data || []));
      if ((response.data || []).length < pageSize) return result;
    }
  }
  async function refreshTopics() {
    if (checking || dead || !uid()) return;
    checking = true;
    const token = serial, person = actor;
    try {
      const result = await all(() => getDb().from('research_conversations')
        .select('id,title,user_id').neq('user_id', person).order('id'));
      if (!valid(token, person)) return;
      knownTopics = result;
      const old = selectedTopic?.id;
      topics.replaceChildren();
      const empty = el('option', 'Select a shared topic…', topics); empty.value = '';
      for (const topic of result) {
        const option = el('option', `${topic.title || 'Untitled topic'} · owner ${String(topic.user_id).slice(0, 8)}`, topics);
        option.value = String(topic.id);
      }
      if (old && result.some(t => String(t.id) === String(old))) topics.value = String(old);
      else if (old) { clearSelection(); status.textContent = 'Topic access ended or the topic was removed.'; }
      if (!result.length) status.textContent = 'No topics are both assigned and shared with this account.';
      else if (!selectedTopic) status.textContent = `${result.length} topics available. Select one to review.`;
    } catch (e) {
      if (valid(token, person)) { clearSelection(); topics.replaceChildren(); status.textContent = e.message; }
    } finally { checking = false; }
  }
  function draw() {
    dispose(); body.replaceChildren(); actions.replaceChildren();
    if (!selectedTopic) return;
    for (const [id, label] of [['conversation', 'Conversation'], ['summary', 'Quick summary'], ['insights', 'Conversation insights'], ['network', 'Concepts network']]) {
      const b = el('button', label, actions); b.type = 'button'; b.disabled = busyPdf;
      b.setAttribute('aria-pressed', String(tab === id));
      b.onclick = () => { tab = id; void draw(); };
    }
    const pdf = el('button', 'PDF', actions); pdf.type = 'button'; pdf.disabled = !row || busyPdf;
    pdf.onclick = exportPdf;
    if (tab === 'conversation') { void showConversation(); return; }
    if (!row) { el('p', 'No saved report is available. The owner must generate a report before its graph can be reviewed.', body); return; }
    if (tab === 'network') {
      const ticket = viewSerial, topicId = String(selectedTopic.id), person = actor;
      try {
        view = renderConceptsNetwork(row, body, {
          getDb, getSession, reviewMode: true,
          isCurrent: () => !dead && uid() === person && viewSerial === ticket &&
            String(selectedTopic?.id) === topicId && tab === 'network'
        });
      } catch (e) { el('p', e.message, body); }
    } else if (tab === 'summary') {
      for (const group of arr(row.quick_summary?.groups)) {
        el('h4', group.label, body);
        for (const evidence of arr(group.evidence)) el('blockquote', evidence.quote, body);
      }
      const other = arr(row.quick_summary?.unmatched);
      if (other.length) {
        el('h4', 'Other passages', body);
        for (const evidence of other) el('blockquote', evidence.quote, body);
      }
    } else {
      const model = arr(row.conversation_insights?.snapshots).at(-1)?.model;
      renderLatestDevelopment(row, body);
      el('p', 'AI-proposed interpretations; not verified business facts.', body);
      for (const concept of arr(model?.concepts)) {
        el('h4', `${concept.label} · ${concept.role}`, body);
        el('p', concept.definition, body);
        for (const evidence of arr(concept.evidence)) el('blockquote', `${evidence.speaker}: ${evidence.quote}`, body);
      }
      el('h4', 'Relationships', body);
      for (const edge of arr(model?.relationships)) el('p', edge.description, body);
      el('h4', 'Questions still open', body);
      for (const question of arr(model?.open_questions)) el('p', question, body);
      for (const slice of arr(row.conversation_insights?.snapshots)) {
        el('h4', `Exchange ${slice.sequence}`, body);
        for (const change of arr(slice.model?.changes)) if (change.kind !== 'unchanged') el('p', change.description, body);
      }
    }
  }
  async function showConversation() {
    const token = serial, ticket = viewSerial, person = actor, topic = selectedTopic;
    el('p', 'Loading conversation…', body);
    try {
      const turns = await all(() => getDb().from('research_turns')
        .select('id,prompt,response,status,created_at').eq('conversation_id', topic.id)
        .eq('user_id', topic.user_id).order('created_at').order('id'), 100);
      if (!valid(token, person) || ticket !== viewSerial || tab !== 'conversation') return;
      body.replaceChildren();
      el('p', 'Current conversation. Saved reports can represent an earlier exchange. Original Markdown is shown as source text.', body);
      turns.forEach((turn, index) => {
        el('h4', `Exchange ${index + 1} · ${turn.status}`, body);
        el('h5', 'Business user', body); el('p', turn.prompt, body).style.whiteSpace = 'pre-wrap';
        el('h5', 'AI assistant', body); el('p', turn.response, body).style.whiteSpace = 'pre-wrap';
      });
    } catch (e) { if (valid(token, person) && ticket === viewSerial) { body.replaceChildren(); el('p', e.message, body); } }
  }
  async function loadReport() {
    const ticket = ++viewSerial, token = serial, person = actor, topic = selectedTopic;
    dispose(); row = null; body.replaceChildren(); actions.replaceChildren();
    if (!topic || !snapshots.value) { draw(); return; }
    try {
      const response = await getDb().from('research_report_snapshots').select('*')
        .eq('id', snapshots.value).eq('conversation_id', String(topic.id)).eq('user_id', topic.user_id).single();
      if (response.error) throw response.error;
      if (!valid(token, person) || ticket !== viewSerial) return;
      row = response.data; status.textContent = 'Reviewing the selected saved report. Comments do not change the business owner’s report.'; draw();
    } catch (e) { if (valid(token, person) && ticket === viewSerial) status.textContent = e.message; }
  }
  async function chooseTopic() {
    clearSelection();
    selectedTopic = knownTopics.find(t => String(t.id) === topics.value) || null;
    if (!selectedTopic) return;
    const token = serial, person = actor, ticket = viewSerial, topic = selectedTopic;
    status.textContent = 'Loading saved reports…';
    try {
      const records = await all(() => getDb().from('research_report_snapshots')
        .select('id,revision,requested_at,created_at').eq('conversation_id', String(topic.id))
        .eq('user_id', topic.user_id).order('created_at', { ascending: false }).order('id'));
      if (!valid(token, person) || ticket !== viewSerial) return;
      for (const record of records) {
        const option = el('option', `${record.requested_at || record.created_at} · revision ${record.revision}`, snapshots);
        option.value = String(record.id);
      }
      if (records.length) await loadReport();
      else { status.textContent = 'No saved reports. You can still read the conversation.'; tab = 'conversation'; draw(); }
    } catch (e) { if (valid(token, person) && ticket === viewSerial) status.textContent = e.message; }
  }
  async function exportPdf() {
    if (!row || busyPdf) return;
    const selected = row, ticket = viewSerial, person = actor;
    const assertCurrent = () => {
      if (dead || uid() !== person || ticket !== viewSerial || row !== selected) throw new Error('The selected review changed. Export cancelled.');
    };
    let win, temp, temporaryView;
    busyPdf = true; topics.disabled = snapshots.disabled = refresh.disabled = true; actions.inert = true;
    try {
      win = createTopicPdfWindow(); assertCurrent();
      const check = await getDb().from('research_report_snapshots').select('id,revision')
        .eq('id', selected.id).eq('revision', selected.revision).single();
      if (check.error) throw check.error;
      assertCurrent();
      let svg;
      if (view) svg = view.captureForPdf().svg;
      else {
        temp = document.createElement('div'); temp.style.cssText = 'position:fixed;left:-20000px;width:1100px;visibility:hidden'; document.body.append(temp);
        temporaryView = renderConceptsNetwork(selected, temp, { exportMode: true });
        svg = temporaryView.captureForPdf().svg;
      }
      const module = await import('./concepts-network.js?v=comments-2'); assertCurrent();
      await fillTopicPdfWindow({ win, row: selected, frames: module.normalizeNetwork(selected), networkSvg: svg, assertCurrent });
      status.textContent = 'PDF generated for the selected saved report.';
    } catch (e) { showTopicPdfError(win, e.message); if (!dead && uid() === person) status.textContent = e.message; }
    finally {
      temporaryView?.destroy(); temp?.remove(); win?.__forenturePdfFrame?.remove();
      busyPdf = false; topics.disabled = snapshots.disabled = refresh.disabled = false; actions.inert = false;
    }
  }
  async function sync(force = false) {
    if (dead) return;
    const person = uid();
    if (person !== actor) {
      actor = person; serial++; lastCheck = 0; clearSelection(); topics.replaceChildren();
      knownTopics = []; container.hidden = true; status.textContent = '';
    }
    if (!person || (!force && Date.now() - lastCheck < 15000)) return;
    lastCheck = Date.now(); const token = serial;
    try {
      const assignment = await getDb().from('research_advisor_assignments')
        .select('user_id').eq('advisor_id', person).limit(1);
      if (assignment.error) throw assignment.error;
      if (!valid(token, person)) return;
      container.hidden = !assignment.data?.length;
      if (container.hidden) { clearSelection(); return; }
      if (box.open) await refreshTopics();
    } catch (e) { if (valid(token, person)) { container.hidden = true; clearSelection(); console.error('Advisor review:', e.message); } }
  }
  topics.onchange = () => void chooseTopic(); snapshots.onchange = () => void loadReport();
  refresh.onclick = () => void refreshTopics(); box.ontoggle = () => { if (box.open) void refreshTopics(); };
  const timer = setInterval(() => { if (document.visibilityState === 'visible' && !busyPdf) void sync(); }, 15000);
  void sync(true);
  return { sync: () => { void sync(); }, destroy() { dead = true; serial++; dispose(); clearInterval(timer); container.remove(); } };
}

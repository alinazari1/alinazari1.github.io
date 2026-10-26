function add(tag, text, parent) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (parent) parent.append(n);
  return n;
}
function bulletList(items, parent, empty) {
  if (!items.length) { add('p', empty, parent); return; }
  const ul = add('ul', undefined, parent);
  for (const text of items) add('li', text, ul);
}
function unique(values) {
  return [...new Set(values.filter(v => typeof v === 'string' && v.trim()))];
}
function sourceDetails(label, text, parent) {
  if (typeof text !== 'string' || !text.trim()) return;
  const d = add('details', undefined, parent);
  add('summary', label, d);
  add('blockquote', text, d);
}
function installStyles() {
  if (document.getElementById('latestDevelopmentStyles')) return;
  const style = add('style');
  style.id = 'latestDevelopmentStyles';
  style.textContent = `
  #conversationReports .latest-development {margin:24px 0 32px;padding:20px;background:#fafbf7;border:1px solid var(--border,#ddd);border-radius:12px}
  #conversationReports .latest-development .development-intro {font:14px/1.65 Arial,Helvetica,sans-serif;text-align:left}
  #conversationReports .development-flow {list-style:none;margin:20px 0 0;padding:0}
  #conversationReports .development-flow > li {position:relative;margin:0 0 26px;padding:16px 18px;border:1px solid #d6e0d9;border-left:4px solid #6b9e8c;border-radius:8px;background:#fff;text-align:left}
  #conversationReports .development-flow > li:not(:last-child)::after {content:'↓';position:absolute;bottom:-27px;left:calc(50% - 9px);height:26px;color:#547b6b;font:23px/26px Arial,sans-serif}
  #conversationReports .development-flow > li:last-child {margin-bottom:0;border-left-color:#9c8553}
  #conversationReports .development-flow h4 {margin:0 0 8px;font-size:1.05em}
  #conversationReports .development-flow p {text-align:left;margin:0 0 8px}
  #conversationReports .development-flow ul {margin:6px 0 10px;padding-left:20px}
  #conversationReports .development-flow ul li {margin-bottom:6px}
  #conversationReports .development-flow blockquote {font-size:.92em;white-space:pre-wrap;max-height:340px;overflow:auto}
  #conversationReports .development-label {font:12px/1.5 Arial,Helvetica,sans-serif;color:#64716a}
  @media(max-width:600px){#conversationReports .latest-development{padding:12px}#conversationReports .development-flow > li{padding:12px}}
  `;
  document.head.append(style);
}
export function renderLatestDevelopment(row, parent) {
  const snapshots = row?.conversation_insights?.snapshots;
  if (!Array.isArray(snapshots) || !snapshots.length) return;
  installStyles();
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const currentModel = latest.model || {};
  const previousModel = previous?.model || {};
  const concepts = Array.isArray(currentModel.concepts) ? currentModel.concepts : [];
  const previousConcepts = Array.isArray(previousModel.concepts) ? previousModel.concepts : [];
  const turns = Array.isArray(row.source_state?.turns) ? row.source_state.turns : [];
  const turnId = latest.turn_id || latest.source?.id || row.last_turn_id;
  const turn = turns.find(t => String(t.id) === String(turnId)) || latest.source || null;
  const evidenceFor = speaker => concepts.flatMap(c => Array.isArray(c.evidence) ? c.evidence : [])
    .filter(e => String(e.turn_id) === String(turnId) && e.speaker === speaker)
    .map(e => e.quote);
  const changes = Array.isArray(currentModel.changes) ? currentModel.changes : [];
  const section = add('section', undefined, parent);
  section.className = 'latest-development';
  add('h3', 'How this exchange developed your topic', section);
  const exchange = latest.sequence || snapshots.length;
  const time = turn?.created_at || latest.created_at;
  const subtitle = add('p', `Latest exchange covered by this report: ${exchange}${time ? ' · ' + new Date(time).toLocaleString() : ''}.`, section);
  subtitle.className = 'development-intro';
  const intro = add('p', 'Reconstructed from the saved conversation and AI-proposed model. This shows source-supported connections, not the assistant’s hidden reasoning or verified business facts.', section);
  intro.className = 'development-intro';
  const flow = add('ol', undefined, section);flow.className = 'development-flow';
  function card(title, label) {const li=add('li',undefined,flow);add('h4',title,li);if(label){const p=add('p',label,li);p.className='development-label';}return li;}
  const before = card('1. Before this exchange', 'Earlier model state');
  if (!previous) add('p','This is the starting point of the saved discussion. No earlier completed exchange is available.',before);
  else {
    const earlier = unique(previousConcepts.filter(c => ['goal','constraint','direction'].includes(c.role)).map(c => c.definition));
    bulletList(earlier,before,'No explicit goals, constraints, or directions were identified in the preceding model.');
    const questions = Array.isArray(previousModel.open_questions) ? previousModel.open_questions : [];
    if(questions.length){const d=add('details',undefined,before);add('summary','Questions open before this exchange',d);bulletList(questions,d,'');}
  }
  const input = card('2. What you brought to the discussion', 'Quoted user input; not automatically new evidence');
  const userQuotes = unique(evidenceFor('user'));
  if(userQuotes.length)bulletList(userQuotes,input,'');
  else add('p','The saved model contains no source-linked user passages for this exchange. Read the prompt below rather than infer what it added.',input);
  sourceDetails('Read the complete prompt',turn?.prompt,input);
  const answer = card('3. How the assistant responded', 'Quoted response passages; suggestions are not user decisions');
  const aiQuotes = unique(evidenceFor('assistant'));
  if(aiQuotes.length)bulletList(aiQuotes,answer,'');
  else add('p','The saved model contains no source-linked assistant passages for this exchange. Its specific use of assumptions has not been established.',answer);
  sourceDetails('Read the complete response',turn?.response,answer);
  const now = card('4. Where the topic stands now', 'Changes proposed by the extraction model; review against sources');
  const substantive = unique(changes.filter(c => c.kind !== 'unchanged').map(c => c.description));
  bulletList(substantive,now,'No substantive change was identified in the saved model.');
  const next = card('5. Possible next question', 'Suggestions for exploration—not commitments or validated advice');
  const questions = unique(Array.isArray(currentModel.open_questions) ? currentModel.open_questions : []);
  bulletList(questions,next,'No further question was identified. Review whether the original question has been answered.');
  const note=add('p','The cards use the existing model fields. They do not certify assumption changes or prove that a particular assumption caused an answer. Explicit assumption-to-answer tracking requires a later extraction update.',section);note.className='development-intro';
}

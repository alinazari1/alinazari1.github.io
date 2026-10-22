export function renderMyTopicsVisuals(container, evidence, options = {}) {
  container.replaceChildren();
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const style = el('style');
  style.textContent = `
    .my-topic-visuals {margin:20px 0 28px;}
    .my-topic-visuals .mtv-cards {display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:10px;}
    .my-topic-visuals .mtv-card {background:#f0f5f2;border:1px solid #d7e2dc;border-radius:10px;padding:12px;}
    .my-topic-visuals .mtv-value {font-size:1.5rem;font-weight:600;color:#245852;}
    .my-topic-visuals .mtv-label {font-size:.77rem;color:#526577;}
    .my-topic-visuals .mtv-section {margin:22px 0;padding:16px;border:1px solid var(--border,#dedfd8);border-radius:10px;}
    .my-topic-visuals .mtv-section h3 {margin:0 0 10px;font-size:1rem;}
    .my-topic-visuals .mtv-bar-row {display:grid;grid-template-columns:minmax(100px,1fr) minmax(70px,2fr) 34px;gap:10px;align-items:center;margin:9px 0;font-size:.8rem;}
    .my-topic-visuals .mtv-bar-label {overflow-wrap:anywhere;}
    .my-topic-visuals .mtv-track {height:12px;background:#e9eeea;border-radius:4px;overflow:hidden;}
    .my-topic-visuals .mtv-fill {height:100%;background:#167c80;border-radius:4px;}
    .my-topic-visuals .mtv-table-wrap {overflow-x:auto;}
    .my-topic-visuals table {width:100%;border-collapse:collapse;font-size:.8rem;}
    .my-topic-visuals caption {text-align:left;padding:8px 0;font-weight:600;}
    .my-topic-visuals th,.my-topic-visuals td {padding:8px;text-align:left;border-bottom:1px solid var(--border,#dedfd8);vertical-align:top;}
    .my-topic-visuals th {background:#f0f5f2;}
    .my-topic-visuals .mtv-note {font-size:.8rem;color:#526577;}
    .my-topic-visuals details summary {cursor:pointer;font-size:.82rem;}
  `;
  container.classList.add('my-topic-visuals');
  container.append(style);

  const seen = new Set();
  const records = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!item || !item.turn_id || !item.topic_id || seen.has(item.turn_id)) continue;
    const time = Date.parse(item.created_at);
    if (!Number.isFinite(time)) continue;
    seen.add(item.turn_id);
    records.push({ ...item, day: new Date(time).toISOString().slice(0, 10) });
  }
  if (!records.length) {
    container.append(el('p', 'No dated completed-turn references are available for charts.', 'mtv-note'));
    return;
  }
  records.sort((a,b) => a.day.localeCompare(b.day));
  const topics = new Map();
  const daily = new Map();
  for (const item of records) {
    if (!topics.has(item.topic_id)) topics.set(item.topic_id, {
      title: item.topic_title || 'Untitled conversation', count: 0, first: item.day, last: item.day
    });
    const topic = topics.get(item.topic_id);
    topic.count++;
    topic.first = topic.first < item.day ? topic.first : item.day;
    topic.last = topic.last > item.day ? topic.last : item.day;
    daily.set(item.day, (daily.get(item.day) || 0) + 1);
  }
  const sorted = [...topics.values()].sort((a,b) => b.count-a.count || a.title.localeCompare(b.title));
  const cards = el('div', undefined, 'mtv-cards');
  for (const [label,value] of [
    ['Topics analyzed',topics.size], ['Completed turns',records.length], ['Active days (UTC)',daily.size]
  ]) {
    const card = el('div', undefined, 'mtv-card');
    card.append(el('div', String(value), 'mtv-value'), el('div',label,'mtv-label'));
    cards.append(card);
  }
  container.append(cards);
  container.append(el('p',
    `Included message dates: ${records[0].day} to ${records.at(-1).day} (UTC). `+
    'Counts describe the completed turns included in this report, not all account activity. '+
    'One turn is a saved prompt with its completed AI response.', 'mtv-note'));

  function table(caption, headings, rows) {
    const wrap=el('div',undefined,'mtv-table-wrap');
    const t=el('table'); t.append(el('caption',caption));
    const head=el('thead'), hr=el('tr');
    for(const h of headings){const th=el('th',h);th.scope='col';hr.append(th);}
    head.append(hr); t.append(head);
    const body=el('tbody');
    for(const row of rows){const tr=el('tr');for(const value of row)tr.append(el('td',String(value)));body.append(tr);}
    t.append(body);wrap.append(t);return wrap;
  }
  function bars(title, rows, allRows, headers, note) {
    const section=el('section',undefined,'mtv-section');
    section.append(el('h3',title),el('p',note,'mtv-note'));
    const chart=el('div');chart.setAttribute('aria-hidden','true');
    const max=Math.max(1,...rows.map(r=>r[1]));
    for(const [label,count] of rows){
      const row=el('div',undefined,'mtv-bar-row');
      const track=el('div',undefined,'mtv-track'),fill=el('div',undefined,'mtv-fill');
      fill.style.width=`${count/max*100}%`;track.append(fill);
      row.append(el('span',String(label),'mtv-bar-label'),track,el('span',String(count)));
      chart.append(row);
    }
    section.append(chart);
    const details=el('details');details.append(el('summary','View chart data table'));
    details.append(table(title+' — source data',headers,allRows));section.append(details);
    return section;
  }
  container.append(bars('Completed turns by topic', sorted.slice(0,10).map(t=>[t.title,t.count]),
    sorted.map(t=>[t.title,t.count,t.first,t.last]),
    ['Topic','Completed turns','First included date (UTC)','Last included date (UTC)'],
    'Up to 10 most active topics are charted. The table includes all analyzed topics. Activity is not a measure of importance.'));

  const validDay=d=>typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    Number.isFinite(Date.parse(d+'T00:00:00Z')) && new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  const start=validDay(options.from)?options.from:records[0].day;
  const end=validDay(options.to)?options.to:records.at(-1).day;
  const span=Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
  let series=[];
  if(span>0 && span<=62){
    for(let n=0;n<span;n++){
      const day=new Date(Date.parse(start+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
      series.push([day,daily.get(day)||0]);
    }
  }else{
    const monthly=new Map();
    for(const [day,count] of daily){const m=day.slice(0,7);monthly.set(m,(monthly.get(m)||0)+count);}
    const monthSpan=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
    if(monthSpan>0 && monthSpan<=120){
      let y=Number(start.slice(0,4)),m=Number(start.slice(5,7));
      for(let n=0;n<monthSpan;n++){
        const key=`${y}-${String(m).padStart(2,'0')}`;series.push([key,monthly.get(key)||0]);
        if(++m===13){m=1;y++;}
      }
    }else series=[...monthly].sort((a,b)=>a[0].localeCompare(b[0]));
  }
  const dailyMode=span>0 && span<=62;
  const timeline=bars('Completed-turn activity over time',series,series,
    [dailyMode?'Day (UTC)':'Month (UTC)','Completed turns'],
    dailyMode?'Daily counts, including days with no completed turns.':
      'Monthly counts. First and last months may be partial. For ranges over 10 years, only months with activity are shown.');
  if(series.length>12){const charts=timeline.querySelector('[aria-hidden="true"]');charts.style.maxHeight='360px';charts.style.overflowY='auto';}
  container.append(timeline);
  const full=el('section',undefined,'mtv-section');
  full.append(table('Topic activity summary',
    ['Topic','Completed turns','First included date (UTC)','Last included date (UTC)'],
    sorted.map(t=>[t.title,t.count,t.first,t.last])));
  container.append(full);
}

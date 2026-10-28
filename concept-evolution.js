const NS = 'http://www.w3.org/2000/svg';
const ROLES = {
  concept: 'General', driver: 'Driver', goal: 'Goal',
  constraint: 'Constraint', direction: 'Option', outcome: 'Outcome'
};
const COLORS = ['#287b78','#b1742c','#317349','#65559a','#a54c66','#316c9b','#766225','#874e28'];
const list = v => Array.isArray(v) ? v : [];
const str = v => typeof v === 'string' ? v : '';
const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const fmt = v => valid(v) ? v.toFixed(2) : 'Unavailable';
function letters(index) {
  let n=index+1, result='';
  while(n>0){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}
  return result;
}
function el(tag,value,parent) {
  const n=document.createElement(tag);
  if(value!=null)n.textContent=String(value);
  if(parent)parent.append(n);
  return n;
}
function svg(tag,attrs,parent) {
  const n=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs||{}))n.setAttribute(k,String(v));
  if(parent)parent.append(n);
  return n;
}
function styles() {
  if(document.getElementById('ce-styles-v1'))return;
  const s=el('style');s.id='ce-styles-v1';
  s.textContent=`
.ce{margin:20px 0 4px;padding:16px;border:1px solid #dbe6dd;border-radius:10px;background:white;color:#000;font:14px/1.5 system-ui,sans-serif}
.ce h3,.ce h4{color:#172b20;margin:0 0 8px}.ce p{margin:8px 0}.ce-note{font-size:12px;color:#526459}
.ce-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
.ce button,.ce input,.ce select{font:inherit;box-sizing:border-box}
.ce button,.ce select,.ce input[type=search]{border:1px solid #b9cebf;border-radius:6px;background:white;color:#000;padding:6px 9px;max-width:100%}
.ce button{cursor:pointer}.ce button[aria-pressed=true]{background:#e5f0e8;border-color:#527f61}
.ce button:focus-visible,.ce input:focus-visible,.ce select:focus-visible,.ce [tabindex]:focus-visible{outline:3px solid #cd8d26;outline-offset:2px}
.ce-grid{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:14px;align-items:start}
.ce-plot{min-width:0;overflow-x:auto;background:#fafcfb;border:1px solid #dbe6dd;border-radius:8px}
.ce-plot>svg{display:block;width:100%;min-width:520px;height:auto;touch-action:pan-y}
.ce-series{border:1px solid #dbe6dd;border-radius:8px;padding:10px;max-height:390px;overflow:auto}
.ce-series label{display:flex;align-items:flex-start;gap:8px;margin:0;padding:6px 2px;cursor:pointer;font-size:12px;color:#000}
.ce-series input{margin-top:4px;accent-color:#317349}
.ce-swatch{display:inline-block;width:20px;height:0;border-top:3px solid;vertical-align:middle;margin-right:6px}
.ce-detail{padding:14px;margin-top:12px;border:1px solid #dbe6dd;border-radius:8px;background:#f5f9f6;overflow-wrap:anywhere}
.ce-detail blockquote{border-left:3px solid #80b491;margin:8px 0;padding:6px 10px;white-space:pre-wrap;max-height:240px;overflow:auto}
.ce-detail summary{cursor:pointer}.ce-empty{padding:12px;color:#526459}
.ce-lookup{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:10px;font-size:12px}
.ce-tablewrap{overflow:auto}.ce table{border-collapse:collapse;font-size:12px;width:100%}.ce th,.ce td{padding:6px;border-bottom:1px solid #dbe6dd;text-align:left;vertical-align:top}
.ce [hidden]{display:none!important}
@media(max-width:850px){.ce-grid{grid-template-columns:1fr}.ce-series{max-height:210px}.ce-plot>svg{min-width:480px}}
`;
  document.head.append(s);
}
export function evolutionSeries(frames) {
  const byId=new Map();
  frames.forEach((f,i)=>{
    for(const node of list(f.nodes)) {
      if(!node || typeof node.id!=='string')continue;
      if(!byId.has(node.id))byId.set(node.id,{id:node.id,index:Number.isInteger(node.layoutIndex)?node.layoutIndex:byId.size,nodes:Array(frames.length).fill(null)});
      byId.get(node.id).nodes[i]=node;
    }
  });
  return [...byId.values()].sort((a,b)=>a.index-b.index).map(s=>({...s,letter:letters(s.index),latest:s.nodes.filter(Boolean).at(-1)}));
}
export function mountConceptEvolution({ frames, container, initialIndex, onSelect }) {
  styles();
  frames=list(frames);
  const root=el('section',null,container);root.className='ce';
  el('h3','Discussion evolution',root);
  el('p','Compare concepts across saved exchanges. Select a point for its role, definition, changes, and evidence. Lines connect saved estimates; they are not continuous measurements.',root).className='ce-note';
  const series=evolutionSeries(frames),byId=new Map(series.map(s=>[s.id,s]));
  if(!frames.length||!series.length){el('p','No saved concept history is available.',root);return {setExchange(){},destroy(){root.remove();}};}
  let dead=false,mode='compare',role='all',query='';
  let focus=Number.isInteger(initialIndex)?Math.max(0,Math.min(frames.length-1,initialIndex)):frames.length-1;
  let pointId=null;
  const ranked=[...series].sort((a,b)=>{
    const av=a.nodes[focus]?.weight,bv=b.nodes[focus]?.weight;
    return (valid(bv)?bv:-1)-(valid(av)?av:-1)||a.index-b.index;
  });
  const selected=new Set(ranked.filter(s=>valid(s.nodes[focus]?.weight)).slice(0,3).map(s=>s.id));
  if(!selected.size)series.slice(0,3).forEach(s=>selected.add(s.id));
  let individual=[...selected][0]||series[0].id;
  const color=s=>COLORS[s.index%COLORS.length];
  const dash=s=>['','7 4','2 4'][Math.floor(s.index/COLORS.length)%3];
  const name=(s,i=focus)=>`${s.letter} — ${str(s.nodes[i]?.label)||str(s.latest?.label)||s.id}`;
  const controls=el('div',null,root);controls.className='ce-controls';
  const modeButtons={};
  for(const [value,label] of [['overview','Overview'],['compare','Compare selected'],['individual','Individual']]) {
    const b=el('button',label,controls);b.type='button';b.onclick=()=>{mode=value;draw();};modeButtons[value]=b;
  }
  const roleLabel=el('label',' Role at selected exchange: ',controls);
  const roleSelect=el('select',null,roleLabel);el('option','All roles',roleSelect).value='all';
  for(const [value,label] of Object.entries(ROLES))el('option',label,roleSelect).value=value;
  roleSelect.onchange=()=>{role=roleSelect.value;draw();};
  const search=el('input',null,controls);search.type='search';search.placeholder='Find a concept';search.setAttribute('aria-label','Find a concept by name or letter');
  search.oninput=()=>{query=search.value.trim().toLowerCase();draw();};
  const individualLabel=el('label',' Concept: ',controls),individualSelect=el('select',null,individualLabel);
  individualSelect.onchange=()=>{individual=individualSelect.value;pointId=individual;draw();};
  const exchangeControls=el('div',null,root);exchangeControls.className='ce-controls';
  const exchangeLabel=el('label','Selected exchange: ',exchangeControls),exchangeSelect=el('select',null,exchangeLabel);
  frames.forEach((f,i)=>{el('option',`Exchange ${f.sequence??i+1}`,exchangeSelect).value=String(i);});
  const showAll=el('button','Select all concepts',exchangeControls);showAll.type='button';
  showAll.onclick=()=>{eligible().forEach(s=>selected.add(s.id));mode='compare';draw();};
  const clear=el('button','Clear selection',exchangeControls);clear.type='button';clear.onclick=()=>{selected.clear();mode='compare';draw();};
  const status=el('p','',root);status.className='ce-note';status.setAttribute('aria-live','polite');
  const grid=el('div',null,root);grid.className='ce-grid';
  const plot=el('div',null,grid);plot.className='ce-plot';
  const checklist=el('div',null,grid);checklist.className='ce-series';checklist.setAttribute('aria-label','Concept line selection');
  const detail=el('section',null,root);detail.className='ce-detail';
  const dataDetails=el('details',null,root);el('summary','Accessible evolution data',dataDetails);
  const tableWrap=el('div',null,dataDetails);tableWrap.className='ce-tablewrap';
  el('p','Prominence is a normalized share of discussion, not business importance, probability, or progress. A lower share can result from increased attention to other concepts. Missing concepts or unavailable weights appear as gaps, not zeroes. The same saved ID is followed across exchanges; extraction identity mistakes can still affect the history.',root).className='ce-note';
  function eligible() {
    return series.filter(s=>(role==='all'||s.nodes[focus]?.role===role)&&(!query||name(s).toLowerCase().includes(query)));
  }
  function notify(id=null) {
    if(dead)return;
    if(typeof onSelect==='function')onSelect({frameIndex:focus,conceptId:id});
  }
  exchangeSelect.onchange=()=>{
    focus=Number(exchangeSelect.value);draw();notify(pointId&&byId.get(pointId)?.nodes[focus]?pointId:null);
  };
  function choose(s,i,send=true) {
    focus=i;pointId=s.id;individual=s.id;
    if(mode==='compare')selected.add(s.id);
    draw();if(send)notify(s.nodes[i]?s.id:null);
  }
  function renderDetails() {
    detail.replaceChildren();
    const s=byId.get(mode==='individual'?individual:pointId);
    if(!s){el('h4','Explore a concept',detail);el('p','Select a plotted point to view the saved interpretation and source passages for that exchange. Checkboxes only change which lines are highlighted.',detail);return;}
    const n=s.nodes[focus],before=s.nodes[focus-1];
    el('h4',`${name(s)} · Exchange ${frames[focus].sequence??focus+1}`,detail);
    if(!n){el('p','This concept was not recorded in the selected exchange. Its absence is not automatically a rejection or a zero prominence.',detail);return;}
    el('p',`Role: ${ROLES[n.role]||'Unclassified'} · Prominence: ${fmt(n.weight)}`,detail);
    if(before&&before.role!==n.role)el('p',`Previous role: ${ROLES[before.role]||'Unclassified'}. This is a change in model classification, not evidence that the user made a decision.`,detail);
    el('p',str(n.definition)||'No definition was saved.',detail);
    if(str(n.weight_reason))el('p','Prominence explanation: '+n.weight_reason,detail);
    const changes=list(frames[focus].changes).filter(c=>c.concept_id===s.id&&c.kind!=='unchanged');
    el('h4','Recorded development',detail);
    if(!changes.length)el('p','No substantive change description was saved for this concept at this exchange.',detail);
    changes.forEach(c=>el('p',`${str(c.kind)||'Change'}: ${str(c.description)||'No description saved.'}`,detail));
    if(before&&before.definition!==n.definition) {
      const d=el('details',null,detail);el('summary','Previous definition',d);el('p',str(before.definition)||'Not recorded',d);
    }
    const currentEdges=list(frames[focus].edges).filter(e=>e.from_id===s.id||e.to_id===s.id);
    const oldEdges=list(frames[focus-1]?.edges).filter(e=>e.from_id===s.id||e.to_id===s.id);
    const oldIds=new Set(oldEdges.map(e=>e.id)),newIds=new Set(currentEdges.map(e=>e.id));
    const connections=el('details',null,detail);el('summary',`Connections in this exchange (${currentEdges.length})`,connections);
    const frameNames=new Map(list(frames[focus].nodes).map(n=>[n.id,byId.has(n.id)?name(byId.get(n.id)):str(n.label)||n.id]));
    if(!currentEdges.length)el('p','No connections were saved for this concept at this exchange.',connections);
    currentEdges.forEach(e=>{
      const changed=focus>0&&!oldIds.has(e.id)?' [newly recorded]':'';
      el('p',`${frameNames.get(e.from_id)||e.from_id} ${e.directed===true?'→':'—'} ${frameNames.get(e.to_id)||e.to_id}${changed}: ${str(e.description)||str(e.type)||'No description saved.'}`,connections);
    });
    if(focus>0) {
      const absent=oldEdges.filter(e=>!newIds.has(e.id));
      if(absent.length)el('p',`${absent.length} previously recorded connection(s) are absent from this exchange. That does not establish that they were disproved.`,connections);
    }
    const evidence=el('details',null,detail);el('summary','Source passages',evidence);
    if(!list(n.evidence).length)el('p','No supporting passages were saved.',evidence);
    list(n.evidence).forEach(e=>{
      el('p',`${str(e.speaker)||'Source'} · ${e.turn_id??'turn unavailable'}`,evidence);
      el('blockquote',str(e.quote)||'Quotation unavailable',evidence);
    });
  }
  function renderTable(available) {
    tableWrap.replaceChildren();
    const table=el('table',null,tableWrap),head=el('tr',null,el('thead',null,table));
    ['Concept',...frames.map((f,i)=>`Exchange ${f.sequence??i+1}`)].forEach(h=>el('th',h,head).scope='col');
    const body=el('tbody',null,table);
    for(const s of available) {
      const tr=el('tr',null,body);el('th',name(s),tr).scope='row';
      s.nodes.forEach((n,i)=>{
        const td=el('td',null,tr);
        if(!n){td.textContent='Not recorded';return;}
        const b=el('button',`${fmt(n.weight)} · ${ROLES[n.role]||'Unclassified'}`,td);b.type='button';b.onclick=()=>choose(s,i);
      });
    }
  }
  function draw() {
    if(dead)return;
    const available=eligible();
    const solo=available.find(s=>s.id===individual);
    individualLabel.hidden=mode!=='individual';individualSelect.replaceChildren();
    available.forEach(s=>{el('option',name(s),individualSelect).value=s.id;});
    individualSelect.value=solo?individual:'';
    exchangeSelect.value=String(focus);
    for(const [key,b] of Object.entries(modeButtons))b.setAttribute('aria-pressed',String(mode===key));
    const highlighted=s=>mode==='overview'||(mode==='individual'?s.id===individual:selected.has(s.id));
    const drawn=mode==='individual'?available.filter(s=>s.id===individual):available;
    status.textContent=`Exchange ${frames[focus].sequence??focus+1} selected · ${available.length} concepts match the filters · ${drawn.filter(highlighted).length} highlighted. `+
      (mode==='overview'?'Overview shows all matching lines.':mode==='compare'?'Checked concepts are highlighted; the others stay muted.':'Individual mode shows one concept.');
    checklist.replaceChildren();
    if(!available.length)el('p','No concepts match these filters.',checklist).className='ce-empty';
    available.forEach(s=>{
      const label=el('label',null,checklist),check=el('input',null,label);check.type='checkbox';
      check.checked=mode==='overview'||(mode==='individual'?s.id===individual:selected.has(s.id));
      check.setAttribute('aria-label','Highlight '+name(s));
      check.onchange=()=>{
        if(mode==='overview'){selected.clear();available.forEach(a=>selected.add(a.id));mode='compare';}
        if(mode==='individual') {individual=s.id;pointId=s.id;}
        else if(check.checked)selected.add(s.id);else selected.delete(s.id);
        draw();
      };
      const labelText=el('span',null,label),swatch=el('i',null,labelText);swatch.className='ce-swatch';swatch.style.borderColor=highlighted(s)?color(s):'#b8c3bb';
      labelText.append(document.createTextNode(name(s)));
      const roleNode=s.nodes[focus];
      el('div',roleNode?`${ROLES[roleNode.role]||'Unclassified'} · ${fmt(roleNode.weight)}`:'Not recorded at selected exchange',labelText).className='ce-note';
    });
    plot.replaceChildren();
    const W=1040,H=450,L=80,R=100,T=32,B=72,PW=W-L-R,PH=H-T-B;
    const chart=svg('svg',{viewBox:`0 0 ${W} ${H}`,role:'group','aria-label':'Concept discussion prominence across saved exchanges','font-family':'system-ui, sans-serif'},plot);
    svg('title',{},chart).textContent='Discussion evolution. Equivalent values are in the accessible data table below.';
    const allWeights=series.flatMap(s=>s.nodes.filter(n=>n&&valid(n.weight)).map(n=>n.weight));
    const maxWeight=allWeights.length?Math.max(...allWeights):0;
    const ceiling=Math.min(1,Math.max(.1,Math.ceil(maxWeight*10)/10));
    const xp=i=>L+(frames.length>1?i/(frames.length-1)*PW:PW/2), yp=w=>T+(1-w/ceiling)*PH;
    for(let j=0;j<=4;j++) {
      const v=ceiling*j/4,y=yp(v);
      svg('line',{x1:L,y1:y,x2:W-R,y2:y,stroke:'#dbe6dd','stroke-width':1},chart);
      svg('text',{x:L-12,y:y+4,'text-anchor':'end','font-size':12,fill:'#344e3c'},chart).textContent=v.toFixed(2);
    }
    svg('text',{transform:`translate(20 ${T+PH/2}) rotate(-90)`,'text-anchor':'middle','font-size':13,fill:'#344e3c'},chart).textContent='Relative discussion prominence';
    svg('line',{x1:xp(focus),y1:T,x2:xp(focus),y2:T+PH,stroke:'#9bb7a3','stroke-dasharray':'4 4'},chart);
    const step=Math.max(1,Math.ceil(frames.length/10));
    frames.forEach((f,i)=>{
      if(i%step!==0&&i!==frames.length-1)return;
      svg('text',{x:xp(i),y:H-43,'text-anchor':'middle','font-size':12,fill:'#344e3c'},chart).textContent=String(f.sequence??i+1);
    });
    svg('text',{x:L+PW/2,y:H-13,'text-anchor':'middle','font-size':13,fill:'#344e3c'},chart).textContent='Conversation exchange';
    const sorted=[...drawn].sort((a,b)=>Number(highlighted(a))-Number(highlighted(b)));
    for(const s of sorted) {
      const active=highlighted(s),stroke=active?color(s):'#bdc8c0';
      let d='',connected=false;
      s.nodes.forEach((n,i)=>{
        if(!n||!valid(n.weight)){connected=false;return;}
        d+=`${connected?'L':'M'}${xp(i)} ${yp(n.weight)} `;connected=true;
      });
      if(!d)continue;
      const group=svg('g',{},chart);
      const path=svg('path',{d,fill:'none',stroke,'stroke-width':active?2.7:1.1,'stroke-opacity':active?1:.65,'stroke-dasharray':dash(s)},group);
      svg('title',{},path).textContent=name(s);
      s.nodes.forEach((n,i)=>{
        if(!n||!valid(n.weight))return;
        const point=svg('circle',{cx:xp(i),cy:yp(n.weight),r:active?4.5:2.8,fill:stroke,tabindex:0,role:'button',
          'aria-label':`${name(s,i)}, exchange ${frames[i].sequence??i+1}, prominence ${fmt(n.weight)}, role ${ROLES[n.role]||'Unclassified'}`},group);
        point.style.cursor='pointer';
        svg('title',{},point).textContent=`${name(s,i)} · exchange ${frames[i].sequence??i+1} · ${fmt(n.weight)} · ${ROLES[n.role]||'Unclassified'}`;
        point.onclick=()=>choose(s,i);
        point.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(s,i);}};
      });
    }
    // Spread endpoint labels without moving the plotted data.
    const endpoints=drawn.filter(highlighted).map(s=>{
      let i=s.nodes.length-1;while(i>=0&&(!s.nodes[i]||!valid(s.nodes[i].weight)))i--;
      return i<0?null:{s,i,y:yp(s.nodes[i].weight)};
    }).filter(Boolean).sort((a,b)=>a.y-b.y);
    let lastY=T-18;
    endpoints.forEach(p=>{p.labelY=Math.max(p.y,lastY+17);lastY=p.labelY;});
    if(endpoints.length) {
      const shift=Math.max(0,endpoints.at(-1).labelY-(T+PH));
      endpoints.forEach(p=>p.labelY-=shift);
    }
    endpoints.forEach(p=>{
      svg('line',{x1:xp(p.i)+5,y1:p.y,x2:W-R+12,y2:p.labelY,stroke:color(p.s),'stroke-width':.8,'stroke-opacity':.6},chart);
      const label=svg('text',{x:W-R+18,y:p.labelY+4,fill:color(p.s),'font-size':13,'font-weight':600,tabindex:0,role:'button','aria-label':'Select '+name(p.s)},chart);
      label.textContent=p.s.letter;label.style.cursor='pointer';label.onclick=()=>choose(p.s,p.i);
      label.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(p.s,p.i);}};
    });
    if(!drawn.some(s=>s.nodes.some(n=>n&&valid(n.weight))))svg('text',{x:L+PW/2,y:T+PH/2,'text-anchor':'middle','font-size':14,fill:'#526459'},chart).textContent='No recorded prominence values match this selection.';
    renderDetails();renderTable(mode==='individual'?drawn:available);
  }
  draw();
  return {
    setExchange(value) {
      if(dead||!Number.isInteger(value))return;
      const next=Math.max(0,Math.min(frames.length-1,value));
      if(next===focus)return;focus=next;draw();
    },
    destroy(){dead=true;root.remove();}
  };
}

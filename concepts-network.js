const SVG='http://www.w3.org/2000/svg';
const array=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'?x:'';
export function validWeight(x){return typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1?x:null;}
const key=e=>JSON.stringify([text(e.from_id),text(e.to_id),text(e.type)||text(e.description)]);
export function normalizeNetwork(row){
  const raw=array(row?.conversation_insights?.snapshots);
  const first=new Map(), order=new Map();
  return raw.map((s,i)=>{
    const seen=new Set();
    const nodes=array(s?.model?.concepts).filter(c=>c&&text(c.id)&&!seen.has(c.id)&&seen.add(c.id)).map(c=>{
      if(!first.has(c.id))first.set(c.id,i);
      if(!order.has(c.id))order.set(c.id,order.size);
      return {...c,label:text(c.label)||c.id,weight:validWeight(c.weight),firstIndex:first.get(c.id),layoutIndex:order.get(c.id)};
    });
    const ids=new Set(nodes.map(n=>n.id));const edgesSeen=new Set();
    const edges=array(s?.model?.relationships).filter(e=>e&&ids.has(e.from_id)&&ids.has(e.to_id)).map(e=>({...e,id:text(e.id)||key(e),weight:validWeight(e.weight)})).filter(e=>!edgesSeen.has(e.id)&&edgesSeen.add(e.id));
    return {turnId:s.turn_id,sequence:s.sequence??i+1,date:s.created_at,nodes,edges,changes:array(s?.model?.changes),weighting:s?.model?.weighting||null};
  });
}
function el(tag,value,parent){const n=document.createElement(tag);if(value!=null)n.textContent=String(value);if(parent)parent.append(n);return n;}
function svg(tag,attrs,parent){const n=document.createElementNS(SVG,tag);for(const [k,v]of Object.entries(attrs||{}))n.setAttribute(k,String(v));if(parent)parent.append(n);return n;}
const fmt=x=>x==null?'Unavailable':x.toFixed(2);
let count=0;
function styles(){if(document.getElementById('cn-styles'))return;const s=el('style');s.id='cn-styles';s.textContent=`
.cn{font:14px/1.5 system-ui,sans-serif;color:#183c2b;background:#fff;border:1px solid #d4e2d8;border-radius:12px;padding:16px;margin:16px 0}.cn h3,.cn h4{margin:0 0 10px}.cn p{margin:8px 0;text-align:left}.cn-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.cn button,.cn select{font:inherit;padding:6px 10px;border:1px solid #a8bdb0;border-radius:6px;background:white;color:#183c2b;cursor:pointer}.cn button:disabled{opacity:.4;cursor:default}.cn button:focus-visible,.cn summary:focus-visible{outline:3px solid #cd8d26}.cn-stage{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px}.cn-canvas{height:540px;overflow:hidden;background:#f5f9f6;border:1px solid #dbe6dd;border-radius:8px;touch-action:none}.cn-canvas svg{width:100%;height:100%;display:block}.cn-drawer{padding:14px;border:1px solid #dbe6dd;border-radius:8px;overflow:auto;max-height:510px;overflow-wrap:anywhere}.cn-drawer blockquote{margin:8px 0;padding:8px;border-left:3px solid #639b77;white-space:pre-wrap;font-size:13px;max-height:240px;overflow:auto}.cn-drawer dt{font-weight:600;margin-top:8px}.cn-drawer dd{margin:0}.cn-note{color:#526459;font-size:12px}.cn-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;margin:10px 0}.cn-swatch{display:inline-block;width:12px;height:12px;border:1px solid #52785e;border-radius:50%;margin-right:4px;vertical-align:middle}.cn-tablewrap{overflow:auto}.cn table{border-collapse:collapse;width:100%;font-size:13px}.cn th,.cn td{padding:7px;border-bottom:1px solid #dbe6dd;text-align:left}.cn input[type=range]{flex:1;min-width:110px}.cn-node{cursor:pointer}.cn-node:focus{outline:none}.cn-node:focus circle{stroke:#b66a00;stroke-width:4}.cn-edge{cursor:pointer}.cn-listbutton{border:0!important;padding:0!important;text-decoration:underline;background:none!important;text-align:left}.cn-tab[aria-selected=true]{background:#17643b!important;color:white!important}@media(max-width:800px){.cn-stage{grid-template-columns:1fr}.cn-canvas{height:420px}.cn-drawer{max-height:350px}}`;document.head.append(s);}
export function renderConceptsNetwork(row,container){
  styles();container.replaceChildren();const frames=normalizeNetwork(row);const root=el('section',null,container);root.className='cn';
  el('h3','Concepts network',root);
  el('p','Circle size = concept prominence. Line thickness = expressed relationship strength. Color = first appearance in the saved history. Weights are not probabilities.',root).className='cn-note';
  if(!frames.length){el('p','No concept snapshots are available for this saved report.',root);return {destroy(){root.remove();}};}
  let index=frames.length-1,comparison=true,selected=null,zoom=1,panX=0,panY=0,drag=null,moved=false;
  const positions=new Map();const allIds=[...new Set(frames.flatMap(f=>f.nodes.map(n=>n.id)))];
  // Deterministic anchors shared by all time slices; no future nodes are rendered.
  const total=allIds.length;allIds.forEach((id,i)=>{const angle=i*2.399963229728653;const radius=total<=1?0:Math.min(275,65+Math.sqrt(i)*48);positions.set(id,{x:440+Math.cos(angle)*radius,y:285+Math.sin(angle)*radius});});
  const controls=el('div',null,root);controls.className='cn-controls';
  const prev=el('button','← Previous',controls);prev.type='button';
  const timeline=el('input',null,controls);timeline.type='range';timeline.min='0';timeline.max=String(frames.length-1);timeline.value=String(index);timeline.setAttribute('aria-label','Conversation turn');
  const next=el('button','Next →',controls);next.type='button';
  const turnLabel=el('span','',controls);turnLabel.setAttribute('aria-live','polite');
  const label=el('label',null,controls);const checkbox=el('input',null,label);checkbox.type='checkbox';checkbox.checked=true;label.append(document.createTextNode(' Compare previous'));
  const legend=el('div',null,root);legend.className='cn-legend';
  for(const [color,name]of [['#e5f0e8','Earlier'],['#80b491','More recent'],['#17643b','New in selected turn'],['#e8e8e8','Weight unavailable (dashed)']]){const span=el('span',null,legend),dot=el('i',null,span);dot.className='cn-swatch';dot.style.background=color;span.append(document.createTextNode(name));}
  const summary=el('p','',root);summary.className='cn-note';summary.setAttribute('aria-live','polite');
  const stage=el('div',null,root);stage.className='cn-stage';const canvas=el('div',null,stage);canvas.className='cn-canvas';
  const drawing=svg('svg',{viewBox:'0 0 880 570',role:'img','aria-label':'Concept relationship network. Equivalent concept and relationship tables follow.'},canvas);
  const uid='cn-arrow-'+(++count);const defs=svg('defs',{},drawing),marker=svg('marker',{id:uid,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'},defs);svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#a3aaa6'},marker);
  const world=svg('g',{},drawing);const drawer=el('aside',null,stage);drawer.className='cn-drawer';drawer.setAttribute('aria-label','Selected concept or relationship');drawer.setAttribute('aria-live','polite');
  const tools=el('div',null,root);tools.className='cn-controls';
  for(const [name,fn] of [['Zoom in',()=>{zoom=Math.min(3,zoom*1.2);transform();}],['Zoom out',()=>{zoom=Math.max(.45,zoom/1.2);transform();}],['Reset view',()=>{zoom=1;panX=panY=0;transform();}]]){const b=el('button',name,tools);b.type='button';b.onclick=fn;}
  el('span','Drag the background to pan. Select a circle or line for evidence.',tools).className='cn-note';
  const details=el('details',null,root);el('summary','Accessible data tables',details);const tables=el('div',null,details);tables.className='cn-tablewrap';
  function transform(){world.setAttribute('transform',`translate(${panX} ${panY}) translate(440 285) scale(${zoom}) translate(-440 -285)`);}
  function nodeColor(n){if(n.firstIndex===index)return '#17643b';const t=index? n.firstIndex/index:0;return t>.55?'#80b491':'#e5f0e8';}
  function radius(n){return n.weight===null?24:18+30*Math.sqrt(n.weight);}
  function stat(dl,k,v){el('dt',k,dl);el('dd',v,dl);}
  function showEvidence(item){
    const evidence=array(item.evidence);if(!evidence.length){el('p','No source-linked passages were saved for this item.',drawer);return;}
    el('h4','Supporting passages',drawer);
    for(const e of evidence){const d=el('details',null,drawer);el('summary',`${text(e.speaker)||'Source'} · ${e.turn_id??'turn unavailable'}`,d);el('blockquote',text(e.quote)||'Quotation unavailable',d);
      const source=array(row?.source_state?.turns).find(t=>String(t.id)===String(e.turn_id));const content=e.speaker==='user'?source?.prompt:e.speaker==='assistant'?source?.response:null;
      if(typeof content==='string'){const full=el('details',null,d);el('summary','Full source message',full);el('blockquote',content,full);}
    }
  }
  function inspect(kind,id){
    selected={kind,id};drawer.replaceChildren();const f=frames[index],before=frames[index-1];
    const item=(kind==='node'?f.nodes:f.edges).find(x=>x.id===id);if(!item){el('p','This item is not present in the selected turn.',drawer);return;}
    el('h4',kind==='node'?item.label:(text(item.type)||'Relationship'),drawer);
    if(kind==='edge'){const names=new Map(f.nodes.map(n=>[n.id,n.label]));el('p',`${names.get(item.from_id)} → ${names.get(item.to_id)}`,drawer);}
    el('p',text(item.definition)||text(item.description)||'No description saved.',drawer);
    const dl=el('dl',null,drawer);stat(dl,'Current weight',fmt(item.weight));
    const old=(kind==='node'?before?.nodes:before?.edges)?.find(x=>x.id===id);
    if(comparison&&before){stat(dl,'Previous weight',fmt(old?.weight));if(old?.weight!=null&&item.weight!=null){const delta=item.weight-old.weight;stat(dl,'Change',(delta>=0?'+':'')+delta.toFixed(2));}}
    if(kind==='node')stat(dl,'First recorded appearance',`Exchange ${frames[item.firstIndex].sequence}`);
    stat(dl,'Weight explanation',text(item.weight_reason)||'Not saved');
    stat(dl,'Weighting method',text(f.weighting?.method)||'Not recorded');
    stat(dl,'Extraction confidence (separate)',fmt(validWeight(item.extraction_confidence)));
    stat(dl,'Review',text(item.review_status)||'Not recorded');
    if(kind==='node'&&old&&old.definition!==item.definition){el('h4','Previous definition',drawer);el('p',text(old.definition)||'Not saved',drawer);}
    for(const c of f.changes.filter(c=>c.concept_id===id)){el('p',`${c.kind||'Change'}: ${c.description||''}`,drawer);}
    showEvidence(item);
  }
  function addTable(title,headers,items,kind){el('h4',title,tables);const table=el('table',null,tables);const head=el('tr',null,el('thead',null,table));headers.forEach(h=>el('th',h,head).scope='col');const body=el('tbody',null,table);
    const names=new Map(frames[index].nodes.map(n=>[n.id,n.label]));
    items.forEach(item=>{const tr=el('tr',null,body),td=el('td',null,tr);const b=el('button',kind==='node'?item.label:`${names.get(item.from_id)} → ${names.get(item.to_id)}`,td);b.className='cn-listbutton';b.type='button';b.onclick=()=>inspect(kind,item.id);el('td',fmt(item.weight),tr);el('td',kind==='node'?`Exchange ${frames[item.firstIndex].sequence}`:text(item.type)||text(item.description)||'Unspecified',tr);});
  }
  function draw(){
    timeline.value=String(index);prev.disabled=index===0;next.disabled=index===frames.length-1;checkbox.disabled=index===0;turnLabel.textContent=`Exchange ${frames[index].sequence} of ${frames.length} saved slices`;
    const f=frames[index],before=frames[index-1],oldNodes=new Map((before?.nodes||[]).map(n=>[n.id,n])),oldEdges=new Map((before?.edges||[]).map(e=>[e.id,e]));
    const missing=f.nodes.filter(n=>n.weight==null).length+f.edges.filter(e=>e.weight==null).length;
    const absent=before?before.nodes.filter(n=>!f.nodes.some(c=>c.id===n.id)).length:0;
    summary.textContent=`${f.nodes.length} concepts · ${f.edges.length} connections. ${missing} weights unavailable.${comparison&&before?` ${absent} previous concepts absent from this slice (not automatically rejected).`:''} Newness is relative to supplied history. Model-proposed relationships are not proven causality.`;
    world.replaceChildren();const nodesById=new Map(f.nodes.map(n=>[n.id,n]));
    for(const e of f.edges){
      const a=positions.get(e.from_id),b=positions.get(e.to_id),g=svg('g',{'class':'cn-edge'},world),old=oldEdges.get(e.id),fresh=comparison&&before&&!old;
     
      const attrs = {
        stroke: '#a3aaa6',
        'stroke-width': e.weight == null
          ? 0.8
          : 0.6 + 1.4 * e.weight,
        fill: 'none'
      };
      if(e.weight==null)attrs['stroke-dasharray']='5 5';
      if(e.directed===true)attrs['marker-end']=`url(#${uid})`;
      const self=e.from_id===e.to_id;let line;
      if(self){const r=radius(nodesById.get(e.from_id));const d=`M ${a.x-r*.6} ${a.y-r*.7} C ${a.x-95} ${a.y-110},${a.x+95} ${a.y-110},${a.x+r*.6} ${a.y-r*.7}`;line=svg('path',{d,...attrs},g);svg('path',{d,stroke:'transparent','stroke-width':18,fill:'none'},g);}
      else {const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,ra=radius(nodesById.get(e.from_id))+3,rb=radius(nodesById.get(e.to_id))+5;const coords={x1:a.x+dx/len*ra,y1:a.y+dy/len*ra,x2:b.x-dx/len*rb,y2:b.y-dy/len*rb};line=svg('line',{...coords,...attrs},g);svg('line',{...coords,stroke:'transparent','stroke-width':18},g);}
      svg('title',{},line).textContent=`${e.type||e.description||'Relationship'} · weight ${fmt(e.weight)}`;
      const label=svg('text',{x:(a.x+b.x)/2,y:self?a.y-95:(a.y+b.y)/2-5,'text-anchor':'middle','font-size':10,fill:'#264d36','paint-order':'stroke',stroke:'#f5f9f6','stroke-width':3,'pointer-events':'none'},g);label.textContent=`${text(e.type)||'related'} · ${e.weight==null?'?':e.weight.toFixed(2)}`;
      g.onclick=()=>{if(!moved)inspect('edge',e.id);};
    }
    for(const n of f.nodes){const p=positions.get(n.id),r=radius(n),old=oldNodes.get(n.id);const changed=comparison&&old&&(old.weight!==n.weight||old.definition!==n.definition||f.changes.some(c=>c.concept_id===n.id&&c.kind!=='unchanged'));
      const g=svg('g',{transform:`translate(${p.x} ${p.y})`,tabindex:0,role:'button','aria-label':`${n.label}, weight ${fmt(n.weight)}, first recorded exchange ${frames[n.firstIndex].sequence}`,'class':'cn-node'},world);

      g.setAttribute('data-concept-id', n.id);
      g.style.cursor = 'grab';
      if(changed)svg('circle',{r:r+5,fill:'none',stroke:'#17643b','stroke-width':2},g);


                            
      svg('circle',{r,fill:nodeColor(n),stroke:'#52785e','stroke-width':1.5,...(n.weight==null?{'stroke-dasharray':'4 3'}:{})},g);
      const number=svg('text',{'text-anchor':'middle',y:5,'font-size':12,fill:n.firstIndex===index?'white':'#183c2b'},g);number.textContent=n.weight==null?'?':n.weight.toFixed(2);
      const label=svg('text',{'text-anchor':'middle',y:r+19,'font-size':12,fill:'#183c2b','paint-order':'stroke',stroke:'#f5f9f6','stroke-width':3},g);label.textContent=n.label.length>30?n.label.slice(0,28)+'…':n.label;
      if(n.firstIndex===index||changed){const badge=svg('text',{'text-anchor':'middle',y:r+34,'font-size':10,fill:'#17643b'},g);badge.textContent=n.firstIndex===index?'NEW':'UPDATED';}
      svg('title',{},g).textContent=n.label;g.onclick = null;g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect('node',n.id);}};
    }
    transform();tables.replaceChildren();addTable('Concepts',['Concept','Weight','First recorded'],f.nodes,'node');addTable('Relationships',['Connection','Weight','Relationship'],f.edges,'edge');
    if(selected)inspect(selected.kind,selected.id);else{drawer.replaceChildren();el('h4','Explore the topic',drawer);el('p','Select a concept or connection to see its weight, changes, and saved evidence. Use the timeline to move between turns.',drawer);}
  }
  function goto(i){index=Math.max(0,Math.min(frames.length-1,i));draw();}
  prev.onclick=()=>goto(index-1);next.onclick=()=>goto(index+1);timeline.oninput=()=>goto(Number(timeline.value));checkbox.onchange=()=>{comparison=checkbox.checked;draw();};
  
  // Convert screen coordinates into SVG coordinates.
  // Using the inverse transform keeps dragging accurate after zoom/pan.
  function pointerPosition(event, element) {
    const matrix = element.getScreenCTM();
  
    if (!matrix) return null;
  
    const point = drawing.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
  
    return point.matrixTransform(matrix.inverse());
  }
  
  drawing.onpointerdown = event => {
    if (event.button !== 0 || drag) return;
  
    const node = event.target.closest?.('.cn-node');
    const conceptId = node?.getAttribute('data-concept-id');
    const position = conceptId ? positions.get(conceptId) : null;
  
    const point = pointerPosition(
      event,
      position ? world : drawing
    );
  
    if (!point) return;
  
    moved = false;
  
    drag = {
      pointerId: event.pointerId,
      kind: position ? 'node' : 'background',
      conceptId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: point.x,
      startY: point.y,
      originalX: position ? position.x : panX,
      originalY: position ? position.y : panY
    };
  
    // Keep receiving movement even if the pointer leaves a circle.
    //drawing.setPointerCapture(event.pointerId);
  };
  
  drawing.onpointermove = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
  
    const distance =
      Math.abs(event.clientX - drag.startClientX) +
      Math.abs(event.clientY - drag.startClientY);
  
    // A small movement still counts as a click.
    if (!moved && distance <= 5) return;
    
    // Capture only after movement passes the drag threshold.
    // A normal click remains targeted at the circle.
    if (!moved) {
      drawing.setPointerCapture(event.pointerId);
    }
    
    moved = true;
    event.preventDefault();
    
    const point = pointerPosition(
      event,
      drag.kind === 'node' ? world : drawing
    );
  
    if (!point) return;
  
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
  
    if (drag.kind === 'node') {
      const position = positions.get(drag.conceptId);
  
      if (!position) return;
  
      position.x = drag.originalX + dx;
      position.y = drag.originalY + dy;
  
      // Redraw circles, labels, and their connections together.
      draw();
    } else {
      panX = drag.originalX + dx;
      panY = drag.originalY + dy;
      transform();
    }
  };
  
    const end = event => {
      if (!drag) return;
    
      if (
        event?.pointerId !== undefined &&
        event.pointerId !== drag.pointerId
      ) {
        return;
      }
    
      const finished = drag;
    
      // Only a normal release without dragging opens details.
      // Cancellation or lost capture must not open anything.
      const openDetails =
        event?.type === 'pointerup' &&
        finished.kind === 'node' &&
        !moved;
    
      drag = null;
    
      if (drawing.hasPointerCapture(finished.pointerId)) {
        drawing.releasePointerCapture(finished.pointerId);
      }
    
      if (openDetails) {
        inspect('node', finished.conceptId);
      }
    };
  
  window.addEventListener('pointerup', end);
  drawing.onpointercancel = end;
  drawing.onlostpointercapture = end;

  
  draw();return {destroy(){window.removeEventListener('pointerup',end);root.remove();}};
}
/** Mount beside a shared report panel. Call update(row) whenever the selected report changes. */
export function mountConceptsNetwork({tabBar,existingPanel,getRow}){
  if(!(tabBar instanceof Element)||!(existingPanel instanceof Element)||typeof getRow!=='function')throw new Error('Supply tabBar, existingPanel, and getRow().');
  styles();const existingTabs=[...tabBar.querySelectorAll('button')];const button=el('button','Concepts network',tabBar);button.type='button';button.className='cn-tab';button.setAttribute('aria-selected','false');
  const panel=el('section');panel.hidden=true;existingPanel.after(panel);let view=null,active=false;
  const render=row=>{view?.destroy();view=renderConceptsNetwork(row,panel);};
  const onExisting=()=>{active=false;panel.hidden=true;existingPanel.hidden=false;button.setAttribute('aria-selected','false');};
  existingTabs.forEach(t=>t.addEventListener('click',onExisting));
  button.onclick=()=>{const row=getRow();if(!row){panel.replaceChildren();el('p','Select or generate a saved report first.',panel);}else render(row);active=true;panel.hidden=false;existingPanel.hidden=true;button.setAttribute('aria-selected','true');};
  return {update(row){if(active)render(row);},destroy(){view?.destroy();existingTabs.forEach(t=>t.removeEventListener('click',onExisting));button.remove();panel.remove();existingPanel.hidden=false;}};
}

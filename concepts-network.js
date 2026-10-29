import {
  createGraphDiscussion
} from './graph-discussion.js?v=comments-1';

import {
  mountConceptEvolution
} from './concept-evolution.js?v=evolution-1';

import {
  attachAccountLayout
} from './network-layout-store.js?v=save-icon-1';

const SVG = 'http://www.w3.org/2000/svg';
const array = x => Array.isArray(x) ? x : [];
const text = x => typeof x === 'string' ? x : '';
const ROLE_INFO = {
  concept: {label:'GENERAL', meaning:'A general topic or element of the situation'},
  driver: {label:'DRIVER', meaning:'A factor that may influence the decision'},
  goal: {label:'GOAL', meaning:'Something the user wants to achieve'},
  constraint: {label:'CONSTRAINT', meaning:'A limit or requirement'},
  direction: {label:'OPTION', meaning:'A possible course of action'},
  outcome: {label:'OUTCOME', meaning:'A possible, expected, or reported result'}
};
function roleInfo(role) {
  return ROLE_INFO[role] || {label:'UNCLASSIFIED', meaning:'No recognized role was recorded'};
}
function conceptLetter(index) {
  let value=index+1, result='';
  while(value>0) {
    value--;
    result=String.fromCharCode(65+value%26)+result;
    value=Math.floor(value/26);
  }
  return result;
}
function conceptName(n) { return `${conceptLetter(n.layoutIndex)} — ${n.label}`; }
export function validWeight(x) {
  return typeof x==='number' && Number.isFinite(x) && x>=0 && x<=1 ? x : null;
}
const edgeKey = e => JSON.stringify([text(e.from_id),text(e.to_id),text(e.type)||text(e.description)]);
export function normalizeNetwork(row) {
  const first=new Map(), order=new Map();
  return array(row?.conversation_insights?.snapshots).map((s,i)=>{
    const seen=new Set();
    const nodes=array(s?.model?.concepts)
      .filter(c=>c && text(c.id) && !seen.has(c.id) && seen.add(c.id))
      .map(c=>{
        if(!first.has(c.id)) first.set(c.id,i);
        if(!order.has(c.id)) order.set(c.id,order.size);
        return {...c,label:text(c.label)||c.id,weight:validWeight(c.weight),
          firstIndex:first.get(c.id),layoutIndex:order.get(c.id)};
      });
    const ids=new Set(nodes.map(n=>n.id)), edgesSeen=new Set();
    const edges=array(s?.model?.relationships)
      .filter(e=>e && ids.has(e.from_id) && ids.has(e.to_id))
      .map(e=>({...e,id:text(e.id)||edgeKey(e),weight:validWeight(e.weight)}))
      .filter(e=>!edgesSeen.has(e.id) && edgesSeen.add(e.id));
    return {turnId:s.turn_id,sequence:s.sequence??i+1,date:s.created_at,nodes,edges,
      changes:array(s?.model?.changes),weighting:s?.model?.weighting||null};
  });
}
function el(tag,value,parent) {
  const n=document.createElement(tag);
  if(value!=null) n.textContent=String(value);
  if(parent) parent.append(n);
  return n;
}
function svg(tag,attrs,parent) {
  const n=document.createElementNS(SVG,tag);
  for(const [k,v] of Object.entries(attrs||{})) n.setAttribute(k,String(v));
  if(parent) parent.append(n);
  return n;
}
const fmt=x=>x==null?'Unavailable':x.toFixed(2);
let count=0;
function styles() {
  if(document.getElementById('cn-styles-interactive-v1')) return;
  const s=el('style'); s.id='cn-styles-interactive-v1';
  s.textContent=`
.cn{font:14px/1.5 system-ui,sans-serif;color:#183c2b;background:#fff;border:1px solid #d4e2d8;border-radius:12px;padding:16px;margin:16px 0}
.cn h3,.cn h4{margin:0 0 10px}.cn p{margin:8px 0;text-align:left}
.cn-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
.cn button,.cn select{font:inherit;padding:6px 10px;border:1px solid #a8bdb0;border-radius:6px;background:#fff;color:#183c2b;cursor:pointer}
.cn button:disabled{opacity:.4;cursor:default}
.cn button:focus-visible,.cn summary:focus-visible,.cn-canvas:focus-visible{outline:3px solid #cd8d26;outline-offset:2px}
.cn-stage{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:14px}
.cn-canvas{position:relative;height:540px;min-width:0;overflow:hidden;background:#f5f9f6;border:1px solid #dbe6dd;border-radius:8px;touch-action:none;user-select:none;-webkit-user-select:none}
.cn-canvas>svg{width:100%;height:100%;display:block;touch-action:none}
.cn-drawer{padding:14px;border:1px solid #dbe6dd;border-radius:8px;overflow:auto;max-height:510px;overflow-wrap:anywhere}
.cn-drawer blockquote{margin:8px 0;padding:8px;border-left:3px solid #639b77;white-space:pre-wrap;font-size:13px;max-height:240px;overflow:auto}
.cn-drawer dt{font-weight:600;margin-top:8px}.cn-drawer dd{margin:0}
.cn-note{color:#526459;font-size:12px}
.cn-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;margin:10px 0}
.cn-swatch{display:inline-block;width:12px;height:12px;border:1px solid #52785e;border-radius:50%;margin-right:4px;vertical-align:middle}
.cn-tablewrap{overflow:auto}.cn table{border-collapse:collapse;width:100%;font-size:13px}
.cn th,.cn td{padding:7px;border-bottom:1px solid #dbe6dd;text-align:left;vertical-align:top}
.cn input[type=range]{flex:1;min-width:110px}.cn-node{cursor:grab}.cn-node:focus{outline:none}
.cn-node:focus circle{stroke:#b66a00;stroke-width:4}.cn-edge{cursor:pointer}
.cn-listbutton{border:0!important;padding:0!important;text-decoration:underline;background:none!important;text-align:left}
.cn-tab[aria-selected=true]{background:#17643b!important;color:#fff!important}
.cn-role-legend{margin:12px 0;padding:12px;background:#f5f9f6;border:1px solid #dbe6dd;border-radius:8px}
.cn-role-legend>strong{display:block;margin-bottom:8px;font-size:12px;font-weight:600}
.cn-role-items{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px}
.cn-role-item{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#000}
.cn-role-pill{display:inline-block;flex:0 0 auto;padding:2px 7px;border:1px solid #b9cebf;border-radius:999px;background:#e5f0e8;color:#000;font-size:10px;font-weight:600;letter-spacing:.03em}
.cn-iconbar,.cn-popup{position:absolute;display:flex;gap:4px;align-items:center;padding:5px;background:rgba(255,255,255,.97);border:1px solid #b9cebf;border-radius:10px;box-shadow:0 2px 10px #183c2b18;z-index:2}
.cn-iconbar{right:10px;top:10px}.cn-popup{z-index:3}.cn-popup[hidden]{display:none!important}
.cn .cn-iconbutton{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:10px;border:0;border-radius:7px;background:transparent;color:#000}
.cn .cn-iconbutton:hover{background:#e5f0e8}.cn-iconbutton svg{display:block;width:22px;height:22px;pointer-events:none}
@media(max-width:800px){.cn-stage{grid-template-columns:1fr}.cn-canvas{height:420px}.cn-drawer{max-height:350px}}
`;
  document.head.append(s);
}
function makeIcon(name,parent) {
  const icon=svg('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',
    'stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},parent);
  if(name==='in'||name==='out') {
    svg('circle',{cx:10,cy:10,r:6.5},icon);
    svg('path',{d:'M15 15l5.5 5.5 M7 10h6'},icon);
    if(name==='in') svg('path',{d:'M10 7v6'},icon);
  } else if(name==='reset') {
    svg('path',{d:'M4 9a8 8 0 1 1-.2 6 M4 3v6h6'},icon);
  } else {
    svg('path',{d:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5'},icon);
  }
}

export function renderConceptsNetwork(row,container,options = {}) {
  styles(); container.replaceChildren();
  const frames=normalizeNetwork(row), root=el('section',null,container); root.className='cn';
  el('h3','Concepts network',root);
  el('p','Letters identify concepts within the saved timeline. Circle size = discussion prominence. Line thickness = expressed relationship strength. Green shade = first appearance. Weights are not probabilities.',root).className='cn-note';
  if(!frames.length) {
    el('p','No concept snapshots are available for this saved report.',root);
    return {destroy(){root.remove();}};
  }
  let index=frames.length-1, comparison=true, selected=null;
  let zoom=1, panX=0, panY=0, destroyed=false, exporting=false;
  let accountLayout = null;
  let evolutionView = null;
  let pdfCapturing = false;
  let inspectedKey = null;
  let drag=null, pinch=null, suppressTap=false;
  const pointers=new Map(), positions=new Map();
  const allIds=[...new Set(frames.flatMap(f=>f.nodes.map(n=>n.id)))];
  allIds.forEach((id,i)=>{
    const angle=i*2.399963229728653;
    const radius=allIds.length<=1?0:Math.min(275,65+Math.sqrt(i)*48);
    positions.set(id,{x:440+Math.cos(angle)*radius,y:285+Math.sin(angle)*radius});
  });
  const controls=el('div',null,root); controls.className='cn-controls';
  const prev=el('button','← Previous',controls); prev.type='button';
  const timeline=el('input',null,controls); timeline.type='range'; timeline.min='0';
  timeline.max=String(frames.length-1); timeline.value=String(index);
  timeline.setAttribute('aria-label','Conversation turn');
  const next=el('button','Next →',controls); next.type='button';
  const turnLabel=el('span','',controls); turnLabel.setAttribute('aria-live','polite');
  const compareLabel=el('label',null,controls), checkbox=el('input',null,compareLabel);
  checkbox.type='checkbox'; checkbox.checked=true;
  compareLabel.append(document.createTextNode(' Compare previous'));
  const legend=el('div',null,root); legend.className='cn-legend';
  for(const [color,name] of [['#e5f0e8','Earlier'],['#80b491','More recent'],['#17643b','New in selected turn'],['#e8e8e8','Weight unavailable (dashed)']]) {
    const span=el('span',null,legend), dot=el('i',null,span);
    dot.className='cn-swatch'; dot.style.background=color;
    span.append(document.createTextNode(name));
  }
  const roleLegend=el('div',null,root); roleLegend.className='cn-role-legend';
  roleLegend.setAttribute('aria-label','Concept role legend');
  el('strong','Concept roles',roleLegend);
  const roleItems=el('div',null,roleLegend); roleItems.className='cn-role-items';
  for(const info of Object.values(ROLE_INFO)) {
    const item=el('div',null,roleItems); item.className='cn-role-item';
    el('span',info.label,item).className='cn-role-pill'; el('span',info.meaning,item);
  }
  el('p','Roles are AI-proposed interpretations. An option is not necessarily a decision, and an outcome is not necessarily achieved.',roleLegend).className='cn-note';
  const summary=el('p','',root); summary.className='cn-note'; summary.setAttribute('aria-live','polite');
  const stage=el('div',null,root); stage.className='cn-stage';
  const canvas=el('div',null,stage); canvas.className='cn-canvas'; canvas.tabIndex=0;
  canvas.setAttribute(
    'aria-label',
    'Interactive network. Drag to pan, pinch to zoom, or use the corner toolbar.'
  );
  const drawing=svg('svg',{viewBox:'0 0 880 570','font-family':'system-ui, sans-serif',
    role:'group','aria-label':'Concept relationship network. Equivalent data tables follow.'},canvas);
  const uid='cn-arrow-'+(++count), defs=svg('defs',{},drawing);
  const marker=svg('marker',{id:uid,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'},defs);
  svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#a3aaa6'},marker);
  const world=svg('g',{},drawing);
  const drawer = el('aside', null, stage);

  drawer.className = 'cn-drawer';

  drawer.setAttribute(
    'aria-label',
    'Selected concept or relationship'
  );

  const review = options.exportMode
    ? null
    : createGraphDiscussion({
        row,
        options,

        onCountsChanged() {
          refreshCommentBadges();
        }
      });
  const toolbar=el('div',null,canvas); toolbar.className='cn-iconbar';
  toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','Network tools');
  const popup=el('div',null,canvas); popup.className='cn-popup'; popup.hidden=true;
  popup.setAttribute('role','group'); popup.setAttribute('aria-label','Network popup tools');
  const exportButtons=[];
  const exportStatus=el('p','',root); exportStatus.className='cn-note';
  exportStatus.setAttribute('role','status'); exportStatus.setAttribute('aria-live','polite');
  el('p','Drag a circle to move it. Drag empty space to pan. Pinch with two fingers to zoom. Tap empty space for tools. Reset view keeps your moved node positions. Save image captures the visible graph only.',root).className='cn-note';
  const details=el('details',null,root); el('summary','Accessible data tables',details);
  const tables=el('div',null,details); tables.className='cn-tablewrap';
  function closePopup(){popup.hidden=true;}
  function transform() {
    world.setAttribute('transform',`translate(${panX} ${panY}) translate(440 285) scale(${zoom}) translate(-440 -285)`);
    if (!pdfCapturing) {
      accountLayout?.changed();
}
  }
  function svgPoint(clientX,clientY,element=drawing) {
    const matrix=element.getScreenCTM(); if(!matrix) return null;
    const p=drawing.createSVGPoint(); p.x=clientX; p.y=clientY;
    return p.matrixTransform(matrix.inverse());
  }
  function zoomAt(value,point={x:440,y:285}) {
    const target=Math.max(.45,Math.min(3,value));
    const wx=(point.x-440-panX)/zoom+440, wy=(point.y-285-panY)/zoom+285;
    zoom=target;
    panX=point.x-440-zoom*(wx-440); panY=point.y-285-zoom*(wy-285);
    transform();
  }
  function resetView(){closePopup();zoom=1;panX=0;panY=0;transform();}
  function showPopup(clientX,clientY) {
    closePopup();
  }

    function captureForPdf() {
    if (destroyed) {
      throw new Error('The network has been closed.');
    }

    if (root.inert && !options.exportMode) {
      throw new Error(
        'Wait for your account layout to finish loading, ' +
        'then export again.'
      );
    }

    const previousIndex = index;
    const previousSelected = selected;

    pdfCapturing = true;

    try {
      cancelGestures();
      closePopup();

      index = frames.length - 1;
      selected = null;

      draw();

      const bounds = world.getBBox();
      const padding = 32;

      const clone = drawing.cloneNode(true);
      const clonedWorld = clone.querySelector('g');

      if (!clonedWorld) {
        throw new Error('The network drawing was not found.');
      }

      // Fit all nodes while retaining their actual positions.
      clonedWorld.removeAttribute('transform');

      const x = bounds.width
        ? bounds.x - padding
        : 0;

      const y = bounds.height
        ? bounds.y - padding
        : 0;

      const width = bounds.width
        ? bounds.width + padding * 2
        : 880;

      const height = bounds.height
        ? bounds.height + padding * 2
        : 570;

      clone.setAttributeNS(
        'http://www.w3.org/2000/xmlns/',
        'xmlns',
        SVG
      );

      clone.setAttribute(
        'viewBox',
        `${x} ${y} ${width} ${height}`
      );

      clone.setAttribute('width', String(width));
      clone.setAttribute('height', String(height));

      clone.setAttribute(
        'preserveAspectRatio',
        'xMidYMid meet'
      );

      const background = document.createElementNS(
        SVG,
        'rect'
      );

      for (const [key, value] of Object.entries({
        x,
        y,
        width,
        height,
        fill: '#ffffff'
      })) {
        background.setAttribute(key, String(value));
      }

      clone.insertBefore(background, clone.firstChild);

      clone.querySelectorAll('[tabindex]').forEach(
        node => node.removeAttribute('tabindex')
      );

      clone.querySelectorAll(
        '[paint-order="stroke"]'
      ).forEach(node => {
        node.setAttribute('stroke', '#ffffff');
      });

      return {
        svg: new XMLSerializer().serializeToString(clone),
        reportId: String(row.id),
        revision: row.revision,
        sourceFingerprint: row.source_fingerprint
      };
    } finally {
      index = previousIndex;
      selected = previousSelected;

      try {
        draw();
      } finally {
        pdfCapturing = false;
        refreshCommentBadges();
      }
    }
  }
  function downloadBlob(blob,name) {
    const url=URL.createObjectURL(blob), link=el('a');
    link.href=url;link.download=name;link.style.display='none';document.body.append(link);
    link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  async function saveImage() {
    if(exporting||destroyed) return;
    closePopup();exporting=true;exportButtons.forEach(b=>b.disabled=true);
    exportStatus.textContent='Preparing network image…';
    let url=null;
    try {
      const frame=frames[index], clone=drawing.cloneNode(true);
      clone.querySelectorAll(
        '.cn-comment-badge'
      ).forEach(badge => badge.remove());
            // Change label outlines only in the exported copy.
      clone.querySelectorAll('[paint-order="stroke"]')
        .forEach(label => {
          label.setAttribute('stroke', '#ffffff');
        });
      const rect=drawing.getBoundingClientRect();
      const width=Math.max(1,Math.round(rect.width)), height=Math.max(1,Math.round(rect.height));
      clone.setAttributeNS('http://www.w3.org/2000/xmlns/','xmlns',SVG);clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
      clone.querySelectorAll('[tabindex]').forEach(n=>n.removeAttribute('tabindex'));
      const serialized=new XMLSerializer().serializeToString(clone);
      const blob=new Blob([serialized],{type:'image/svg+xml;charset=utf-8'});
      url=URL.createObjectURL(blob);
      const image=new Image();
      await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(new Error('The SVG could not be rendered as an image.'));
        image.src=url;
      });
      if(destroyed) return;
      const output=document.createElement('canvas');
      const scale=Math.min(2,4096/Math.max(width,height));
      output.width=Math.max(1,Math.round(width*scale));output.height=Math.max(1,Math.round(height*scale));
      const ctx=output.getContext('2d');if(!ctx) throw new Error('Image rendering is unavailable.');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,output.width,output.height);
      ctx.drawImage(image,0,0,output.width,output.height);
      const png=await new Promise((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(new Error('PNG generation failed.')),'image/png'));
      if(destroyed) return;
      const title=text(row?.source_state?.title)||'topic';
      const safe=title.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,70)||'topic';
      downloadBlob(png,`${safe}-network-exchange-${frame.sequence}.png`);
      exportStatus.textContent=`Image downloaded for exchange ${frame.sequence}. This is the visible view; off-screen content is not included.`;
    } catch(error) {
      if(!destroyed) exportStatus.textContent='Could not save image: '+error.message;
    } finally {
      if(url) URL.revokeObjectURL(url);
      exporting=false;if(!destroyed) exportButtons.forEach(b=>b.disabled=false);
    }
  }
  const actions=[
    ['in','Zoom in',()=>{closePopup();zoomAt(zoom*1.2);}],
    ['out','Zoom out',()=>{closePopup();zoomAt(zoom/1.2);}],
    ['reset','Reset view (keep node positions)',resetView],
    ['save','Save visible network image',saveImage]
  ];
  for(const bar of [toolbar,popup]) {
    for(const [icon,label,action] of actions) {
      const b=el('button',null,bar);b.type='button';b.className='cn-iconbutton';b.title=label;
      b.setAttribute('aria-label',label);makeIcon(icon,b);b.onclick=action;
      if(icon==='save') exportButtons.push(b);
    }
  }
  function outsideDown(event){if(!canvas.contains(event.target))closePopup();}
  function keyboard(event) {
    if(event.key==='Escape') {const wasOpen=!popup.hidden;closePopup();if(wasOpen)canvas.focus();}
    if(event.target===canvas && (event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))) {
      event.preventDefault();const r=canvas.getBoundingClientRect();showPopup(r.left+20,r.top+70);
      popup.querySelector('button')?.focus();
    }
  }
  document.addEventListener('pointerdown',outsideDown);
  root.addEventListener('keydown',keyboard);
  function nodeColor(n) {
    if(n.firstIndex===index)return '#17643b';
    return (index?n.firstIndex/index:0)>.55?'#80b491':'#e5f0e8';
  }
  function radius(n){return n.weight==null?24:18+30*Math.sqrt(n.weight);}
  function stat(dl,k,v){el('dt',k,dl);el('dd',v,dl);}
  function showEvidence(item) {
    if(!array(item.evidence).length){el('p','No source-linked passages were saved for this item.',drawer);return;}
    el('h4','Supporting passages',drawer);
    for(const e of array(item.evidence)) {
      const d=el('details',null,drawer);
      el('summary',`${text(e.speaker)||'Source'} · ${e.turn_id??'turn unavailable'}`,d);
      el('blockquote',text(e.quote)||'Quotation unavailable',d);
      const source=array(row?.source_state?.turns).find(t=>String(t.id)===String(e.turn_id));
      const content=e.speaker==='user'?source?.prompt:e.speaker==='assistant'?source?.response:null;
      if(typeof content==='string') {
        const full=el('details',null,d);el('summary','Full source message',full);el('blockquote',content,full);
      }
    }
  }
    function refreshCommentBadges() {
    world.querySelectorAll(
      '.cn-comment-badge'
    ).forEach(badge => badge.remove());

    if (
      destroyed ||
      pdfCapturing ||
      options.exportMode ||
      !review
    ) {
      return;
    }

    const currentNodes = new Map(
      frames[index].nodes.map(node => [
        String(node.id),
        node
      ])
    );

    for (const group of world.querySelectorAll(
      '.cn-node'
    )) {
      const id = group.getAttribute(
        'data-concept-id'
      );

      const node = currentNodes.get(id);

      if (!node) continue;

      const info = review.getCount(
        'node',
        id
      );

      if (!info.unread) continue;

      const unread = info.unread > 0;

      const badge = svg(
        'g',
        {
          class: 'cn-comment-badge',
          transform:
            `translate(${radius(node) * 0.7} ` +
            `${-radius(node) * 0.7})`,

          role: 'button',
          tabindex: 0,

          'aria-label':
            `${node.label}: ${info.total} messages, ` +
            `${info.unread} unread. Open discussion.`
        },
        group
      );

      const width = unread ? 42 : 29;

      svg(
        'rect',
        {
          x: -8,
          y: -13,
          width,
          height: 27,
          rx: 10,

          fill: unread
            ? '#17643b'
            : '#ffffff',

          stroke: '#52785e',
          'stroke-width': 1.5
        },
        badge
      );

      svg(
        'path',
        {
          d:
            'M-1 -6 H12 V4 H5 L1 8 V4 H-1 Z',

          fill: 'none',

          stroke: unread
            ? '#ffffff'
            : '#183c2b',

          'stroke-width': 1.5,
          'stroke-linejoin': 'round'
        },
        badge
      );

      if (unread) {
        svg(
          'text',
          {
            x: 23,
            y: 1,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            'font-size': 10,
            'font-weight': 700,
            fill: '#ffffff'
          },
          badge
        ).textContent =
          info.unread > 99
            ? '99+'
            : String(info.unread);
      }

      svg('title', {}, badge).textContent =
        `${info.total} messages · ` +
        `${info.unread} unread`;

      function openDiscussion() {
        inspect('node', id);

        review.openDiscussion({
          firstUnread: true
        });
      }

      badge.addEventListener(
        'pointerdown',
        event => {
          // Do not begin dragging the circle.
          event.stopPropagation();
        }
      );

      badge.addEventListener(
        'click',
        event => {
          event.preventDefault();
          event.stopPropagation();
          openDiscussion();
        }
      );

      badge.addEventListener(
        'keydown',
        event => {
          if (
            event.key === 'Enter' ||
            event.key === ' '
          ) {
            event.preventDefault();
            event.stopPropagation();
            openDiscussion();
          }
        }
      );
    }
  }


  function inspect(kind, id) {
    if (pdfCapturing) return;

    closePopup();

    selected = { kind, id };

    const nextInspectionKey = JSON.stringify([
      index,
      kind,
      id,
      comparison
    ]);

    if (inspectedKey === nextInspectionKey) {
      return;
    }

    inspectedKey = nextInspectionKey;

    review?.detach();
    drawer.replaceChildren();
    const f=frames[index],before=frames[index-1],item=(kind==='node'?f.nodes:f.edges).find(x=>x.id===id);
    if(!item){el('p','This item is not present in the selected turn.',drawer);return;}
    el('h4',kind==='node'?conceptName(item):(text(item.type)||'Relationship'),drawer);
    if(kind==='edge') {
      const names=new Map(f.nodes.map(n=>[n.id,conceptName(n)]));
      el('p',`${names.get(item.from_id)} ${item.directed===true?'→':'—'} ${names.get(item.to_id)}`,drawer);
    }
    el('p',text(item.definition)||text(item.description)||'No description saved.',drawer);
    const dl=el('dl',null,drawer);
    if(kind==='node')stat(dl,'Concept type',roleInfo(item.role).label);
    stat(dl,'Current weight',fmt(item.weight));
    const old=(kind==='node'?before?.nodes:before?.edges)?.find(x=>x.id===id);
    if(comparison&&before) {
      stat(dl,'Previous weight',fmt(old?.weight));
      if(old?.weight!=null&&item.weight!=null) {
        const delta=item.weight-old.weight;stat(dl,'Change',(delta>=0?'+':'')+delta.toFixed(2));
      }
    }
    if(kind==='node')stat(dl,'First recorded appearance',`Exchange ${frames[item.firstIndex].sequence}`);
    stat(dl,'Weight explanation',text(item.weight_reason)||'Not saved');
    stat(dl,'Weighting method',text(f.weighting?.method)||'Not recorded');
    stat(dl,'Extraction confidence (separate)',fmt(validWeight(item.extraction_confidence)));
    stat(dl,'Review',text(item.review_status)||'Not recorded');
    if(kind==='node'&&old&&old.definition!==item.definition) {
      el('h4','Previous definition',drawer);el('p',text(old.definition)||'Not saved',drawer);
    }
    if(kind==='node')for(const c of f.changes.filter(c=>c.concept_id===id))el('p',`${c.kind||'Change'}: ${c.description||''}`,drawer);
    showEvidence(item);
    review?.mount(
      drawer,
      {
        frame: f,
        kind,
        item
      }
    );
  }
  function addTable(title,headers,items,kind) {
    el('h4',title,tables);const table=el('table',null,tables),head=el('tr',null,el('thead',null,table));
    headers.forEach(h=>el('th',h,head).scope='col');const body=el('tbody',null,table);
    const names=new Map(frames[index].nodes.map(n=>[n.id,conceptName(n)]));
    for(const item of items) {
      const tr=el('tr',null,body), td=el('td',null,tr);
      const name=kind==='node'?conceptName(item):`${names.get(item.from_id)} ${item.directed===true?'→':'—'} ${names.get(item.to_id)}`;
      const b=el('button',name,td);b.type='button';b.className='cn-listbutton';b.onclick=()=>inspect(kind,item.id);
      if(kind==='node')el('td',roleInfo(item.role).label,tr);
      el('td',fmt(item.weight),tr);
      el('td',kind==='node'?`Exchange ${frames[item.firstIndex].sequence}`:text(item.type)||text(item.description)||'Unspecified',tr);
    }
  }
  function draw() {
    if (!pdfCapturing) {
      evolutionView?.setExchange(index);
      review?.setFrame(frames[index]);
    }
    timeline.value=String(index);prev.disabled=index===0;next.disabled=index===frames.length-1;checkbox.disabled=index===0;
    turnLabel.textContent=`Exchange ${frames[index].sequence} · saved slice ${index+1} of ${frames.length}`;
    const f=frames[index], before=frames[index-1], oldNodes=new Map((before?.nodes||[]).map(n=>[n.id,n]));
    const missing=f.nodes.filter(n=>n.weight==null).length+f.edges.filter(e=>e.weight==null).length;
    const absent=before?before.nodes.filter(n=>!f.nodes.some(c=>c.id===n.id)).length:0;
    summary.textContent=`${f.nodes.length} concepts · ${f.edges.length} connections. ${missing} weights unavailable.${comparison&&before?` ${absent} previous concepts absent from this slice (not automatically rejected).`:''} Newness is relative to supplied history. Model-proposed relationships are not proven causality.`;
    world.replaceChildren();const nodesById=new Map(f.nodes.map(n=>[n.id,n]));
    for(const e of f.edges) {
      const a=positions.get(e.from_id),b=positions.get(e.to_id);
      const g=svg('g',{'class':'cn-edge','data-edge-id':e.id,tabindex:0,role:'button','aria-label':`${text(e.type)||'Relationship'}, weight ${fmt(e.weight)}`},world);
      const attrs={stroke:'#a3aaa6','stroke-width':e.weight == null ? 0.8 : 0.6 + 1.4 * e.weight,fill:'none'};
      if(e.weight==null)attrs['stroke-dasharray']='5 5';
      if(e.directed===true)attrs['marker-end']=`url(#${uid})`;
      const self=e.from_id===e.to_id;let line;
      if(self) {
        const r=radius(nodesById.get(e.from_id));
        const d=`M ${a.x-r*.6} ${a.y-r*.7} C ${a.x-95} ${a.y-110},${a.x+95} ${a.y-110},${a.x+r*.6} ${a.y-r*.7}`;
        line=svg('path',{d,...attrs},g);svg('path',{d,stroke:'transparent','stroke-width':18,fill:'none'},g);
      } else {
        const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
        const ra=radius(nodesById.get(e.from_id))+3,rb=radius(nodesById.get(e.to_id))+5;
        const coords={x1:a.x+dx/len*ra,y1:a.y+dy/len*ra,x2:b.x-dx/len*rb,y2:b.y-dy/len*rb};
        line=svg('line',{...coords,...attrs},g);svg('line',{...coords,stroke:'transparent','stroke-width':18},g);
      }
      svg('title',{},line).textContent=`${e.type||e.description||'Relationship'} · weight ${fmt(e.weight)}`;
      svg('text',{x:(a.x+b.x)/2,y:self?a.y-95:(a.y+b.y)/2-5,'text-anchor':'middle','font-size':10,
        fill:'#000','paint-order':'stroke',stroke:'#f5f9f6','stroke-width':3},g).textContent=`${text(e.type)||'related'} · ${e.weight==null?'?':e.weight.toFixed(2)}`;
      g.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect('edge',e.id);}};
    }
    for(const n of f.nodes) {
      const p=positions.get(n.id),r=radius(n),old=oldNodes.get(n.id);
      const changed=comparison&&old&&(old.weight!==n.weight||old.definition!==n.definition||f.changes.some(c=>c.concept_id===n.id&&c.kind!=='unchanged'));
      const g=svg('g',{transform:`translate(${p.x} ${p.y})`,tabindex:0,role:'button',
        'aria-label':`${conceptName(n)}, ${roleInfo(n.role).label}, weight ${fmt(n.weight)}, first recorded exchange ${frames[n.firstIndex].sequence}`,
        'class':'cn-node','data-concept-id':n.id},world);
      if(changed)svg('circle',{r:r+5,fill:'none',stroke:'#17643b','stroke-width':2},g);
      svg('circle',{r,fill:nodeColor(n),stroke:'#52785e','stroke-width':1.5,...(n.weight==null?{'stroke-dasharray':'4 3'}:{})},g);
      const letters=conceptLetter(n.layoutIndex);
      svg('text',{'text-anchor':'middle','dominant-baseline':'central',y:0,'font-size':letters.length>2?11:14,
        'font-weight':600,fill:n.firstIndex===index?'#fff':'#183c2b'},g).textContent=letters;
      svg('text',{'text-anchor':'middle',y:r+19,'font-size':12,fill:'#000','paint-order':'stroke',stroke:'#f5f9f6','stroke-width':3},g).textContent=n.label.length>30?n.label.slice(0,28)+'…':n.label;
      const role=roleInfo(n.role),rw=role.label.length*6+16;
      svg('rect',{x:-rw/2,y:r+25,width:rw,height:18,rx:9,fill:'#e5f0e8',stroke:'#b9cebf','stroke-width':1},g);
      svg('text',{x:0,y:r+34,'text-anchor':'middle','dominant-baseline':'central','font-size':9,'font-weight':600,fill:'#000'},g).textContent=role.label;
      if(n.firstIndex===index||changed)svg('text',{'text-anchor':'middle',y:r+57,'font-size':10,fill:'#000'},g).textContent=n.firstIndex===index?'NEW':'UPDATED';
      svg('title',{},g).textContent=conceptName(n);
      g.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();inspect('node',n.id);}};
    }
    refreshCommentBadges();

    transform();

    tables.replaceChildren();

    addTable(
      'Concepts',
      ['Concept', 'Role', 'Weight', 'First recorded'],
      f.nodes,
      'node'
    );

    addTable(
      'Relationships',
      ['Connection', 'Weight', 'Relationship'],
      f.edges,
      'edge'
    );

    if (!pdfCapturing) {
      if (selected) {
        inspect(
          selected.kind,
          selected.id
        );
      } else {
        inspectedKey = null;

        review?.detach();
        drawer.replaceChildren();

        el(
          'h4',
          'Explore the topic',
          drawer
        );

        el(
          'p',
          'Click a concept or connection to inspect it ' +
          'or start a discussion. Click a comment badge ' +
          'to open its messages.',
          drawer
        );
      }
    }
  }
  function cancelGestures() {
    const ids=[...pointers.keys()];pointers.clear();drag=null;pinch=null;suppressTap=false;
    for(const id of ids)if(drawing.hasPointerCapture(id))drawing.releasePointerCapture(id);
  }
  function goto(i) {cancelGestures();closePopup();index=Math.max(0,Math.min(frames.length-1,i));exportStatus.textContent='';draw();}
  prev.onclick=()=>goto(index-1);next.onclick=()=>goto(index+1);timeline.oninput=()=>goto(Number(timeline.value));
  checkbox.onchange=()=>{cancelGestures();closePopup();comparison=checkbox.checked;draw();};
  function startPinch() {
    const [a,b]=[...pointers.values()].slice(0,2);
    if(!a||!b)return;
    const mid=svgPoint((a.x+b.x)/2,(a.y+b.y)/2);if(!mid)return;
    pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom,
      worldX:(mid.x-440-panX)/zoom+440,worldY:(mid.y-285-panY)/zoom+285};
    drag=null;suppressTap=true;closePopup();
  }
  function pointerDown(event) {
    if(event.pointerType==='mouse'&&event.button!==0)return;
    if(destroyed)return;
    closePopup();event.preventDefault();
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    try{drawing.setPointerCapture(event.pointerId);}catch{}
    if(pointers.size>=2){startPinch();return;}
    suppressTap=false;
    const target=event.target instanceof Element?event.target:null;
    const node=target?.closest('.cn-node'),edge=target?.closest('.cn-edge');
    const id=node?.getAttribute('data-concept-id'),position=id?positions.get(id):null;
    const point=svgPoint(event.clientX,event.clientY,position?world:drawing);if(!point)return;
    drag={pointerId:event.pointerId,kind:position?'node':edge?'edge':'background',
      id:id||edge?.getAttribute('data-edge-id'),startClientX:event.clientX,startClientY:event.clientY,
      startX:point.x,startY:point.y,originalX:position?position.x:panX,
      originalY:position?position.y:panY,moved:false};
  }
  function pointerMove(event) {
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});event.preventDefault();
    if(pointers.size>=2&&pinch) {
      const [a,b]=[...pointers.values()].slice(0,2);
      const mid=svgPoint((a.x+b.x)/2,(a.y+b.y)/2);if(!mid)return;
      zoom=Math.max(.45,Math.min(3,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
      panX=mid.x-440-zoom*(pinch.worldX-440);panY=mid.y-285-zoom*(pinch.worldY-285);transform();return;
    }
    if(suppressTap||!drag||drag.pointerId!==event.pointerId)return;
    const distance=Math.hypot(event.clientX-drag.startClientX,event.clientY-drag.startClientY);
    if(!drag.moved&&distance<=5)return;drag.moved=true;
    const point=svgPoint(event.clientX,event.clientY,drag.kind==='node'?world:drawing);if(!point)return;
    const dx=point.x-drag.startX,dy=point.y-drag.startY;
    if(drag.kind==='node') {
      const pos=positions.get(drag.id);if(!pos)return;
      pos.x=drag.originalX+dx;pos.y=drag.originalY+dy;draw();
    } else {panX=drag.originalX+dx;panY=drag.originalY+dy;transform();}
  }
  function pointerEnd(event) {
    if(!pointers.has(event.pointerId))return;
    const finished=drag,wasPinch=suppressTap;
    pointers.delete(event.pointerId);
    if(drawing.hasPointerCapture(event.pointerId))drawing.releasePointerCapture(event.pointerId);
    if(wasPinch) {
      drag=null;pinch=null;
      if(pointers.size>=2)startPinch();
      if(!pointers.size)suppressTap=false;
      return;
    }
    if(finished?.pointerId===event.pointerId) {
      drag=null;
      const distance=Math.hypot(event.clientX-finished.startClientX,event.clientY-finished.startClientY);
      if(event.type==='pointerup'&&!finished.moved&&distance<=5) {
        if(finished.kind==='node')inspect('node',finished.id);
        else if(finished.kind==='edge')inspect('edge',finished.id);
        else showPopup(event.clientX,event.clientY);
      }
    }
    if(!pointers.size){drag=null;pinch=null;suppressTap=false;}
  }
  function lostCapture(event) {
    if(pointers.has(event.pointerId))pointerEnd({...event,pointerId:event.pointerId,type:'pointercancel'});
  }
  function wheel(event) {
    if(!event.ctrlKey)return;
    event.preventDefault();closePopup();
    const p=svgPoint(event.clientX,event.clientY);
    if(p)zoomAt(zoom*Math.exp(-event.deltaY*.01),p);
  }
  function contextMenu(event) {
    if(pointers.size || suppressTap) { event.preventDefault(); return; }
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest('.cn-node,.cn-edge'))return;
    event.preventDefault();showPopup(event.clientX,event.clientY);
  }
  drawing.addEventListener('pointerdown',pointerDown);
  drawing.addEventListener('lostpointercapture',lostCapture);
  drawing.addEventListener('wheel',wheel,{passive:false});
  drawing.addEventListener('contextmenu',contextMenu);
  window.addEventListener('pointermove',pointerMove,{passive:false});
  window.addEventListener('pointerup',pointerEnd);
  window.addEventListener('pointercancel',pointerEnd);
  window.addEventListener('blur',cancelGestures);
    if (options.exportMode && options.initialLayout) {
    for (const point of options.initialLayout.positions || []) {
      if (
        positions.has(point.id) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      ) {
        positions.set(point.id, {
          x: point.x,
          y: point.y
        });
      }
    }
  }
  draw();
  if (!options.exportMode) {
  accountLayout = attachAccountLayout({
    root,
    row,
    options,

    readState() {
      return {
        version: 1,

        positions: [...positions].map(([id, point]) => ({
          id,
          x: point.x,
          y: point.y
        })),

        view: {
          zoom,
          panX,
          panY
        },

        selectedTurnId:
          frames[index]?.turnId == null
            ? null
            : String(frames[index].turnId)
      };
    },

    applyState(saved) {
      cancelGestures();
      closePopup();

      // Restore only concepts present in this saved report.
      for (const point of saved.positions) {
        if (positions.has(point.id)) {
          positions.set(point.id, {
            x: point.x,
            y: point.y
          });
        }
      }

      zoom = saved.view.zoom;
      panX = saved.view.panX;
      panY = saved.view.panY;

      if (saved.selectedTurnId != null) {
        const savedIndex = frames.findIndex(
          frame =>
            String(frame.turnId) === saved.selectedTurnId
        );

        if (savedIndex >= 0) {
          index = savedIndex;
        }
      }

      selected = null;
      draw();
    }
  });

    evolutionView = mountConceptEvolution({
    frames,
    container: root,
    initialIndex: index,

    onSelect({ frameIndex, conceptId }) {
      if (destroyed) return;

      // Show the corresponding exchange in the network.
      goto(frameIndex);

      // Open the selected concept's existing evidence drawer.
      if (conceptId) {
        inspect('node', conceptId);
      }
    }
  });
  }
return {
  saveImage,
  resetView,
  captureForPdf,

  getReportIdentity() {
    return {
      id: row.id,
      revision: row.revision,
      sourceFingerprint: row.source_fingerprint
    };
  },

  destroy() {
      destroyed=true;
      review?.destroy();
      evolutionView?.destroy();
      accountLayout?.destroy();
      cancelGestures();
      document.removeEventListener('pointerdown',outsideDown);
      root.removeEventListener('keydown',keyboard);
      drawing.removeEventListener('pointerdown',pointerDown);
      drawing.removeEventListener('lostpointercapture',lostCapture);
      drawing.removeEventListener('wheel',wheel);
      drawing.removeEventListener('contextmenu',contextMenu);
      window.removeEventListener('pointermove',pointerMove);
      window.removeEventListener('pointerup',pointerEnd);
      window.removeEventListener('pointercancel',pointerEnd);
      window.removeEventListener('blur',cancelGestures);
      root.remove();
    }
  };
}
/** Mount beside a shared report panel. */
export function mountConceptsNetwork({
  tabBar,
  existingPanel,
  getRow,
  getDb,
  getSession,
  isCurrent
}) {
  if(!(tabBar instanceof Element)||!(existingPanel instanceof Element)||typeof getRow!=='function')throw new Error('Supply tabBar, existingPanel, and getRow().');
  styles();const existingTabs=[...tabBar.querySelectorAll('button')];
  const button=el('button','Concepts network',tabBar);button.type='button';button.className='cn-tab';button.setAttribute('aria-selected','false');
  const panel=el('section');panel.hidden=true;existingPanel.after(panel);let view=null,active=false;
  const render = row => {
    view?.destroy();

    view = renderConceptsNetwork(
      row,
      panel,
      {
        getDb,
        getSession,
        isCurrent
      }
    );
  };
  const onExisting=()=>{active=false;panel.hidden=true;existingPanel.hidden=false;button.setAttribute('aria-selected','false');};
  existingTabs.forEach(t=>t.addEventListener('click',onExisting));
  button.onclick=()=>{
    const row=getRow();
    if(!row){view?.destroy();view=null;panel.replaceChildren();el('p','Select or generate a saved report first.',panel);}else render(row);
    active=true;panel.hidden=false;existingPanel.hidden=true;button.setAttribute('aria-selected','true');
  };
  return {
    update(row){if(active)render(row);},
    destroy(){view?.destroy();existingTabs.forEach(t=>t.removeEventListener('click',onExisting));button.remove();panel.remove();existingPanel.hidden=false;}
  };
}

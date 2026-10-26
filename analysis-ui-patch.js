import { renderLatestDevelopment } from './latest-development.js?v=latest-1';


const TYPES=['quick_summary','conversation_insights','concepts_network'];
const LABELS={quick_summary:'Quick summary',conversation_insights:'Conversation insights',concepts_network:'Concepts network'};
const RULES=[
 ['Goals',/\b(goal|objective|aim|want|hope|achieve|success|target|intend)\b/i],
 ['Money and pricing',/\b(budget|cost|costs|price|pricing|revenue|profit|funding|cash|money|financial|afford|investment)\b|[$€£]|\b(CAD|USD)\b/i],
 ['Timing',/\b(deadline|timeline|launch|delay|urgent|soon|months?|weeks?|years?|time)\b/i],
 ['Customers',/\b(customers?|clients?|market|demand|buyers?|sales|willingness|purchase|adoption)\b/i],
 ['Resources',/\b(team|staff|skills|capacity|resources?|equipment|technology|suppliers?|expertise|available)\b/i],
 ['Limits and requirements',/\b(must|cannot|can.t|required|requirement|limit|limited|constraint|restriction|only|compliance|regulation|legal)\b/i],
 ['Risks',/\b(risk|uncertain|uncertainty|unknown|failure|fail|concern|worry|threat|might|may|could)\b/i],
 ['Options',/\b(option|alternative|choose|choice|versus|instead|either|whether|tradeoff|trade-off)\b/i],
 ['Evidence and assumptions',/\b(evidence|data|interviews?|survey|research|tested|test|pilot|assume|assumption|believe|estimate)\b/i],
 ['People and dependencies',/\b(partners?|investors?|advisors?|stakeholders?|approval|depends|dependency)\b/i]
];
function el(tag,text,parent){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(parent)parent.append(n);return n;}
function normalize(turns){return turns.slice().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id))).map(t=>({id:String(t.id),created_at:t.created_at,completed_at:t.completed_at||null,status:t.status,prompt:t.prompt||'',response:t.response||''}));}
function completed(turns){return normalize(turns).filter(t=>t.status==='completed'&&String(t.response).trim());}
async function hashSource(source){const bytes=new TextEncoder().encode(JSON.stringify({title:source.title,turns:normalize(source.turns)}));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
function quickReport(turns){const passages=turns.flatMap(t=>String(t.prompt).split(/\n+|(?<=[.!?])\s+/u).map(s=>s.trim()).filter(Boolean).map(quote=>({turn_id:t.id,quote})));const used=new Set();return {format_version:2,prompt_count:turns.length,groups:RULES.map(([label,re])=>({label,evidence:passages.filter((e,i)=>{if(re.test(e.quote)){used.add(i);return true;}return false;})})).filter(g=>g.evidence.length),unmatched:passages.filter((_,i)=>!used.has(i))};}
export function mountAnalysisUI({getDb,getSession,isLocked}){
 let root,tabs={},panel,status,selector,context=null,key='',epoch=0,active='quick_summary',choice='current',rows=[],sourceHash='',currentSource=null,loading=false,message='',networkView=null;
 const running=new Set();const user=()=>getSession()?.user?.id||null;
 const valid=(token,k)=>token===epoch&&k===key&&user()===context?.user_id;
 function disposeNetwork(){if(networkView){networkView.destroy();networkView=null;}}
 function mount(){if(root)return;const composer=document.getElementById('composer');if(!composer)throw new Error('Message composer not found');
  root=el('section');root.id='conversationReports';root.hidden=true;el('h3','Your conversation reports',root);
  const bar=el('div',undefined,root);bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Conversation reports');
  for(const type of TYPES){const b=el('button',LABELS[type],bar);b.type='button';b.id='paired-tab-'+type;b.setAttribute('role','tab');b.setAttribute('aria-controls','paired-report-content');b.onclick=()=>activate(type);tabs[type]=b;
   b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const step=e.key==='ArrowLeft'?-1:1;const index=e.key==='Home'?0:e.key==='End'?TYPES.length-1:(TYPES.indexOf(type)+step+TYPES.length)%TYPES.length;tabs[TYPES[index]].focus();activate(TYPES[index],true);};}
  el('p','Quick summary and Conversation insights: select to view; select the active report tab again to refresh BOTH reports. A missing pair is generated from either report tab. Concepts network only views saved data and never starts generation.',root).className='report-help';
  const label=el('label','Report snapshot',root);label.htmlFor='reportSnapshotSelect';selector=el('select',undefined,root);selector.id='reportSnapshotSelect';selector.onchange=()=>{choice=selector.value;message='';render();};
  status=el('p','',root);status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel=el('div',undefined,root);panel.id='paired-report-content';panel.setAttribute('role','tabpanel');panel.tabIndex=0;composer.before(root);
 }
 function clear(){epoch++;context=null;key='';rows=[];sourceHash='';currentSource=null;message='';loading=false;disposeNetwork();if(root){root.hidden=true;panel.replaceChildren();status.textContent='';}}
 function sync(){if(context&&user()!==context.user_id){clear();return;}if(!root)return;const locked=loading||isLocked()||running.has(key);for(const b of Object.values(tabs))b.disabled=locked;selector.disabled=loading||running.has(key);}
 async function listSnapshots(db,uid,id){const all=[];for(let start=0;;start+=100){const q=await db.from('research_report_snapshots').select('id,user_id,conversation_id,last_turn_id,source_fingerprint,requested_at,generation_completed_at,created_at,updated_at,revision,source_state,quick_summary,conversation_insights').eq('user_id',uid).eq('conversation_id',id).order('created_at',{ascending:false}).order('id').range(start,start+99);if(q.error)throw q.error;all.push(...q.data);if(q.data.length<100)return all;}}
 async function setContext(topic,turns=[]){mount();if(!topic||!user()){clear();return;}
  const nextKey=user()+'|'+topic.id;const next={id:String(topic.id),title:topic.title||'Untitled conversation',user_id:user()};const source={title:next.title,turns:completed(turns)};
  if(nextKey===key){const token=epoch;const h=await hashSource(source);if(valid(token,nextKey)){context=next;currentSource=source;sourceHash=h;render();}return;}
  epoch++;key=nextKey;context=next;rows=[];active='quick_summary';choice='current';sourceHash='';currentSource=source;loading=true;message='';render();
  const token=epoch;
  try{const h=await hashSource(source);const loaded=await listSnapshots(getDb(),next.user_id,next.id);if(!valid(token,nextKey))return;sourceHash=h;rows=loaded;}
  catch(e){if(valid(token,nextKey))message='Could not load saved snapshots: '+e.message;}
  finally{if(valid(token,nextKey)){loading=false;render();}}
 }
 function selectedRow(){return choice==='current'?rows.find(r=>r.source_fingerprint===sourceHash):rows.find(r=>r.id===choice);}
 function section(title,items,parent){el('h4',title,parent);if(!items.length){el('p','Not identified in this report.',parent);return;}const ul=el('ul',undefined,parent);for(const text of items)el('li',text,ul);}
 function concept(c,parent){const d=el('details',undefined,parent);el('summary',c.label,d);el('p',c.definition,d);const speakers=new Set((c.evidence||[]).map(e=>e.speaker));el('p',speakers.size===2?'Discussed by you and the assistant':speakers.has('user')?'Mentioned by you':'Introduced by the assistant',d);
  if(c.state_estimate){const s=c.state_estimate;el('p',`Recorded user estimate: ${Math.round(s.probability*100)}% — ${s.proposition}. Check the source before relying on this interpretation.`,d);}
  const refs=el('details',undefined,d);el('summary','Source passages',refs);for(const e of c.evidence||[])el('blockquote',`${e.speaker==='user'?'You':'Assistant'}: ${e.quote}`,refs);
  const technical=el('details',undefined,d);el('summary','Technical details',technical);el('p',`Extraction score: ${c.extraction_confidence}. Uncalibrated, not a business probability. Status: ${c.review_status}.`,technical);
 }
 function render(){if(!root||!context)return;disposeNetwork();root.hidden=false;panel.replaceChildren();
  for(const t of TYPES){tabs[t].setAttribute('aria-selected',String(active===t));tabs[t].tabIndex=active===t?0:-1;tabs[t].textContent=LABELS[t]+(running.has(key)?' — Updating pair…':'');}panel.setAttribute('aria-labelledby','paired-tab-'+active);
  selector.replaceChildren();const now=el('option','Current conversation — latest completed exchange',selector);now.value='current';
  for(const r of rows){const n=r.source_state?.turns?.length;const option=el('option',`${new Date(r.requested_at).toLocaleString()} · through exchange ${n||'?'} · revision ${r.revision}`,selector);option.value=r.id;}selector.value=choice;
  const row=selectedRow();status.textContent=message||(loading?'Loading saved report pairs…':row?`Saved pair: requested ${new Date(row.requested_at).toLocaleString()}, completed ${new Date(row.generation_completed_at).toLocaleString()}. All three tabs use the same captured source.`:rows.length?'No pair saved for the current conversation state. Select Quick summary or Conversation insights to generate both, or choose an earlier snapshot.':'No report pair yet. Select Quick summary or Conversation insights to generate both reports.');
  if(!row){if(active==='concepts_network')el('p','No saved network for this selection. Choose an earlier saved snapshot, or select Quick summary or Conversation insights to generate a report pair. This tab does not make AI requests.',panel);sync();return;}
  if (active === 'concepts_network') {
    const placeholder = el(
      'p',
      'Loading concepts network…',
      panel
    );
  
    const stillCurrent = () =>
      active === 'concepts_network' &&
      panel.contains(placeholder);
  
    import('./concepts-network.js?v=1')
      .then(module => {
        if (!stillCurrent()) return;
  
        if (typeof module.renderConceptsNetwork !== 'function') {
          throw new Error(
            'concepts-network.js does not export renderConceptsNetwork.'
          );
        }
  
        try {
          networkView = module.renderConceptsNetwork(row, panel);
        } catch (error) {
          disposeNetwork();
          panel.replaceChildren();
  
          el(
            'p',
            'Could not display the concepts network: ' +
              error.message,
            panel
          );
        }
      })
      .catch(error => {
        if (!stillCurrent()) return;
  
        placeholder.textContent =
          'Could not load the concepts network: ' +
          error.message +
          '. The other report tabs remain available.';
      });
  
    sync();
    return;
  }
  
  if(active==='quick_summary'){const q=row.quick_summary;el('h3','What you mentioned',panel);el('p',`Based on ${q.prompt_count} user prompts in completed exchanges. Keyword-assisted overview; assistant responses are excluded from this summary.`,panel);
   for(const g of q.groups||[]){const d=el('details',undefined,panel);el('summary',g.label,d);for(const e of g.evidence)el('blockquote',e.quote,d);}if(!(q.groups||[]).length)el('p','No predefined categories matched. This is not evidence that the conversation lacks relevant concepts.',panel);
   const other=el('details',undefined,panel);el('summary','Other passages to review',other);for(const e of q.unmatched||[])el('blockquote',e.quote,other);
  }else{const report=row.conversation_insights;const snapshots=report.snapshots||[];const model=snapshots.at(-1)?.model;el('h3','Conversation insights',panel);el('p','AI-proposed interpretations, not verified business facts. Assistant suggestions are not user decisions.',panel);
   if(model){
    renderLatestDevelopment(row,panel);section('Your situation',model.concepts.filter(c=>c.role==='concept'&&(c.evidence||[]).some(e=>e.speaker==='user')).map(c=>c.definition),panel);
    for(const [title,roles] of [['Goals and limits',['goal','constraint']],['Factors discussed',['concept','driver','outcome']],['Directions and options',['direction']]]){el('h4',title,panel);const found=model.concepts.filter(c=>roles.includes(c.role));if(!found.length)el('p','Not yet identified.',panel);for(const c of found)concept(c,panel);}
    const names=new Map(model.concepts.map(c=>[c.id,c.label]));section('Possible connections — not established causes',(model.relationships||[]).map(r=>`${names.get(r.from_id)||r.from_id} → ${names.get(r.to_id)||r.to_id}: ${r.description}`),panel);
    el('h4','How the discussion developed',panel);if(snapshots.length===1)el('p','One completed exchange is available; there is no between-exchange change to compare.',panel);
    for(const s of snapshots){const d=el('details',undefined,panel);el('summary',`Exchange ${s.sequence} · ${new Date(s.created_at).toLocaleString()}`,d);const changes=(s.model.changes||[]).filter(c=>c.kind!=='unchanged');if(!changes.length)el('p','No substantive changes identified.',d);for(const c of changes)el('p',c.description,d);}
    section('Questions still open',model.open_questions||[],panel);
   }else el('p','No concept snapshots were returned.',panel);
  }sync();
 }
 async function fetchSource(db,uid,id,boundary=null){const q=await db.from('research_conversations').select('id,title,user_id').eq('id',id).eq('user_id',uid).single();if(q.error)throw q.error;let all=[];
  for(let start=0;;start+=500){const batch=await db.from('research_turns').select('id,created_at,completed_at,status,prompt,response').eq('conversation_id',id).eq('user_id',uid).order('created_at').order('id').range(start,start+499);if(batch.error)throw batch.error;all.push(...batch.data);if(batch.data.length<500)break;}
  let turns=completed(all);if(boundary){const index=turns.findIndex(t=>t.id===String(boundary));if(index<0)throw new Error('The snapshot boundary turn is no longer available');turns=turns.slice(0,index+1);}return {title:q.data.title||'Untitled conversation',turns};
 }
 async function activate(type,navigateOnly=false){if(!context||loading||isLocked()||running.has(key))return;const wasActive=active===type;active=type;message='';render();if(navigateOnly||type==='concepts_network')return;if(selectedRow()&&!wasActive)return;await generatePair();}
 async function generatePair(){const token=epoch,k=key,captured={...context},db=getDb();const selected=selectedRow();const oldChoice=choice;running.add(k);message='Capturing the conversation…';render();
  try{
   // Browser request time is sent to SQL; keep device clock accurate.
   const requestedAt=new Date().toISOString();
   const source=oldChoice==='current'?await fetchSource(db,captured.user_id,captured.id):structuredClone(selected.source_state);
   if(!valid(token,k))return;if(!source.turns?.length)throw new Error('A completed prompt and response are required before generating reports');
   const fingerprint=await hashSource(source);if(!valid(token,k))return;
   const boundary=source.turns.at(-1).id;
   if(oldChoice!=='current'){const verified=await fetchSource(db,captured.user_id,captured.id,boundary);if(await hashSource(verified)!==fingerprint)throw new Error('Historical source changed. Keep the saved snapshot and generate a current one instead.');}
   const existing=rows.find(r=>r.source_fingerprint===fingerprint);const quick=quickReport(source.turns);const snapshots=[];let previous=null;
   for(let i=0;i<source.turns.length;i++){
    if(!valid(token,k))return;message=`Generating both reports: analyzing exchange ${i+1} of ${source.turns.length}…`;render();const t=source.turns[i];
    const response=await db.functions.invoke('conversation-concepts',{body:{conversation_id:captured.id,turn_id:t.id,previous_model:previous}});
    if(!valid(token,k))return;if(response.error){let text=response.error.message;try{text=(await response.error.context.json()).error||text;}catch{}throw new Error(text);}if(!response.data?.model)throw new Error('Concept extraction returned no model');
    previous=response.data.model;snapshots.push({sequence:i+1,turn_id:t.id,created_at:t.created_at,model:previous});
   }
   const verified=await fetchSource(db,captured.user_id,captured.id,boundary);if(!valid(token,k))return;if(await hashSource(verified)!==fingerprint)throw new Error('Conversation content changed during generation. No new pair was saved; select the active report tab to retry.');
   const insights={format_version:2,method:'gemini_proposed_unreviewed',snapshots};
   const save=await db.rpc('save_report_snapshot_pair',{p_conversation_id:captured.id,p_last_turn_id:boundary,p_source_fingerprint:fingerprint,p_source_state:source,p_quick_summary:quick,p_conversation_insights:insights,p_requested_at:requestedAt,p_expected_revision:existing?.revision||0});
   if(!valid(token,k))return;if(save.error)throw save.error;if(!save.data?.[0])throw new Error('No saved snapshot returned');const row=save.data[0];rows=[row,...rows.filter(r=>r.id!==row.id)].sort((a,b)=>b.created_at.localeCompare(a.created_at));choice=row.id;message='Both reports were saved together. All three tabs can view this snapshot. Choose Current conversation to report on newer exchanges.';
  }catch(e){if(valid(token,k))message='Could not update the report pair: '+e.message+'. Earlier saved pairs have not been replaced.';}
  finally{running.delete(k);if(valid(token,k))render();}
 }
 function analyze(id){if(!context||context.id!==String(id))throw new Error('Open this topic first');root.scrollIntoView({behavior:'smooth',block:'start'});}
 return {setContext:(topic,turns)=>{setContext(topic,turns).catch(e=>{if(root){message='Report setup failed: '+e.message;loading=false;render();}});},sync,analyze,close:clear};
}

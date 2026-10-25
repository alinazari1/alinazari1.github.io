import { showInlineAnalysisPanel } from
  './inline-analysis-panels.js?v=inline-1';

export function mountAnalysisUI({getDb,getSession,isLocked}) {
  let dialog=null, activeUser=null, epoch=0, working=false, result=null;
  const el=(tag,text,parent)=>{const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(parent)parent.append(n); return n;};
  function close(){epoch++; working=false; result=null; activeUser=null; if(dialog){dialog.close();dialog.remove();dialog=null;}}
  function sync(){if(dialog && getSession()?.user.id!==activeUser)close();}
  async function analyze(conversationId){
    if(isLocked())throw new Error('Finish the current chat or voice action first.');
    if(working)throw new Error('An analysis is already running.');
    const db=getDb(), uid=getSession()?.user.id;
    if(!db||!uid)throw new Error('Please sign in.');
    if(dialog&&!confirm('Replace the current analysis? Download it first if needed.'))return;
    close(); activeUser=uid; const token=++epoch; working=true;
    dialog=el('dialog'); dialog.style.cssText='width:min(1000px,94vw);max-height:90vh;overflow:auto;padding:24px;border-radius:12px';
    dialog.setAttribute('aria-label','Evolving conversation concept model');
    el('h2','Conversation concept model',dialog);
    el('p','AI-proposed analysis, not verified business facts. Extraction scores are uncalibrated. Analysis is not saved to the database.',dialog);
    const status=el('p','Loading…',dialog); status.setAttribute('role','status');
    const body=el('section',undefined,dialog);
    const download=el('button','Download model JSON',dialog); download.disabled=true;
    download.onclick=()=>{if(!result)return;const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='conversation-concepts-'+conversationId+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);};
    const dismiss=el('button','Close',dialog);dismiss.onclick=close;
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    
    showInlineAnalysisPanel(dialog);
    const current=()=>token===epoch&&getSession()?.user.id===uid;
    function render(snapshot){
      const card=el('details',undefined,body);card.open=true;
      el('summary',`Turn ${snapshot.sequence} · ${new Date(snapshot.source.created_at).toLocaleString()}`,card);
      const source=el('details',undefined,card);el('summary','Original prompt and response',source);
      el('h4','User prompt',source);el('pre',snapshot.source.prompt,source).style.whiteSpace='pre-wrap';
      el('h4','AI response',source);el('pre',snapshot.source.response,source).style.whiteSpace='pre-wrap';
      el('h4','Concepts after this turn',card);
      for(const c of snapshot.model.concepts){
        const d=el('details',undefined,card);
        el('summary',`${c.label} · ${c.role} · extraction score ${c.extraction_confidence}`,d);
        el('p',c.definition,d);el('p','Review: '+c.review_status,d);
        for(const s of c.evidence)el('blockquote',`${s.speaker}, turn ${s.turn_id}: “${s.quote}”`,d);
        if(c.state_estimate)el('pre',JSON.stringify(c.state_estimate,null,2),d).style.whiteSpace='pre-wrap';
      }
      el('h4','Changes proposed in this turn',card);
      for(const c of snapshot.model.changes)el('p',`${c.kind}: ${c.description} (concept ${c.concept_id})`,card);
      el('h4','Proposed relationships',card);
      for(const r of snapshot.model.relationships)el('p',`${r.from_id} → ${r.to_id}: ${r.description}. Score ${r.extraction_confidence}; not established causation.`,card);
      el('h4','Unresolved questions',card);for(const q of snapshot.model.open_questions)el('p',q,card);
    }
    try{
      const t=await db.from('research_conversations').select('id,title,user_id,is_visible').eq('id',conversationId).eq('user_id',uid).single();
      if(t.error)throw t.error;
      let turns=[];
      for(let start=0;;start+=500){const q=await db.from('research_turns').select('id,created_at,completed_at,status,prompt,response').eq('conversation_id',conversationId).eq('user_id',uid).order('created_at').order('id').range(start,start+499);if(q.error)throw q.error;if(!current())return;turns.push(...q.data);if(q.data.length<500)break;}
      result={schema_version:'conversation-concepts-v1',conversation_id:conversationId,title:t.data.title,analyzed_at:new Date().toISOString(),method:'gemini_proposed_unreviewed',snapshots:[]};
      const skipped=turns.filter(x=>x.status!=='completed'||!x.response).length;
      turns=turns.filter(x=>x.status==='completed'&&x.response);
      let previous=null;
      for(let i=0;i<turns.length;i++){
        if(!current())return;
        status.textContent=`Analyzing turn ${i+1} of ${turns.length}. Each turn makes an AI request; do not restart unnecessarily.`;
        const {data,error}=await db.functions.invoke('conversation-concepts',{body:{conversation_id:conversationId,turn_id:turns[i].id,previous_model:previous}});
        if(!current())return;
        if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}
        if(!data?.model)throw new Error('Backend returned no model.');
        previous=data.model;
        const snapshot={sequence:i+1,source:turns[i],model:previous};result.snapshots.push(snapshot);render(snapshot);download.disabled=false;
      }
      status.textContent=`Finished: ${result.snapshots.length} completed turns; ${skipped} incomplete turns skipped. Download to retain this analysis. Nothing was written to the database.`;
    }catch(e){if(current())status.textContent='Analysis stopped: '+e.message+'. Any completed snapshots can still be downloaded.';}
    finally{if(current())working=false;}
  }
  return {sync,analyze,close};
}

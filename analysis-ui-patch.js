export function mountAnalysisUI({ getDb, getSession, isLocked }) {
  const $=id=>document.getElementById(id);
  let button=null, dialog=null, account=null, running=false, generation=0;
  const blocked=()=>!getSession()||isLocked()||running;
  function close() {
    generation++;
    if(dialog) { if(dialog.open) dialog.close(); dialog.remove(); dialog=null; }
  }
  function addAssignedButtons() {
    document.querySelectorAll('#advisorUsersList details').forEach(details=>{
      if(!details.dataset.userId) return;
      let b=details.querySelector('.advisorAnalyzeUser');
      if(!b) {
        const summary=details.querySelector('summary'); if(!summary) return;
        b=document.createElement('button'); b.type='button';
        b.className='secondary advisorAnalyzeUser'; b.textContent='Analyze this user';
        b.style.margin='6px 0';
        b.onclick=()=>{ if(!blocked()) open('assigned_user',details.dataset.userId,
          summary.textContent.replace(/ \(\d+\)$/,'')); };
        summary.after(b);
      }
      if(b.disabled!==Boolean(blocked())) b.disabled=Boolean(blocked());
    });
  }
  function sync() {
    if(!button) {
      button=document.createElement('button'); button.id='analyzeMyTopics'; button.type='button';
      button.className='secondary'; button.textContent='Analyze my topics';
      button.style.width='100%'; button.style.margin='0 0 10px';
      $('history').before(button);
      button.onclick=()=>{ if(!blocked()) open('mine'); };
    }
    const next=getSession()?.user.id||null;
    if(next!==account) { account=next; close(); }
    button.hidden=!next; button.disabled=Boolean(blocked()); addAssignedButtons();
  }
  function open(scope,userId=null,userLabel='') {
    if(blocked()) return;
    close(); const version=generation, owner=getSession().user.id;
    const view=document.createElement('dialog'); dialog=view;
    Object.assign(view.style,{width:'min(820px, calc(100vw - 24px))',maxHeight:'88dvh',
      overflowY:'auto',padding:'24px',border:'1px solid var(--border)',borderRadius:'12px',
      background:'var(--surface)',color:'var(--text)'});
    view.setAttribute('aria-labelledby','analysisHeading');
    view.innerHTML=`<h2 id="analysisHeading">Conversation analysis</h2>
      <p class="small" id="analysisScopeLabel"></p>
      <form id="analysisForm">
      <label for="analysisType">Report</label>
      <select id="analysisType" style="width:100%;padding:12px;font:inherit">
        <option value="overview">Overview</option><option value="themes">Themes and connections</option>
        <option value="actions">Decisions, actions, and gaps</option><option value="full">Full report</option>
      </select>
      <p class="small">Dates filter completed messages, not topic creation dates. Dates use UTC; the end date is included.</p>
      <div class="row"><div style="flex:1;min-width:150px"><label for="analysisFrom">From</label><input id="analysisFrom" type="date"></div>
      <div style="flex:1;min-width:150px"><label for="analysisTo">To</label><input id="analysisTo" type="date"></div></div>
      <label class="check"><input id="analysisHidden" type="checkbox"><span>Include hidden conversations</span></label>
      <label class="check"><input id="analysisConsent" type="checkbox" required><span>I understand that the selected saved conversation text will be sent to the configured AI provider for analysis.</span></label>
      <p id="analysisStatus" role="status" aria-live="polite"></p>
      <div id="analysisReport"></div>
      <div class="row"><button id="analysisGenerate" type="submit">Generate report</button>
      <button id="analysisClose" type="button" class="secondary">Close</button></div></form>`;
    document.body.append(view);
    view.querySelector('#analysisScopeLabel').textContent=scope==='mine'?'Scope: your own topics only':`Scope: assigned user ${userLabel}`;
    const active=()=>dialog===view&&view.isConnected&&generation===version&&getSession()?.user.id===owner;
    view.querySelector('#analysisClose').onclick=close;
    view.addEventListener('cancel',e=>{e.preventDefault();close();}); view.showModal();
    view.querySelector('#analysisForm').onsubmit=async e=>{
      e.preventDefault(); if(blocked()||!active()) return;
      const submit=view.querySelector('#analysisGenerate'),status=view.querySelector('#analysisStatus'),output=view.querySelector('#analysisReport');
      const payload={scope,user_id:userId,report_type:view.querySelector('#analysisType').value,
        from:view.querySelector('#analysisFrom').value||null,to:view.querySelector('#analysisTo').value||null,
        include_hidden:view.querySelector('#analysisHidden').checked,
        analysis_acknowledged:view.querySelector('#analysisConsent').checked};
      if(payload.from&&payload.to&&payload.from>payload.to){status.textContent='Start date must precede end date.';return;}
      running=true;submit.disabled=true;sync();output.replaceChildren();status.textContent='Generating report… Please do not submit again.';
      try {
        const {data,error}=await getDb().functions.invoke('research-analysis',{body:payload});
        if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw new Error(message);}
        if(!data||data.error||typeof data.report!=='string')throw new Error(data?.error||'Invalid report response.');
        if(!active())return;
        status.textContent=`${data.stats.topic_count} topic(s), ${data.stats.completed_turn_count} completed turn(s). AI interpretations: review against the evidence. Report not saved.`;
        const text=document.createElement('div');text.style.whiteSpace='pre-wrap';text.style.overflowWrap='anywhere';text.textContent=data.report;output.append(text);
        const refs=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Evidence references';refs.append(summary);
        for(const item of data.evidence||[]){const p=document.createElement('p');p.className='small';p.style.overflowWrap='anywhere';
          p.textContent=`[${item.ref}] ${item.topic_title} · ${new Date(item.created_at).toLocaleString()} · conversation ${item.topic_id} · message ${item.turn_id}`;refs.append(p);}
        output.append(refs);
      } catch(err){if(active())status.textContent='Analysis failed: '+err.message;}
      finally{running=false;if(active())submit.disabled=false;sync();}
    };
  }
  const observer=new MutationObserver(addAssignedButtons);
  observer.observe($('workspace'),{childList:true,subtree:true});
  return {sync};
}

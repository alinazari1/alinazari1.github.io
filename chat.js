import { CONFIG } from './config.js';
import { marked } from
  'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
import DOMPurify from
  'https://esm.sh/dompurify';
const $=id=>document.getElementById(id);
const say=text=>{$('status').textContent=text;};
const ready=!!(CONFIG.supabaseUrl&&CONFIG.supabasePublishableKey&&!CONFIG.supabasePublishableKey.includes('REPLACE_')&&!CONFIG.supabasePublishableKey.includes('PASTE_')&&CONFIG.studyReady);
$('study').textContent=CONFIG.studyText;$('setup').hidden=ready;$('loginButton').disabled=true;
let db=null,session=null,chats=[],turns=[],selected=null,busy=false,uncertain=null;
const SpeechRecognitionAPI =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let voiceRecognition = null;
let voiceActive = false;
let voiceCancelled = false;
let voiceBaseText = '';
let voiceUserId = null;

function controls(){
   document.body.classList.toggle('signed-in', Boolean(session));
    const studyPanel = document.getElementById('study-panel');

  if (studyPanel) {
    studyPanel.hidden = Boolean(session);
  }
  $('auth').hidden=!!session; $('workspace').hidden=!session; $('loginButton').disabled=!db; 
  $('send').disabled =
  busy ||
  voiceActive ||
  !session ||
  !$('consent').checked ||
  !!uncertain;
  for(const id of ['new','refresh','logout','json','csv'])$(id).disabled=busy;$('check').hidden=!uncertain;$('check').disabled=busy; 
  syncVoiceControls();
}
function must(r){if(r.error)throw new Error(r.error.message);return r.data;}
async function rows(table){let result=[];for(let start=0;;start+=500){const batch=must(await db.from(table).select('*').order('id').range(start,start+499));result.push(...batch);if(batch.length<500)return result;}}
async function load(){const [c,t]=await Promise.all([rows('research_conversations'),rows('research_turns')]);chats=c.sort((a,b)=>b.created_at.localeCompare(a.created_at));turns=t;history();conversation();}
function history(){const q=$('search').value.trim().toLowerCase();const matches=chats.filter(c=>!q||c.title.toLowerCase().includes(q)||turns.some(t=>t.conversation_id===c.id&&((t.prompt||'')+' '+(t.response||'')).toLowerCase().includes(q)));$('history').replaceChildren();$('count').textContent=matches.length+' conversation(s)';for(const c of matches){const b=document.createElement('button');b.type='button';b.className='history-item'+(selected===c.id?' active':'');b.textContent=c.title+' · '+new Date(c.created_at).toLocaleDateString();b.disabled=busy;b.onclick=()=>{selected=c.id;history();conversation();};$('history').append(b);}}
function add(role,text,time,sources=[]){const box=document.createElement('article');box.className='msg '+role;const meta=document.createElement('div');meta.className='meta';meta.textContent=(role==='user'?'You':'AI assistant')+' · '+new Date(time).toLocaleString();const body=document.createElement('div');body.className='body';
  if (role === 'assistant') {
  const formatted = marked.parse(String(text), {
    gfm: true,
    breaks: true,
    async: false
  });

  body.innerHTML = DOMPurify.sanitize(formatted, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'del',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote',
      'pre', 'code', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: ['start']
  });

  body.classList.add('formatted');
} else {
  body.textContent = text;
}
                                        box.append(meta,body);if(Array.isArray(sources)){for(const s of sources){try{const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol))continue;const p=document.createElement('p'),a=document.createElement('a');a.href=u.href;a.textContent=s.title||u.href;a.target='_blank';a.rel='noopener noreferrer';p.append(a);box.append(p);}catch{}}}$('messages').append(box);}
function conversation(){$('title').textContent=chats.find(c=>c.id===selected)?.title||'New conversation';$('messages').replaceChildren();for(const t of turns.filter(t=>t.conversation_id===selected).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))){add('user',t.prompt,t.created_at);if(t.response)add('assistant',t.response,t.completed_at||t.created_at,t.sources);else{const p=document.createElement('p');p.className='small';p.textContent='Request status: '+t.status+' · ID: '+t.id;$('messages').append(p);}}$('messages').scrollTop=$('messages').scrollHeight;}
$('consent').onchange=controls;$('search').oninput=history;
if(ready){try{const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.49.8');db=createClient(CONFIG.supabaseUrl,CONFIG.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});db.auth.onAuthStateChange((_event,s)=>{session=s;if(!s){chats=[];turns=[];selected=null;uncertain=null;$('prompt').value='';history();conversation();}controls();});controls();}catch{say('Unable to load the sign-in service. Check config.js and your network.');}}
$('login').onsubmit=async e=>{e.preventDefault();if(!db)return;
if (!$('consent').checked) {
  return say(
    'Please read the privacy notice and check the consent box before signing in.'
  );
}
$('loginButton').disabled=true;say('Signing in…');try{const data=must(await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}));session=data.session;$('password').value='';await load();say('Signed in. Saved history loaded.');}catch(e){say(session?'Signed in, but history failed to load: '+e.message:'Sign-in failed: '+e.message);}finally{controls();}};
$('logout').onclick=async()=>{await db.auth.signOut({scope:'local'});session=null;uncertain=null;chats=[];turns=[];selected=null;$('prompt').value='';history();conversation();controls();say('Signed out. Saved records were not deleted.');};
$('new').onclick=()=>{selected=null;$('prompt').value='';history();conversation();say('New conversation. Existing database records remain saved.');};
$('refresh').onclick=async()=>{try{await load();say('History refreshed.');}catch(e){say('History error: '+e.message);}};
async function send(payload){busy=true;controls();history();say('Saving prompt and waiting for AI response…');try{const {data,error}=await db.functions.invoke(CONFIG.functionName,{body:payload});if(error){let text=error.message;try{text=(await error.context.json()).error||text;}catch{}throw new Error(text);}if(!data||!['completed','failed','interrupted','pending'].includes(data.status))throw new Error('Unrecognized backend response');if(data.conversation_id)selected=data.conversation_id;if(data.status==='completed'&&data.saved===true){uncertain=null;$('prompt').value='';say('Saved: prompt and AI response.');}else if(['failed','interrupted'].includes(data.status)){uncertain=null;say('Your prompt was saved, but no completed AI response was saved. Check the function Logs and research_turns.error_code.');}else{uncertain=payload;say('Request remains pending. Wait, then check the same request.');}await load();}catch(e){uncertain=payload;say(e.message+' Recording is uncertain. Check the same request rather than resubmitting. Request ID: '+payload.request_id);try{await load();}catch{}}finally{busy=false;controls();history();}}
$('composer').onsubmit=e=>{e.preventDefault();const message=$('prompt').value.trim();

<!-- if(!session||busy||uncertain||!$('consent').checked||!message)return; -->
if (
  !session ||
  busy ||
  voiceActive ||
  uncertain ||
  !$('consent').checked ||
  !message
) return;                           
send({request_id:crypto.randomUUID(),conversation_id:selected,message,consent_version:CONFIG.consentVersion});};$('check').onclick=()=>{if(uncertain&&!busy)send(uncertain);};
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
async function exportData(type){busy=true;controls();try{await load();if(type==='json')download('forenture-my-chats.json',JSON.stringify({exported_at:new Date().toISOString(),conversations:chats,turns},null,2),'application/json');else{const cols=['id','conversation_id','user_id','created_at','completed_at','status','prompt','response','model','preset','config_version','consent_version','consent_at','sources','usage','error_code'];const cell=v=>{let s=typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');if(/^\s*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const data=turns.slice().sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(t=>cols.map(c=>cell(t[c])).join(','));download('forenture-my-chats.csv','\uFEFF'+[cols.join(','),...data].join('\r\n'),'text/csv;charset=utf-8');}say('Exported all your saved chats. JSON preserves original text; CSV escapes formula-like values.');}catch(e){say('Export failed: '+e.message);}finally{busy=false;controls();history();}}
$('json').onclick=()=>exportData('json');$('csv').onclick=()=>exportData('csv');controls();

function voiceSay(message) {
  $('voiceStatus').textContent = message;
}

function cancelVoice() {
  if (!voiceActive || !voiceRecognition) return;

  voiceCancelled = true;
  voiceRecognition.abort();
}

function syncVoiceControls() {
  const button = $('voice');

  if (!button) return;

  if (!SpeechRecognitionAPI) {
    button.disabled = true;
    button.textContent = 'Voice unavailable';
    return;
  }

  // Discard dictation if the user signs out or changes accounts.
  if (
    voiceActive &&
    (
      !session ||
      session.user.id !== voiceUserId ||
      !$('consent').checked
    )
  ) {
    cancelVoice();
  }

  button.textContent = voiceActive ? 'Stop' : 'Speak';

  button.setAttribute(
    'aria-pressed',
    String(voiceActive)
  );

  button.disabled =
    !voiceRecognition ||
    !session ||
    busy ||
    !!uncertain ||
    !$('consent').checked;

  // Avoid editing the message while its voice transcript is pending.
  $('prompt').readOnly = voiceActive;

  // Prevent switching conversations during dictation.
  $('new').disabled = busy || voiceActive;
  $('refresh').disabled = busy || voiceActive;

  for (const button of $('history').querySelectorAll('button')) {
    button.disabled = busy || voiceActive;
  }
}

function initializeVoice() {
  if (!SpeechRecognitionAPI) {
    voiceSay(
      'Voice input is unavailable in this browser. ' +
      'You can continue typing.'
    );

    syncVoiceControls();
    return;
  }

  try {
    voiceRecognition = new SpeechRecognitionAPI();

    voiceRecognition.lang = 'en-US';
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = false;
    voiceRecognition.maxAlternatives = 1;
  } catch {
    voiceRecognition = null;

    voiceSay(
      'Voice input could not be initialized. ' +
      'You can continue typing.'
    );

    syncVoiceControls();
    return;
  }

  voiceRecognition.onstart = () => {
    if (voiceCancelled) {
      voiceRecognition.abort();
      return;
    }

    voiceSay(
      'Listening… Speak your question. Select Stop when finished.'
    );
  };

  voiceRecognition.onresult = event => {
    if (
      voiceCancelled ||
      !session ||
      session.user.id !== voiceUserId
    ) return;

    const pieces = [];

    for (
      let index = event.resultIndex;
      index < event.results.length;
      index++
    ) {
      if (event.results[index].isFinal) {
        pieces.push(event.results[index][0].transcript);
      }
    }

    const spokenText = pieces.join(' ').trim();

    if (!spokenText) return;

    const separator =
      voiceBaseText && !/\s$/.test(voiceBaseText) ? ' ' : '';

    const combined =
      voiceBaseText + separator + spokenText;

    const limit = $('prompt').maxLength > 0
      ? $('prompt').maxLength
      : 6000;

    $('prompt').value = combined.slice(0, limit);

    voiceBaseText = $('prompt').value;

    $('prompt').dispatchEvent(
      new Event('input', { bubbles: true })
    );

    voiceSay(
      combined.length > limit
        ? 'Text reached the message limit. Review it before sending.'
        : 'Voice text added. Review or edit it, then select Send.'
    );
  };

  voiceRecognition.onnomatch = () => {
    voiceSay(
      'Speech was not recognized. Please try again or type.'
    );
  };

  voiceRecognition.onerror = event => {
    if (voiceCancelled) return;

    const messages = {
      'not-allowed':
        'Microphone access was denied. Allow microphone access ' +
        'in your browser settings, or continue typing.',

      'service-not-allowed':
        'Speech recognition is blocked by this browser or device.',

      'audio-capture':
        'No microphone was available. Check your microphone.',

      'network':
        'The speech service could not be reached. ' +
        'Check your connection or continue typing.',

      'no-speech':
        'No speech was detected. Select Speak to try again.',

      'language-not-supported':
        'The selected speech language is not supported.',

      'aborted':
        'Voice input stopped.'
    };

    voiceSay(
      messages[event.error] ||
      'Voice input failed. Please try again or type.'
    );
  };

  voiceRecognition.onend = () => {
    const cancelled = voiceCancelled;

    voiceActive = false;
    voiceUserId = null;

    if (cancelled) {
      voiceSay('Voice input cancelled.');
    } else if (
      $('voiceStatus').textContent.startsWith('Listening') ||
      $('voiceStatus').textContent.startsWith('Starting') ||
      $('voiceStatus').textContent.startsWith('Finishing')
    ) {
      voiceSay('Voice input stopped. Review your message.');
    }

    controls();
  };

  $('voice').onclick = () => {
    if (!voiceRecognition) return;

    if (voiceActive) {
      voiceSay('Finishing voice input…');
      voiceRecognition.stop();
      return;
    }

    if (
      !session ||
      busy ||
      uncertain ||
      !$('consent').checked
    ) return;

    const limit = $('prompt').maxLength > 0
      ? $('prompt').maxLength
      : 6000;

    if ($('prompt').value.length >= limit) {
      voiceSay(
        'The message is already at its character limit.'
      );
      return;
    }

    voiceBaseText = $('prompt').value;
    voiceUserId = session.user.id;
    voiceCancelled = false;
    voiceActive = true;

    controls();

    voiceSay(
      'Starting voice input… Allow microphone access if prompted.'
    );

    try {
      voiceRecognition.start();
    } catch {
      voiceActive = false;
      voiceUserId = null;

      controls();

      voiceSay(
        'Could not start voice input. Please try again or type.'
      );
    }
  };

  // Search rebuilds the history buttons; restore their voice lock.
  $('search').addEventListener('input', syncVoiceControls);

  window.addEventListener('pagehide', cancelVoice);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelVoice();
  });

  syncVoiceControls();
}

initializeVoice();

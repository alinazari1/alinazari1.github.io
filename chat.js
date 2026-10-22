import { CONFIG } from './config.js';

import { marked } from
  'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

import DOMPurify from
  'https://esm.sh/dompurify';

const $ = id => document.getElementById(id);

const say = text => {
  $('status').textContent = text;
};

const ready = !!(
  CONFIG.supabaseUrl &&
  CONFIG.supabasePublishableKey &&
  !CONFIG.supabasePublishableKey.includes('REPLACE_') &&
  !CONFIG.supabasePublishableKey.includes('PASTE_') &&
  CONFIG.studyReady
);

$('study').textContent = CONFIG.studyText;
$('setup').hidden = ready;
$('loginButton').disabled = true;

let db = null;
let session = null;
let chats = [];
let turns = [];
let selected = null;
let busy = false;
let uncertain = null;

const SpeechRecognitionAPI =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let voiceRecognition = null;
let voiceActive = false;
let voiceCancelled = false;
let voiceBaseText = '';
let voiceUserId = null;


/* ---------- Shared controls ---------- */

function historyLocked() {
  return busy || voiceActive || !!uncertain || !session;
}

function controls() {
  document.body.classList.toggle(
    'signed-in',
    Boolean(session)
  );

  const studyPanel = $('study-panel');

  if (studyPanel) {
    studyPanel.hidden = Boolean(session);
  }

  $('auth').hidden = !!session;
  $('workspace').hidden = !session;
  $('loginButton').disabled = !db || busy;

  $('send').disabled =
    busy ||
    voiceActive ||
    !session ||
    !$('consent').checked ||
    !!uncertain;

  for (const id of ['new', 'refresh', 'logout', 'json', 'csv']) {
    $(id).disabled = busy;
  }

  $('check').hidden = !uncertain;
  $('check').disabled = busy;

  syncVoiceControls();
}

function must(result) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}


/* ---------- Load saved records ---------- */

async function rows(table) {
  const result = [];

  for (let start = 0; ; start += 500) {
    const batch = must(
      await db
        .from(table)
        .select('*')
        .order('id')
        .range(start, start + 499)
    );

    result.push(...batch);

    if (batch.length < 500) {
      return result;
    }
  }
}

async function load() {
  const userId = session?.user.id;

  if (!db || !userId) return;

  const [conversations, messages] = await Promise.all([
    rows('research_conversations'),
    rows('research_turns')
  ]);

  if (session?.user.id !== userId) return;

  chats = conversations.sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  turns = messages;

  if (
    selected &&
    !chats.some(c =>
      c.id === selected &&
      c.is_visible !== 0
    )
  ) {
    selected = null;
  }

  history();
  conversation();
}


/* ---------- History, pin, rename and soft delete ---------- */

function history() {
  const query = $('search').value.trim().toLowerCase();

  const matches = chats
    .filter(c => c.is_visible !== 0)
    .filter(c =>
      !query ||
      (c.title || '').toLowerCase().includes(query) ||
      turns.some(t =>
        t.conversation_id === c.id &&
        (
          (t.prompt || '') + ' ' + (t.response || '')
        ).toLowerCase().includes(query)
      )
    )
    .sort((a, b) =>
      Number(Boolean(b.is_pinned)) -
        Number(Boolean(a.is_pinned)) ||
      b.created_at.localeCompare(a.created_at) ||
      String(a.id).localeCompare(String(b.id))
    );

  $('history').replaceChildren();

  $('count').textContent =
    matches.length + ' conversation(s)';

  const locked = historyLocked();

  for (const topic of matches) {
    const title = topic.title || 'Untitled conversation';

    const row = document.createElement('div');
    row.className = 'topic-row';

    const open = document.createElement('button');
    open.type = 'button';

    open.className =
      'history-item' +
      (selected === topic.id ? ' active' : '');

    open.textContent =
      (topic.is_pinned ? '📌 ' : '') + title;

    open.title =
      title + ' · ' +
      new Date(topic.created_at).toLocaleDateString();

    open.disabled = locked;

    open.onclick = () => {
      if (historyLocked()) return;

      selected = topic.id;
      history();
      conversation();
    };

    const menu = document.createElement('details');
    menu.className = 'topic-menu';

    const trigger = document.createElement('summary');
    trigger.textContent = '…';
    trigger.setAttribute(
      'aria-label',
      'Options for ' + title
    );

    trigger.onclick = event => {
      if (historyLocked()) {
        event.preventDefault();
      }
    };

    trigger.setAttribute('aria-disabled', String(locked));

    menu.addEventListener('toggle', () => {
      if (!menu.open) return;

      for (const other of
        $('history').querySelectorAll('details.topic-menu')) {
        if (other !== menu) {
          other.open = false;
        }
      }
    });

    const panel = document.createElement('div');
    panel.className = 'topic-menu-panel';

    const addAction = (label, action, className = '') => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'topic-action ' + className;
      button.textContent = label;
      button.disabled = locked;

      button.onclick = () => {
        menu.open = false;

        if (historyLocked()) return;

        action();
      };

      panel.append(button);
    };

    addAction(
      topic.is_pinned ? 'Unpin' : 'Pin',
      () => togglePin(topic.id)
    );

    addAction(
      'Rename',
      () => renameTopic(topic.id)
    );

    addAction(
      'Delete',
      () => deleteTopic(topic.id),
      'topic-action-delete'
    );

    menu.append(trigger, panel);
    row.append(open, menu);

    $('history').append(row);
  }
}

async function updateTopicMetadata(id, changes) {
  if (!db || historyLocked()) return false;

  const topic = chats.find(c =>
    c.id === id &&
    c.is_visible !== 0
  );

  if (!topic) return false;

  const userId = session.user.id;

  busy = true;
  controls();
  history();

  try {
    const updated = must(
      await db
        .from('research_conversations')
        .update(changes)
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, title, is_visible, is_pinned')
        .single()
    );

    if (session?.user.id !== userId) return false;

    Object.assign(topic, updated);

    if (
      updated.is_visible === 0 &&
      selected === id
    ) {
      selected = null;
      $('prompt').value = '';
    }

    conversation();

    return true;
  } catch (error) {
      console.error('Topic update failed:', error);
    
      const message =
        'Topic update failed: ' + error.message;
    
      say(message);
      window.alert(message);
    
      return false;
    }
  } finally {
    busy = false;
    controls();
    history();
  }
}

async function renameTopic(id) {
  if (!db || historyLocked()) return;

  const topic = chats.find(c =>
    c.id === id &&
    c.is_visible !== 0
  );

  if (!topic) return;

  const answer = window.prompt(
    'Enter a new topic title:',
    topic.title || ''
  );

  if (answer === null) return;

  const title = answer.trim();

  if (!title) {
    say('The topic title cannot be empty.');
    return;
  }

  if (title === topic.title) return;

  say('Renaming topic…');

  const saved = await updateTopicMetadata(id, { title });

  if (saved) {
    say('Topic renamed.');
  }
}

async function togglePin(id) {
  if (!db || historyLocked()) return;

  const topic = chats.find(c =>
    c.id === id &&
    c.is_visible !== 0
  );

  if (!topic) return;

  const nextPinned = !topic.is_pinned;

  say(nextPinned ? 'Pinning topic…' : 'Unpinning topic…');

  const saved = await updateTopicMetadata(id, {
    is_pinned: nextPinned
  });

  if (saved) {
    say(nextPinned ? 'Topic pinned.' : 'Topic unpinned.');
  }
}

async function deleteTopic(id) {
  if (!db || historyLocked()) return;

  const topic = chats.find(c =>
    c.id === id &&
    c.is_visible !== 0
  );

  if (!topic) return;

  const confirmed = window.confirm(
    'Remove "' +
    (topic.title || 'Untitled conversation') +
    '" from your history?\n\n' +
    'The conversation and messages will remain stored ' +
    'for the study. This does not erase the records.'
  );

  if (!confirmed) return;

  say('Removing topic from history…');

  const saved = await updateTopicMetadata(id, {
    is_visible: 0,
    is_pinned: false
  });

  if (saved) {
    say(
      'Topic removed from your history. ' +
      'Database records retained.'
    );
  }
}


/* ---------- Render messages ---------- */

function add(role, text, time, sources = []) {
  const box = document.createElement('article');
  box.className = 'msg ' + role;

  const meta = document.createElement('div');
  meta.className = 'meta';

  meta.textContent =
    (role === 'user' ? 'You' : 'AI assistant') +
    ' · ' +
    new Date(time).toLocaleString();

  const body = document.createElement('div');
  body.className = 'body';

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

  box.append(meta, body);

  if (Array.isArray(sources)) {
    for (const source of sources) {
      try {
        const url = new URL(source.url);

        if (!['https:', 'http:'].includes(url.protocol)) {
          continue;
        }

        const paragraph = document.createElement('p');
        const link = document.createElement('a');

        link.href = url.href;
        link.textContent = source.title || url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';

        paragraph.append(link);
        box.append(paragraph);
      } catch {
        // Ignore invalid source URLs.
      }
    }
  }

  $('messages').append(box);
}

function conversation() {
  const current = chats.find(c =>
    c.id === selected &&
    c.is_visible !== 0
  );

  $('title').textContent =
    current?.title || 'New conversation';

  $('messages').replaceChildren();

  if (!current) return;

  const messages = turns
    .filter(t => t.conversation_id === selected)
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
    );

  for (const turn of messages) {
    add('user', turn.prompt, turn.created_at);

    if (turn.response) {
      add(
        'assistant',
        turn.response,
        turn.completed_at || turn.created_at,
        turn.sources
      );
    } else {
      const paragraph = document.createElement('p');

      paragraph.className = 'small';

      paragraph.textContent =
        'Request status: ' +
        turn.status +
        ' · ID: ' +
        turn.id;

      $('messages').append(paragraph);
    }
  }

  $('messages').scrollTop = $('messages').scrollHeight;
}


/* ---------- Authentication ---------- */

$('consent').onchange = controls;
$('search').oninput = history;

if (ready) {
  try {
    const { createClient } = await import(
      'https://esm.sh/@supabase/supabase-js@2.49.8'
    );

    db = createClient(
      CONFIG.supabaseUrl,
      CONFIG.supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );

    db.auth.onAuthStateChange((_event, newSession) => {
      session = newSession;

      if (!newSession) {
        chats = [];
        turns = [];
        selected = null;
        uncertain = null;

        $('prompt').value = '';

        history();
        conversation();
      }

      controls();
    });

    controls();
  } catch {
    say(
      'Unable to load the sign-in service. ' +
      'Check config.js and your network.'
    );
  }
}

$('signupButton').onclick = async () => {
  if (!db || busy) return;

  if (!$('consent').checked) {
    say('Please check the privacy notice before signing up.');
    return;
  }

  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email || password.length < 8) {
    say(
      'Enter your email and a password of at least 8 characters.'
    );
    return;
  }

  $('signupButton').disabled = true;
  say('Creating your account…');

  try {
    const { data, error } = await db.auth.signUp({
      email,
      password
    });

    if (error) {
      throw new Error(error.message);
    }

    if (data.session) {
      session = data.session;
      await load();

      say('Account created. You are signed in.');
    } else {
      say(
        'Please check your email for a confirmation link. ' +
        'Click the link to verify your email address, ' +
        'then return here to sign in. ' +
        'If you don’t see the email, check your Spam or Junk folder.'
      );
    }
  } catch (error) {
    say('Sign-up failed: ' + error.message);
  } finally {
    $('signupButton').disabled = false;
    controls();
  }
};

$('login').onsubmit = async event => {
  event.preventDefault();

  if (!db || busy) return;

  if (!$('consent').checked) {
    say(
      'Please read the privacy notice and check ' +
      'the consent box before signing in.'
    );
    return;
  }

  $('loginButton').disabled = true;
  say('Signing in…');

  try {
    const data = must(
      await db.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value
      })
    );

    session = data.session;
    $('password').value = '';

    await load();

    say('Signed in. Saved history loaded.');
  } catch (error) {
    say(
      session
        ? 'Signed in, but history failed to load: ' + error.message
        : 'Sign-in failed: ' + error.message
    );
  } finally {
    controls();
  }
};

$('logout').onclick = async () => {
  if (busy) return;

  cancelVoice();

  try {
    const result = await db.auth.signOut({ scope: 'local' });

    if (result.error) {
      throw new Error(result.error.message);
    }

    session = null;
    uncertain = null;
    chats = [];
    turns = [];
    selected = null;

    $('prompt').value = '';

    history();
    conversation();
    controls();

    say('Signed out. Saved records were not deleted.');
  } catch (error) {
    say('Sign-out failed: ' + error.message);
  }
};


/* ---------- New conversation and refresh ---------- */

$('new').onclick = () => {
  if (busy || voiceActive) return;

  selected = null;
  $('prompt').value = '';

  history();
  conversation();

  say('New conversation. Existing database records remain saved.');
};

$('refresh').onclick = async () => {
  if (busy || voiceActive) return;

  try {
    await load();
    say('History refreshed.');
  } catch (error) {
    say('History error: ' + error.message);
  }
};


/* ---------- Send messages ---------- */

async function send(payload) {
  busy = true;

  controls();
  history();

  say('Saving prompt and waiting for AI response…');

  try {
    const { data, error } = await db.functions.invoke(
      CONFIG.functionName,
      { body: payload }
    );

    if (error) {
      let text = error.message;

      try {
        text = (await error.context.json()).error || text;
      } catch {
        // Keep the original error message.
      }

      throw new Error(text);
    }

    if (
      !data ||
      !['completed', 'failed', 'interrupted', 'pending']
        .includes(data.status)
    ) {
      throw new Error('Unrecognized backend response');
    }

    if (data.conversation_id) {
      selected = data.conversation_id;
    }

    if (data.status === 'completed' && data.saved === true) {
      uncertain = null;
      $('prompt').value = '';

      say('Saved: prompt and AI response.');
    } else if (['failed', 'interrupted'].includes(data.status)) {
      uncertain = null;

      say(
        'Your prompt was saved, but no completed AI response ' +
        'was saved. Check the function Logs and ' +
        'research_turns.error_code.'
      );
    } else {
      uncertain = payload;

      say(
        'Request remains pending. Wait, then check the same request.'
      );
    }

    await load();
  } catch (error) {
    uncertain = payload;

    say(
      error.message +
      ' Recording is uncertain. Check the same request ' +
      'rather than resubmitting. Request ID: ' +
      payload.request_id
    );

    try {
      await load();
    } catch {
      // Preserve the uncertain request for checking.
    }
  } finally {
    busy = false;

    controls();
    history();
  }
}

$('composer').onsubmit = event => {
  event.preventDefault();

  const message = $('prompt').value.trim();

  if (
    !session ||
    busy ||
    voiceActive ||
    uncertain ||
    !$('consent').checked ||
    !message
  ) {
    return;
  }

  send({
    request_id: crypto.randomUUID(),
    conversation_id: selected,
    message,
    consent_version: CONFIG.consentVersion
  });
};

$('check').onclick = () => {
  if (uncertain && !busy) {
    send(uncertain);
  }
};


/* ---------- Export all saved records ---------- */

function download(name, text, type) {
  const url = URL.createObjectURL(
    new Blob([text], { type })
  );

  const link = document.createElement('a');

  link.href = url;
  link.download = name;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportData(type) {
  if (!db || !session || busy || voiceActive) return;

  busy = true;
  controls();
  history();

  try {
    await load();

    if (type === 'json') {
      download(
        'forenture-my-chats.json',
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            conversations: chats,
            turns
          },
          null,
          2
        ),
        'application/json'
      );
    } else {
      const columns = [
        'id',
        'conversation_id',
        'user_id',
        'created_at',
        'completed_at',
        'status',
        'prompt',
        'response',
        'model',
        'preset',
        'config_version',
        'consent_version',
        'consent_at',
        'sources',
        'usage',
        'error_code'
      ];

      const cell = value => {
        let text =
          typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value ?? '');

        if (/^\s*[=+@\-\t\r]/.test(text)) {
          text = "'" + text;
        }

        return '"' + text.replaceAll('"', '""') + '"';
      };

      const data = turns
        .slice()
        .sort((a, b) =>
          a.created_at.localeCompare(b.created_at)
        )
        .map(turn =>
          columns.map(column => cell(turn[column])).join(',')
        );

      download(
        'forenture-my-chats.csv',
        '\uFEFF' +
          [columns.join(','), ...data].join('\r\n'),
        'text/csv;charset=utf-8'
      );
    }

    say(
      'Exported all your saved chats, including topics removed ' +
      'from history. JSON preserves original text; ' +
      'CSV escapes formula-like values.'
    );
  } catch (error) {
    say('Export failed: ' + error.message);
  } finally {
    busy = false;

    controls();
    history();
  }
}

$('json').onclick = () => exportData('json');
$('csv').onclick = () => exportData('csv');


/* ---------- Voice input ---------- */

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

  if (!SpeechRecognitionAPI) {
    button.disabled = true;
    button.textContent = 'Voice unavailable';
  } else {
    button.textContent = voiceActive ? 'Stop' : 'Speak';

    button.disabled =
      !voiceRecognition ||
      !session ||
      busy ||
      !!uncertain ||
      !$('consent').checked;
  }

  button.setAttribute(
    'aria-pressed',
    String(voiceActive)
  );

  $('prompt').readOnly = voiceActive;

  $('new').disabled = busy || voiceActive;
  $('refresh').disabled = busy || voiceActive;

  for (const historyButton of
    $('history').querySelectorAll('button')) {
    historyButton.disabled = historyLocked();
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
    ) {
      return;
    }

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

    const limit =
      $('prompt').maxLength > 0
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
    ) {
      return;
    }

    const limit =
      $('prompt').maxLength > 0
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

  $('search').addEventListener('input', syncVoiceControls);

  window.addEventListener('pagehide', cancelVoice);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelVoice();
    }
  });

  syncVoiceControls();
}


/* ---------- Initial page state ---------- */

controls();
initializeVoice();

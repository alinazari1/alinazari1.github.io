import { CONFIG } from './config.js';

import { createAdvisorTopics } from './advisor-topics.js?v=sidebar-layout-6';

import { mountAnalysisUI } from
  './analysis-ui-patch.js?v=concept-network-2';

import { createTopicSharing } from './topic-sharing.js?v=2';

import { createSharedTopics } from './shared-topics.js?v=3';
import { createCaseSamples } from './case-samples.js?v=1';

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
let sharedTopicIds = new Set();
let inheritedTurnIds = new Set();

const SpeechRecognitionAPI =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let voiceRecognition = null;
let voiceActive = false;
let voiceCancelled = false;
let voiceBaseText = '';
let voiceUserId = null;
const advisorTopics = createAdvisorTopics({
  getDb: () => db,
  getSession: () => session,
  isLocked: () => historyLocked()
});
const analysisUI = mountAnalysisUI({
  getDb: () => db,
  getSession: () => session,
  isLocked: () => historyLocked()
});
const topicSharing = createTopicSharing({
  getDb: () => db,
  getSession: () => session,
  isLocked: () => historyLocked(),

  onSharingChange: (topicId, recipientCount) => {
    if (recipientCount > 0) {
      sharedTopicIds.add(topicId);
    } else {
      sharedTopicIds.delete(topicId);
    }

    history();
  }
});

const sharedTopics = createSharedTopics({
  getDb: () => db,
  getSession: () => session,
  isLocked: () => historyLocked(),

  onCopied: async conversationId => {
    const userId = session?.user.id;
    if (!userId) return;

    await load();

    if (session?.user.id !== userId) return;

    selected = conversationId;
    $('prompt').value = '';

    history();
    conversation();

    say(
      'Full-case copy created. Inherited messages are labelled; ' +
      'new messages you send belong to your own continuation.'
    );
  }
});

const caseSamples = createCaseSamples({
  getDb: () => db,
  getSession: () => session,
  isLocked: () => historyLocked(),

  openCase: topic => sharedTopics.open(topic),

  onChange: () => {
    history();
    syncPublishedCaseComposer();
  }
});

function syncPublishedCaseComposer() {
  const locked = caseSamples.isPublished(selected);

  $('composer').hidden = locked;

  let notice = $('publishedCaseNotice');

  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'publishedCaseNotice';
    notice.className = 'small';
    $('title').after(notice);
  }

  notice.hidden = !locked;
  notice.textContent =
    'Published case sample — the original is locked. ' +
    'Use the Case samples panel to view it. To edit the original, ' +
    'withdraw it through this topic’s menu first.';
}
/* ---------- Shared controls ---------- */

function historyLocked() {
  return busy || voiceActive || !!uncertain || !session;
}

function controls() {
  document.body.classList.toggle(
    'signed-in',
    Boolean(session)
  );
  // Stop the login video after signing in.
  const loginVideo = $('brandVideo');

  if (session && loginVideo) {
    loginVideo.pause();
  }
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
  syncAdvisorAdminUI();
  advisorTopics.sync();
  analysisUI.sync();
  topicSharing.sync();
  sharedTopics.sync();
  caseSamples.sync();
}

function must(result) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}


/* ---------- Load saved records ---------- */

async function rows(table) {
  const userId = session?.user.id;

  if (!db || !userId) return [];

  const result = [];

  for (let start = 0; ; start += 500) {

    const batch = must(
      await db
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .order('id')
        .range(start, start + 499)
    );
    
    if (session?.user.id !== userId) return [];

    result.push(...batch);

    if (batch.length < 500) {
      return result;
    }
  }
}

async function loadSharedTopicIds() {
  const userId = session?.user.id;

  if (!db || !userId) return new Set();

  const ids = new Set();

  for (let start = 0; ; start += 500) {
    const batch = must(
      await db
        .from('research_topic_shares')
        .select('conversation_id, recipient_id')
        .eq('shared_by', userId)
        .order('conversation_id')
        .order('recipient_id')
        .range(start, start + 499)
    );

    if (session?.user.id !== userId) {
      return new Set();
    }

    for (const row of batch) {
      ids.add(row.conversation_id);
    }

    if (batch.length < 500) {
      return ids;
    }
  }
}

async function loadInheritedTurnIds() {
  const userId = session?.user.id;

  if (!db || !userId) return new Set();

  const ids = new Set();

  for (let start = 0; ; start += 500) {
    const batch = must(
      await db
        .from('research_case_copy_origins')
        .select('copied_conversation_id, turn_id_map')
        .eq('copied_by', userId)
        .order('copied_conversation_id')
        .range(start, start + 499)
    );

    if (session?.user.id !== userId) return new Set();

    for (const row of batch) {
      for (const newId of Object.values(row.turn_id_map || {})) {
        ids.add(newId);
      }
    }

    if (batch.length < 500) return ids;
  }
}
async function load() {
  const userId = session?.user.id;

  if (!db || !userId) return;
  
  const [
    conversations,
    messages,
    sharedIds,
    inheritedIds
  ] = await Promise.all([
    rows('research_conversations'),
    rows('research_turns'),
    loadSharedTopicIds(),
    loadInheritedTurnIds()
  ]);
  
  if (session?.user.id !== userId) return;

  chats = conversations.sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  turns = messages;
  sharedTopicIds = sharedIds;
  inheritedTurnIds = inheritedIds;
  
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
  // Remove old floating menus before rebuilding the list.
  for (const panel of
    document.querySelectorAll('.floating-topic-menu')) {
    panel.remove();
  }

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
  
  // Use the existing heading, or create it if not yet mounted.
  let heading = $('myTopicsHeading');

  if (!heading) {
    heading = document.createElement('h3');
    heading.id = 'myTopicsHeading';
    $('history').before(heading);
  }

  heading.textContent = `My topics (${matches.length})`;

  // Keep the element for compatibility, but remove the old count.
  $('count').textContent = '';
  $('count').hidden = true;

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

    const isShared = sharedTopicIds.has(topic.id);

    open.textContent =
      (topic.is_pinned ? '📌 ' : '') +
      (isShared ? '↗ ' : '') +
      title;

    open.title =
      title +
      (isShared ? ' · Shared with other users' : '') +
      ' · ' +
      new Date(topic.created_at).toLocaleDateString();

    open.setAttribute(
      'aria-label',
      title + (isShared ? ', shared with other users' : '')
    );
    
    open.disabled = locked;

    open.onclick = () => {
      if (historyLocked()) return;

      selected = topic.id;
      history();
      conversation();
    };

    const trigger = document.createElement('button');

    trigger.type = 'button';
    trigger.className = 'topic-menu-trigger';
    trigger.textContent = '…';
    trigger.disabled = locked;

    trigger.setAttribute(
      'aria-label',
      'Options for ' + title
    );

    const panel = document.createElement('div');

    panel.className = 'floating-topic-menu';
    panel.id = 'topic-options-' + topic.id;
    panel.setAttribute('popover', 'auto');

    trigger.setAttribute('popovertarget', panel.id);
    trigger.setAttribute('popovertargetaction', 'toggle');

    const addAction = (label, action, extraClass = '') => {
      const button = document.createElement('button');

      button.type = 'button';
      button.className =
        'floating-topic-action ' + extraClass;

      button.textContent = label;
      button.disabled = locked;

      button.onclick = () => {
        panel.hidePopover();

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
      'Share',
      () => topicSharing.open(topic)
    );

    const isAdmin =
      session?.user.email?.trim().toLowerCase() ===
      'infoforenture@gmail.com';

    if (isAdmin) {
      addAction(
        caseSamples.isPublished(topic.id)
          ? 'Withdraw case sample'
          : 'Publish as case sample',
        () => caseSamples.manage(topic)
      );
    }
    
    addAction(
      'Rename',
      () => renameTopic(topic.id)
    );

    addAction(
      'Delete',
      () => deleteTopic(topic.id),
      'floating-topic-delete'
    );

    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) return;

      if (historyLocked()) {
        panel.hidePopover();
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const edge = 8;

      const width = panel.offsetWidth;
      const height = panel.offsetHeight;

      const viewportWidth =
        document.documentElement.clientWidth;

      const viewportHeight =
        document.documentElement.clientHeight;

      // Align with the dots button, keeping the menu onscreen.
      const left = Math.max(
        edge,
        Math.min(
          rect.right - width,
          viewportWidth - width - edge
        )
      );

      // Open upward when there is insufficient space below.
      let top = rect.bottom + gap;

      if (top + height > viewportHeight - edge) {
        top = rect.top - height - gap;
      }

      top = Math.max(
        edge,
        Math.min(top, viewportHeight - height - edge)
      );

      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.visibility = 'visible';
    });

    panel.addEventListener('beforetoggle', event => {
      if (event.newState === 'open') {
        panel.style.visibility = 'hidden';
      }
    });

    // Attach the floating menu to the page, not the sidebar.
    document.body.append(panel);

    row.append(open, trigger);
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

function add(role, text, time, sources = [], inherited = false) {
  const box = document.createElement('article');
  box.className = 'msg ' + role;

  const meta = document.createElement('div');
  meta.className = 'meta';

  meta.textContent =
    (
      role === 'user'
        ? inherited
          ? 'Original author — copied message'
          : 'You'
        : inherited
          ? 'AI assistant — copied response'
          : 'AI assistant'
    ) +
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

  syncPublishedCaseComposer();
  $('messages').replaceChildren();

  analysisUI.setContext(
    current || null,
    current
      ? turns.filter(t => t.conversation_id === current.id)
      : []
  );
  
  if (!current) return;

  const messages = turns
    .filter(t => t.conversation_id === selected)
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
    );

  for (const turn of messages) {
    add(
      'user',
      turn.prompt,
      turn.created_at,
      [],
      inheritedTurnIds.has(turn.id)
    );

    if (turn.response) {
      add(
        'assistant',
        turn.response,
        turn.completed_at || turn.created_at,
        turn.sources,
        inheritedTurnIds.has(turn.id)
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
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );

    db.auth.onAuthStateChange((event, newSession) => {
      session = newSession;

      if (!newSession) {
        chats = [];
        turns = [];
        selected = null;
        uncertain = null;

        sharedTopicIds = new Set();
        inheritedTurnIds = new Set();

        $('prompt').value = '';

        history();
        conversation();
      }

      controls();

      // Restore personal history after a page reload.
      // Keep database calls outside the auth callback itself.
      if (event === 'INITIAL_SESSION' && newSession) {
        const restoredUserId = newSession.user.id;

        setTimeout(async () => {
          if (session?.user.id !== restoredUserId) return;

          try {
            await load();

            if (session?.user.id === restoredUserId) {
              say('Session restored. Saved history loaded.');
            }
          } catch (error) {
            if (session?.user.id === restoredUserId) {
              say(
                'Signed in, but history could not load: ' +
                error.message
              );
            }
          }
        }, 0);
      }
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
  if (historyLocked()) return;

  try {
    await load();
    await advisorTopics.refresh();

    say(
      'Personal history refreshed. ' +
      'Check the assigned-users panel for advisor status.'
    );
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

  const available =
    Boolean(SpeechRecognitionAPI && voiceRecognition);

  const label = !available
    ? 'Voice input unavailable in this browser'
    : voiceActive
      ? 'Stop voice input'
      : 'Start voice input';

  button.innerHTML = voiceActive
    ? `
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="6" y="6" width="12" height="12" rx="2"/>
      </svg>
    `
    : `
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
        <path d="M12 19v3M8 22h8"/>
      </svg>
    `;

  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(voiceActive));

  button.disabled =
    !available ||
    !session ||
    busy ||
    !!uncertain ||
    !$('consent').checked;

  $('prompt').readOnly = voiceActive;

  $('new').disabled = busy || voiceActive;
  $('refresh').disabled = busy || voiceActive;

  for (
    const historyButton of
    $('history').querySelectorAll('button')
  ) {
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
    voiceRecognition.continuous = true;
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

function closeFloatingTopicMenus(event) {
  for (const panel of
    document.querySelectorAll(
      '.floating-topic-menu:popover-open'
    )) {

    // Allow scrolling inside the menu itself on small screens.
    if (
      event?.target instanceof Node &&
      panel.contains(event.target)
    ) {
      continue;
    }

    panel.hidePopover();
  }
}

document.addEventListener(
  'scroll',
  closeFloatingTopicMenus,
  true
);

window.addEventListener(
  'resize',
  closeFloatingTopicMenus
);



/* ---------- Administrator: advisors and assigned users ---------- */

function syncAdvisorAdminUI() {
  const isAdmin =
    session?.user.email?.trim().toLowerCase() ===
    'infoforenture@gmail.com';

  let button = $('manageAdvisors');

  if (!button) {
    button = document.createElement('button');
    button.id = 'manageAdvisors';
    button.type = 'button';
    button.onclick = openAdvisorAdmin;
  }

  button.className = 'secondary sidebar-small-action';
  button.textContent = 'Manage adviser';
  button.title = 'Manage advisers and assigned users';

  // Remove the previous full-width inline styling.
  button.style.removeProperty('width');
  button.style.removeProperty('margin-bottom');

  const exportRow = document.querySelector(
    '#workspace aside.card .sidebar-export-actions'
  );

  if (exportRow && button.parentElement !== exportRow) {
    exportRow.append(button);
  }

  button.hidden = !isAdmin;
  button.disabled = busy || voiceActive || !!uncertain;

  if (!isAdmin) {
    const dialog = $('advisorAdminDialog');

    if (dialog) {
      if (dialog.open) dialog.close();
      dialog.remove();
    }
  }
}

async function openAdvisorAdmin() {
  if (
    !db ||
    !session ||
    busy ||
    voiceActive ||
    uncertain ||
    session.user.email?.toLowerCase() !==
      'infoforenture@gmail.com'
  ) {
    return;
  }

  const existing = $('advisorAdminDialog');

  if (existing) {
    if (!existing.open) existing.showModal();
    return;
  }

  const ownerId = session.user.id;
  const dialog = document.createElement('dialog');

  dialog.id = 'advisorAdminDialog';

  Object.assign(dialog.style, {
    width: 'min(700px, calc(100vw - 24px))',
    maxHeight: '85dvh',
    overflowY: 'auto',
    padding: '24px',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    background: 'var(--surface)',
    color: 'var(--text)'
  });

  // Static markup only. Account data is inserted with textContent.
  dialog.innerHTML = `
    <h2 id="advisorAdminHeading">Manage advisors</h2>
    <p class="small">
      Choose an account, set advisor status, and select its assigned users.
      Saving replaces that account's current assignments.
    </p>

    <form id="advisorAdminForm">
      <label for="adminAdvisorSelect">Advisor account</label>
      <select id="adminAdvisorSelect" required disabled
        style="width:100%; padding:12px; font:inherit;">
      </select>

      <label class="check">
        <input id="adminAdvisorEnabled" type="checkbox" disabled>
        <span>This account is an advisor</span>
      </label>

      <label for="adminUserSearch">Search users</label>
      <input id="adminUserSearch" type="search"
        placeholder="Search by email" disabled>

      <fieldset id="adminAssignedFieldset" disabled>
        <legend>Assigned users</legend>
        <div id="adminAssignedList"
          style="max-height:280px; overflow-y:auto;"></div>
      </fieldset>

      <p class="small">
        Removing advisor status also removes its assignments.
        User accounts and saved conversations are not deleted.
      </p>

      <p id="adminAdvisorStatus" role="status" aria-live="polite"></p>

      <div class="row">
        <button id="adminAdvisorSave" type="submit" disabled>
          Save changes
        </button>
        <button id="adminAdvisorClose" type="button"
          class="secondary">Close</button>
      </div>
    </form>
  `;

  dialog.setAttribute('aria-labelledby', 'advisorAdminHeading');
  document.body.append(dialog);
  dialog.showModal();

  const select = $('adminAdvisorSelect');
  const enabled = $('adminAdvisorEnabled');
  const search = $('adminUserSearch');
  const list = $('adminAssignedList');
  const fieldset = $('adminAssignedFieldset');
  const save = $('adminAdvisorSave');
  const status = $('adminAdvisorStatus');

  let directory = { users: [], assignments: [] };
  let checked = new Set();
  let saving = false;

  const stillCurrent = () =>
    dialog.isConnected &&
    session?.user.id === ownerId &&
    session.user.email?.toLowerCase() ===
      'infoforenture@gmail.com';

  function renderAssignedUsers() {
    list.replaceChildren();

    const query = search.value.trim().toLowerCase();

    for (const user of directory.users) {
      if (user.id === select.value) continue;

      if (
        query &&
        !user.email.toLowerCase().includes(query)
      ) {
        continue;
      }

      const label = document.createElement('label');
      label.className = 'check';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checked.has(user.id);

      checkbox.onchange = () => {
        if (checkbox.checked) {
          checked.add(user.id);
        } else {
          checked.delete(user.id);
        }
      };

      const text = document.createElement('span');
      text.textContent = user.email;

      label.append(checkbox, text);
      list.append(label);
    }

    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'small';
      empty.textContent = 'No matching users.';
      list.append(empty);
    }
  }

  function selectAdvisor() {
    const user = directory.users.find(
      item => item.id === select.value
    );

    enabled.checked = Boolean(user?.is_advisor);

    checked = new Set(
      directory.assignments
        .filter(item => item.advisor_id === select.value)
        .map(item => item.user_id)
    );

    search.value = '';
    status.textContent = '';
    fieldset.disabled = !enabled.checked;

    renderAssignedUsers();
  }

  function closeDialog() {
    if (saving) return;

    dialog.close();
    dialog.remove();
  }

  $('adminAdvisorClose').onclick = closeDialog;

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog();
  });

  select.onchange = selectAdvisor;
  search.oninput = renderAssignedUsers;

  enabled.onchange = () => {
    fieldset.disabled = !enabled.checked;
  };

  async function loadDirectory(preferredId) {
    const data = must(
      await db.rpc('forenture_admin_directory')
    );

    if (!stillCurrent()) return false;

    directory = data;
    select.replaceChildren();

    for (const user of directory.users) {
      const option = document.createElement('option');

      option.value = user.id;
      option.textContent =
        user.email +
        (user.is_advisor ? ' — Advisor' : '');

      select.append(option);
    }

    if (
      preferredId &&
      directory.users.some(user => user.id === preferredId)
    ) {
      select.value = preferredId;
    }

    selectAdvisor();
    return true;
  }

  $('advisorAdminForm').onsubmit = async event => {
    event.preventDefault();

    if (saving || !stillCurrent() || !select.value) return;

    const advisor = directory.users.find(
      user => user.id === select.value
    );

    const advisorId = select.value;
    const advisorEnabled = enabled.checked;
    const assignedIds = advisorEnabled ? [...checked] : [];

    const confirmed = window.confirm(
      'Save advisor settings for ' + advisor.email + '?\n\n' +
      'Advisor: ' + (advisorEnabled ? 'Yes' : 'No') + '\n' +
      'Assigned users: ' + assignedIds.length + '\n\n' +
      'This replaces the current assignments for this account.'
    );

    if (!confirmed) return;

    saving = true;
    select.disabled = true;
    enabled.disabled = true;
    search.disabled = true;
    fieldset.disabled = true;
    save.disabled = true;
    $('adminAdvisorClose').disabled = true;

    status.textContent = 'Saving…';

    try {
      must(
        await db.rpc('forenture_admin_save_advisor', {
          p_advisor_id: advisorId,
          p_enabled: advisorEnabled,
          p_user_ids: assignedIds
        })
      );

      if (!stillCurrent()) return;

      await loadDirectory(advisorId);

      if (stillCurrent()) {
        status.textContent = 'Advisor settings saved.';
      }
    } catch (error) {
      if (stillCurrent()) {
        status.textContent = 'Save failed: ' + error.message;
      }
    } finally {
      saving = false;

      if (stillCurrent()) {
        select.disabled = false;
        enabled.disabled = false;
        search.disabled = false;
        fieldset.disabled = !enabled.checked;
        save.disabled = false;
        $('adminAdvisorClose').disabled = false;
      }
    }
  };

  status.textContent = 'Loading accounts…';

  try {
    const loaded = await loadDirectory();

    if (!loaded) return;

    const hasUsers = directory.users.length > 0;

    select.disabled = !hasUsers;
    enabled.disabled = !hasUsers;
    search.disabled = !hasUsers;
    save.disabled = !hasUsers;

    status.textContent = hasUsers
      ? ''
      : 'No registered accounts found.';
  } catch (error) {
    if (stillCurrent()) {
      status.textContent =
        'Could not load administrator form: ' + error.message;
    }
  }
}

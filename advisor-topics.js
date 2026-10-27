import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
import DOMPurify from 'https://esm.sh/dompurify';

export function createAdvisorTopics({ getDb, getSession, isLocked }) {
  const $ = id => document.getElementById(id);
  let account = null;
  let generation = 0;
  let reviewRequest = 0;
  let panel = null;
  let dialog = null;
  let personalChatPanel = null;
  let assignments = [];
  let reloadTimer = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function current(version) {
    return version === generation && account &&
      getSession()?.user.id === account;
  }

  async function collect(makeQuery, version) {
    const all = [];
    for (let start = 0; ; start += 200) {
      if (!current(version)) throw new Error('Session changed.');
      const { data, error } = await makeQuery().range(start, start + 199);
      if (!current(version)) throw new Error('Session changed.');
      if (error) throw new Error(error.message);
      all.push(...data);
      if (data.length < 200) return all;
    }
  }

  function closeReview() {
    reviewRequest++;

    if (dialog) {
      dialog.remove();
      dialog = null;

      if (personalChatPanel?.isConnected) {
        personalChatPanel.hidden = false;
      }
    }

    personalChatPanel = null;
  }

  function ensurePanel() {
    if (panel) return;
    if (!$('myTopicsHeading')) {
      const heading = element('h3', 'My topics');
      heading.id = 'myTopicsHeading';
      $('history').before(heading);
    }
    panel = element('section');
    panel.id = 'advisorTopicsPanel';
    panel.hidden = true;
    panel.innerHTML = `
      <hr>
      
    <div class="assigned-users-header">
        <h3 id="assignedUsersHeading">Assigned users (0)</h3>
    
      <button
        id="advisorTopicsRefresh"
        type="button"
        class="secondary assigned-refresh"
        title="Refresh assigned users and topics"
        aria-label="Refresh assigned users and topics"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20 7v5h-5"/>
          <path d="M4 17v-5h5"/>
          <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9"/>
          <path d="M17.9 17a7 7 0 0 1-11.6 1L4 15"/>
        </svg>
      </button>
    </div>
      
      <p class="small">Open a user to see their topics. Conversations are read-only.</p>
      <input
        id="advisorTopicSearch"
        type="search"
        placeholder="Search users or topics…"
        aria-label="Search assigned users and topic titles"
      >
      <label class="check">
        <input id="advisorIncludeHidden" type="checkbox">
        <span>Include hidden conversations</span>
      </label>
      
      <p id="advisorTopicsStatus" class="small" role="status" aria-live="polite"></p>
      <div id="advisorUsersList"></div>`;
    $('history').after(panel);
    $('advisorTopicsRefresh').onclick = refresh;
    $('advisorTopicSearch').oninput = filterTree;
    $('advisorIncludeHidden').onchange = () => {
      closeReview();
      renderUsers();
    };
  }

  function filterTree() {
    if (!panel) return;
    const query = $('advisorTopicSearch').value.trim().toLowerCase();
    for (const details of $('advisorUsersList').children) {
      const userMatches = details.dataset.label.includes(query);
      let topicMatches = false;
      for (const button of details.querySelectorAll('[data-topic-title]')) {
        const matches = userMatches || button.dataset.topicTitle.includes(query);
        button.hidden = !matches;
        topicMatches ||= matches;
      }
      // Keep unloaded users visible: expand them to fetch/search their titles.
      details.hidden = Boolean(query) && !userMatches &&
        details.dataset.loaded === 'true' && !topicMatches;
    }
  }

  function syncButtons() {
    if (!panel) return;
    for (const button of panel.querySelectorAll('button')) {
      button.disabled = Boolean(isLocked());
    }
  }

  function renderUsers() {
    if (!panel) return;
    const list = $('advisorUsersList');
    list.replaceChildren();
    const version = generation;
    const includeHidden = $('advisorIncludeHidden').checked;
    const seen = new Set();
    for (const assignment of assignments) {
      if (seen.has(assignment.user_id)) continue;
      seen.add(assignment.user_id);
      const label = assignment.user_label || 'Assigned user';

      const details = element('details');
      details.dataset.userId = assignment.user_id;
      details.dataset.label = label.toLowerCase();
      
      details.style.margin = '12px 0';
      
      const summary = element('summary');
      const userName = element('span', label);
      userName.className = 'assigned-user-name';
      const topicCount = element('span', '');
      topicCount.className = 'assigned-user-count';
      summary.append(userName, topicCount);
      
      summary.style.cursor = 'pointer';
      summary.style.overflowWrap = 'anywhere';
      const topicsBox = element('div');
      topicsBox.style.paddingLeft = '12px';
      details.append(summary, topicsBox);
      list.append(details);
      let loading = false;
      details.addEventListener('toggle', async () => {
        if (!details.open || details.dataset.loaded === 'true' || loading) return;
        if (isLocked()) {
          details.open = false;
          return;
        }
        loading = true;
        topicsBox.replaceChildren(element('p', 'Loading topics…', 'small'));
        try {
          const topics = await collect(() => {
            let query = getDb().from('research_conversations')
              .select('id,user_id,title,created_at,is_visible')
              .eq('user_id', assignment.user_id);
            if (!includeHidden) query = query.neq('is_visible', 0);
            return query.order('created_at', { ascending: false }).order('id');
          }, version);
          if (!current(version) || !details.isConnected) return;
          topicsBox.replaceChildren();
          for (const topic of topics) {
            const button = element('button',
              (topic.is_visible === 0 ? '[Hidden] ' : '') +
              (topic.title || 'Untitled conversation'), 'history-item');
            button.type = 'button';
            button.dataset.topicTitle = (topic.title || '').toLowerCase();
            button.title = new Date(topic.created_at).toLocaleString();
            button.onclick = () => {
              if (!isLocked()) openTopic(assignment, topic);
            };
            topicsBox.append(button);
          }
          if (!topics.length) {
            topicsBox.append(element('p', 'No topics in this view.', 'small'));
          }
          details.dataset.loaded = 'true';
         
          topicCount.textContent = ' (' + topics.length + ')';
          filterTree();
          syncButtons();
        } catch (error) {
          if (current(version) && details.isConnected) {
            topicsBox.replaceChildren(element('p',
              'Could not load topics: ' + error.message +
              ' Close and reopen this user to retry.', 'small'));
          }
        } finally {
          loading = false;
        }
      });
    }
    $('assignedUsersHeading').textContent =
      `Assigned users (${seen.size})`;

    if (!seen.size) {
      list.append(
        element('p', 'No users assigned yet.', 'small')
      );
    }

    filterTree();
    syncButtons();
  }

  async function openTopic(assignment, topic) {
    if (isLocked()) return;

    closeReview();

    const chat = $('composer')?.closest('section.card');

    if (!chat) {
      const status = $('status');

      if (status) {
        status.textContent =
          'Could not locate the main conversation panel.';
      }

      return;
    }

    personalChatPanel = chat;
  
    const request = reviewRequest;
    const version = generation;
  
    const viewer = element('section');
    viewer.id = 'advisorReviewView';
    dialog = viewer;
  
    const toolbar = element('div');
    toolbar.className = 'row';
    toolbar.style.justifyContent = 'space-between';
    toolbar.style.alignItems = 'center';
  
    const label = element(
      'span',
      'Advisor review — read-only',
      'small'
    );
  
    const back = element(
      'button',
      'Back to my chat',
      'secondary'
    );
  
    back.type = 'button';
    back.onclick = closeReview;
  
    toolbar.append(label, back);
  
    const heading = element(
      'h2',
      topic.title || 'Untitled conversation'
    );
  
    heading.tabIndex = -1;
  
    const owner = element(
      'p',
      'Assigned user: ' +
        (assignment.user_label || 'Assigned user'),
      'small'
    );
  
    const content = element('div');
    content.setAttribute('aria-live', 'polite');
  
    content.append(
      element('p', 'Loading conversation…', 'small')
    );
  
    viewer.append(toolbar, heading, owner, content);
  
    // Add the review beside the existing chat and analysis views.
    chat.parentElement.append(viewer);
  
    chat.hidden = true;
    viewer.classList.add('card', 'advisor-review-panel');
    viewer.hidden = false;
  
    heading.focus({ preventScroll: true });
  
    viewer.scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    });
  
    const active = () =>
      current(version) &&
      request === reviewRequest &&
      viewer.isConnected;
  
    try {
      // Recheck access when opening the topic.
      const { data: allowed, error } = await getDb()
        .from('research_conversations')
        .select('id, is_visible')
        .eq('id', topic.id)
        .eq('user_id', assignment.user_id)
        .maybeSingle();
  
      if (!active()) return;
  
      if (error) {
        throw new Error(error.message);
      }
  
      if (!allowed) {
        throw new Error(
          'This topic is no longer accessible.'
        );
      }
  
      if (
        allowed.is_visible === 0 &&
        !$('advisorIncludeHidden').checked
      ) {
        throw new Error(
          'This topic is now hidden. Refresh the user list.'
        );
      }
  
      const messages = await collect(
        () => getDb()
          .from('research_turns')
          .select(
            'id, prompt, response, status, ' +
            'created_at, completed_at'
          )
          .eq('user_id', assignment.user_id)
          .eq('conversation_id', topic.id)
          .order('created_at')
          .order('id'),
        version
      );
  
      if (!active()) return;
  
      content.replaceChildren();
  
      const appendMessage = (name, text, time, role) => {
        const article = element(
          'article',
          undefined,
          'msg ' + role
        );
  
        const meta = element(
          'div',
          name + ' · ' +
            new Date(time).toLocaleString(),
          'meta'
        );
  
        const body = element('div', undefined, 'body');
        
        body.style.overflowWrap = 'anywhere';
        
        if (role === 'assistant') {
          const html = marked.parse(String(text ?? ''), {
            gfm: true,
            breaks: true,
            async: false
          });
        
          body.innerHTML = DOMPurify.sanitize(html, {
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
          body.textContent = String(text ?? '');
          body.style.whiteSpace = 'pre-wrap';
        }
  
        article.append(meta, body);
        content.append(article);
      };
  
      for (const turn of messages) {
        appendMessage(
          assignment.user_label || 'Assigned user',
          turn.prompt,
          turn.created_at,
          'user'
        );
  
        if (
          turn.response !== null &&
          turn.response !== undefined
        ) {
          appendMessage(
            'AI assistant',
            turn.response,
            turn.completed_at || turn.created_at,
            'assistant'
          );
        } else {
          content.append(
            element(
              'p',
              'Request status: ' + turn.status,
              'small'
            )
          );
        }
      }
  
      if (!messages.length) {
        content.append(
          element('p', 'No saved messages.', 'small')
        );
      }
    } catch (error) {
      if (active()) {
        content.replaceChildren(
          element(
            'p',
            'Could not load conversation: ' + error.message,
            'small'
          )
        );
      }
    }
  }

  async function refresh() {
    ensurePanel();
    const version = ++generation;
    closeReview();
    assignments = [];
    $('advisorUsersList').replaceChildren();
    $('advisorTopicsStatus').textContent = 'Checking advisor access…';
    const client = getDb();
    const userId = account;
    if (!client || !userId) return;
    try {
      const role = await client.from('research_advisors')
        .select('user_id').eq('user_id', userId).maybeSingle();
      if (!current(version)) return;
      if (role.error) throw new Error(role.error.message);
      const rows = await collect(() => client.from('research_advisor_assignments')
        .select('advisor_id,user_id,user_label')
        .eq('advisor_id', userId).order('user_id'), version);
      if (!current(version)) return;
      assignments = rows;
      panel.hidden = !role.data && rows.length === 0;
      $('advisorTopicsStatus').textContent = '';
      renderUsers();
    } catch (error) {
      if (!current(version)) return;
      panel.hidden = false;
      $('advisorTopicsStatus').textContent =
        'Advisor panel unavailable: ' + error.message;
    }
  }

  function sync() {
    ensurePanel();
    const next = getSession()?.user.id || null;
    if (next !== account) {
      account = next;
      generation++;
      clearTimeout(reloadTimer);
      closeReview();
      assignments = [];
      panel.hidden = true;
      $('advisorUsersList').replaceChildren();
      $('advisorTopicSearch').value = '';
      $('advisorIncludeHidden').checked = false;
      $('advisorTopicsStatus').textContent = '';
      // Defer database calls until after the auth callback has returned.
      if (next) reloadTimer = setTimeout(() => { refresh(); }, 0);
    }
    syncButtons();
  }

  return { sync, refresh };
}

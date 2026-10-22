export function createAdvisorTopics({ getDb, getSession, isLocked }) {
  const $ = id => document.getElementById(id);
  let account = null;
  let generation = 0;
  let reviewRequest = 0;
  let panel = null;
  let dialog = null;
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
      if (dialog.open) dialog.close();
      dialog.remove();
      dialog = null;
    }
  }

  function ensurePanel() {
    if (panel) return;
    const heading = element('h3', 'My topics');
    heading.id = 'myTopicsHeading';
    $('history').before(heading);
    panel = element('section');
    panel.id = 'advisorTopicsPanel';
    panel.hidden = true;
    panel.innerHTML = `
      <hr>
      
    <div class="assigned-users-header">
      <h3>Assigned users</h3>
    
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
      <label for="advisorTopicSearch">Search users and topic titles</label>
      <input id="advisorTopicSearch" type="search" placeholder="Search assigned users or titles">
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
    if (!seen.size) list.append(element('p', 'No users assigned yet.', 'small'));
    filterTree();
    syncButtons();
  }

  async function openTopic(assignment, topic) {
    closeReview();
    const request = reviewRequest;
    const version = generation;
    const viewer = element('dialog');
    dialog = viewer;
    Object.assign(viewer.style, {
      width: 'min(900px, calc(100vw - 24px))',
      maxHeight: '88dvh', overflowY: 'auto', padding: '24px',
      border: '1px solid var(--border)', borderRadius: '12px',
      background: 'var(--surface)', color: 'var(--text)'
    });
    const heading = element('h2', topic.title || 'Untitled conversation');
    heading.id = 'advisorReviewHeading';
    viewer.setAttribute('aria-labelledby', heading.id);
    const close = element('button', 'Close review', 'secondary');
    close.type = 'button';
    close.onclick = closeReview;
    const note = element('p',
      'Advisor review — read-only · ' + assignment.user_label, 'small');
    const content = element('div');
    content.setAttribute('aria-live', 'polite');
    content.append(element('p', 'Loading conversation…', 'small'));
    viewer.append(close, heading, note, content);
    viewer.addEventListener('cancel', event => {
      event.preventDefault();
      closeReview();
    });
    document.body.append(viewer);
    viewer.showModal();
    const active = () => current(version) && request === reviewRequest &&
      viewer.isConnected;
    try {
      // Fresh reads ensure RLS is checked when opening a cached topic.
      const { data: allowed, error } = await getDb()
        .from('research_conversations').select('id,is_visible')
        .eq('id', topic.id).eq('user_id', assignment.user_id).maybeSingle();
      if (!active()) return;
      if (error) throw new Error(error.message);
      if (!allowed) throw new Error('This topic is no longer accessible.');
      if (allowed.is_visible === 0 && !$('advisorIncludeHidden').checked) {
        throw new Error('This topic is now hidden. Refresh the user list.');
      }
      const messages = await collect(() => getDb().from('research_turns')
        .select('id,prompt,response,status,created_at,completed_at')
        .eq('user_id', assignment.user_id).eq('conversation_id', topic.id)
        .order('created_at').order('id'), version);
      if (!active()) return;
      content.replaceChildren();
      const appendMessage = (label, text, time) => {
        const article = element('article', undefined, 'msg');
        article.append(element('div', label + ' · ' +
          new Date(time).toLocaleString(), 'meta'));
        const body = element('div', text || '', 'body');
        body.style.whiteSpace = 'pre-wrap';
        body.style.overflowWrap = 'anywhere';
        article.append(body);
        content.append(article);
      };
      for (const turn of messages) {
        appendMessage(assignment.user_label || 'Assigned user',
          turn.prompt, turn.created_at);
        if (turn.response !== null && turn.response !== undefined) {
          appendMessage('AI assistant', turn.response,
            turn.completed_at || turn.created_at);
        } else {
          content.append(element('p', 'Request status: ' + turn.status, 'small'));
        }
      }
      if (!messages.length) content.append(element('p', 'No saved messages.', 'small'));
    } catch (error) {
      if (active()) content.replaceChildren(element('p',
        'Could not load conversation: ' + error.message, 'small'));
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
      $('advisorTopicsStatus').textContent = rows.length + ' assignment(s).';
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

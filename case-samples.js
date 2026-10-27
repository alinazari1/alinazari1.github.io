export function createCaseSamples({
  getDb,
  getSession,
  isLocked,
  openCase,
  onChange = () => {}
}) {
  const $ = id => document.getElementById(id);

  let panel = null;
  let list = null;
  let status = null;
  let refreshButton = null;

  let account = null;
  let request = 0;
  let timer = null;
  let managing = false;
  let publishedIds = new Set();

  function el(tag, text, parent) {
    const node = document.createElement(tag);

    if (text !== undefined) {
      node.textContent = String(text);
    }

    if (parent) parent.append(node);
    return node;
  }

  function isAdmin() {
    return getSession()?.user?.email
      ?.trim()
      .toLowerCase() === 'infoforenture@gmail.com';
  }

  function ensurePanel() {
    if (panel) return;

    panel = el('section');
    panel.id = 'caseSamplesPanel';
    panel.hidden = true;

    el('hr', undefined, panel);

    const header = el('div', undefined, panel);
    header.className = 'assigned-users-header';

    el('h3', 'Case samples', header);

    refreshButton = el('button', '↻', header);
    refreshButton.type = 'button';
    refreshButton.className = 'secondary assigned-refresh';
    refreshButton.title = 'Refresh case samples';
    refreshButton.setAttribute(
      'aria-label',
      refreshButton.title
    );
    refreshButton.onclick = refresh;

    const help = el(
      'p',
      'View a sample or create your own editable copy.',
      panel
    );
    help.className = 'small';

    status = el('p', '', panel);
    status.className = 'small';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    list = el('div', undefined, panel);

    const sharedPanel = $('sharedTopicsPanel');

    if (sharedPanel) {
      sharedPanel.after(panel);
    } else {
      $('history').after(panel);
    }
  }

  async function rpc(name, args = {}) {
    const client = getDb();
    if (!client) throw new Error('Database is unavailable.');

    const result = await client.rpc(name, args);
    if (result.error) throw new Error(result.error.message);

    return result.data;
  }

  function syncButtons() {
    if (!panel) return;

    const locked = Boolean(isLocked()) || managing;

    for (const button of panel.querySelectorAll('button')) {
      button.disabled = locked;
    }
  }

  async function refresh() {
    ensurePanel();

    const userId = account;
    const token = ++request;

    if (!userId || !getDb()) return;

    refreshButton.disabled = true;
    status.textContent = 'Loading case samples…';

    try {
      const samples = await rpc('forenture_case_samples');

      if (
        token !== request ||
        getSession()?.user?.id !== userId
      ) {
        return;
      }

      publishedIds = new Set(
        (samples || []).map(sample => sample.conversation_id)
      );

      list.replaceChildren();

      for (const sample of samples || []) {
        const button = el(
          'button',
          '◇ ' + (sample.title || 'Case sample'),
          list
        );

        button.type = 'button';
        button.className = 'history-item';
        button.title =
          'Published ' +
          new Date(sample.published_at).toLocaleString();

        button.onclick = () => {
          if (isLocked() || managing) return;

          openCase({
            ...sample,
            is_case_sample: true
          });
        };
      }

      status.textContent = samples?.length
        ? samples.length + ' sample(s) available.'
        : 'No case samples published yet.';

      onChange();
    } catch (error) {
      if (
        token === request &&
        getSession()?.user?.id === userId
      ) {
        status.textContent =
          'Could not load case samples: ' + error.message;
      }
    } finally {
      if (
        token === request &&
        getSession()?.user?.id === userId
      ) {
        syncButtons();
      }
    }
  }

  async function manage(topic) {
    if (
      !getDb() ||
      !isAdmin() ||
      isLocked() ||
      managing
    ) {
      return;
    }

    ensurePanel();

    const userId = getSession().user.id;
    managing = true;
    syncButtons();
    status.textContent = 'Checking publication status…';

    const active = () =>
      getSession()?.user?.id === userId && isAdmin();

    let saved = false;
    let publishing = false;

    try {
      // Recheck publication status instead of relying on cached data.
      const samples = await rpc('forenture_case_samples');
      if (!active()) return;

      const published = (samples || []).some(
        sample => sample.conversation_id === topic.id
      );

      publishing = !published;

      const question = publishing
        ? 'Publish "' +
          (topic.title || 'Untitled conversation') +
          '" as a case sample?\n\n' +
          'Every signed-in user will be able to read the whole ' +
          'conversation, view its saved reports, and create an ' +
          'independent copy.\n\n' +
          'Publish only fictional or appropriately cleared content. ' +
          'The original will be locked until you withdraw it.'
        : 'Withdraw "' +
          (topic.title || 'Untitled conversation') +
          '" from case samples?\n\n' +
          'This allows you to edit the original again. Existing ' +
          'personal copies and explicit topic shares remain.';

      if (!window.confirm(question)) {
        status.textContent = 'No publication changes made.';
        return;
      }

      if (!active() || isLocked()) return;

      status.textContent = publishing
        ? 'Publishing case sample…'
        : 'Withdrawing case sample…';

      await rpc('forenture_set_case_sample', {
        p_conversation_id: topic.id,
        p_published: publishing
      });

      saved = true;
      if (!active()) return;

      // Update local state immediately after confirmed success.
      if (publishing) {
        publishedIds.add(topic.id);
      } else {
        publishedIds.delete(topic.id);
      }

      onChange();
      await refresh();

      if (active()) {
        status.textContent = publishing
          ? 'Case sample published. The original is locked.'
          : 'Case sample withdrawn. You can edit the original.';
      }
    } catch (error) {
      if (active()) {
        status.textContent = saved
          ? 'Publication changed, but the interface could not ' +
            'finish refreshing. Refresh the page to check.'
          : 'Could not confirm publication change: ' +
            error.message + '. Refresh the sample list to check.';
      }
    } finally {
      if (active()) {
        managing = false;
        syncButtons();
      }
    }
  }

  function sync() {
    ensurePanel();

    const next = getSession()?.user?.id || null;

    if (next !== account) {
      account = next;
      request++;
      managing = false;
      publishedIds = new Set();

      clearTimeout(timer);
      list.replaceChildren();
      status.textContent = '';
      panel.hidden = !next;

      if (next) {
        timer = setTimeout(refresh, 0);
      }
    }

    syncButtons();
  }

  return {
    sync,
    refresh,
    manage,
    isPublished: id => publishedIds.has(id)
  };
}

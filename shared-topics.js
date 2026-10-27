import { marked } from
  'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

import DOMPurify from 'https://esm.sh/dompurify';

export function createSharedTopics({
  getDb,
  getSession,
  isLocked,
  onCopied
}) {
  const $ = id => document.getElementById(id);

  let account = null;
  let epoch = 0;
  let request = 0;
  let panel = null;
  let list = null;
  let status = null;
  let refreshButton = null;
  let viewer = null;
  let personalView = null;
  let networkView = null;
  let timer = null;
  let copying = false;

  function el(tag, text, parent) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (parent) parent.append(node);
    return node;
  }

  function disposeNetwork() {
    networkView?.destroy?.();
    networkView = null;
  }

  function close() {
    request++;
    disposeNetwork();

    if (viewer) {
      viewer.remove();
      viewer = null;

      if (personalView) personalView.hidden = false;
    }

    copying = false;
  }

  function ensurePanel() {
    if (panel) return;

    panel = el('section');
    panel.id = 'sharedTopicsPanel';
    panel.hidden = true;

    el('hr', undefined, panel);

    const bar = el('div', undefined, panel);
    bar.className = 'assigned-users-header';

    el('h3', 'Shared with me', bar);

    refreshButton = el('button', '↻', bar);
    refreshButton.type = 'button';
    refreshButton.className = 'secondary assigned-refresh';
    refreshButton.title = 'Refresh shared topics';
    refreshButton.setAttribute('aria-label', refreshButton.title);
    refreshButton.onclick = refresh;

    status = el('p', '', panel);
    status.className = 'small';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    list = el('div', undefined, panel);
    $('history').after(panel);

    // Return to the personal chat when opening a personal topic.
    $('history').addEventListener('click', event => {
      if (event.target.closest('.history-item')) close();
    }, true);

    $('new').addEventListener('click', () => {
      if (!isLocked()) close();
    }, true);
  }

  async function rpc(name, args = {}) {
    const client = getDb();
    if (!client) throw new Error('Database is unavailable.');

    const result = await client.rpc(name, args);
    if (result.error) throw new Error(result.error.message);

    return result.data;
  }

  function formatted(parent, text) {
    const body = el('div', undefined, parent);
    body.className = 'body formatted';

    body.innerHTML = DOMPurify.sanitize(
      marked.parse(String(text ?? ''), {
        gfm: true,
        breaks: true,
        async: false
      }),
      {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'del',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li', 'blockquote',
          'pre', 'code', 'hr',
          'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        ALLOWED_ATTR: ['start']
      }
    );

    return body;
  }

  function renderReports(rows, parent, isActive) {
    el('h3', 'Saved reports — read-only', parent);

    if (!rows?.length) {
      el('p', 'No saved reports are available for this topic.', parent);
      return;
    }

    const select = el('select', undefined, parent);
    Object.assign(select.style, {
      width: '100%',
      padding: '10px',
      font: 'inherit'
    });
    select.setAttribute('aria-label', 'Saved report snapshot');

    rows.forEach((row, index) => {
      const option = el(
        'option',
        new Date(row.requested_at).toLocaleString() +
          ' · revision ' + row.revision,
        select
      );
      option.value = String(index);
    });

    const bar = el('div', undefined, parent);
    bar.className = 'row';

    const output = el('div', undefined, parent);
    let active = 'quick_summary';
    let renderVersion = 0;
    const buttons = {};

    function passages(evidence, host) {
      for (const item of evidence || []) {
        el(
          'blockquote',
          (item.speaker
            ? item.speaker === 'user'
              ? 'Original author: '
              : 'Assistant: '
            : '') +
            (item.quote || ''),
          host
        );
      }
    }

    function render() {
      const version = ++renderVersion;
      disposeNetwork();
      output.replaceChildren();

      for (const [type, button] of Object.entries(buttons)) {
        button.setAttribute(
          'aria-pressed',
          String(type === active)
        );
      }

      const row = rows[Number(select.value)];
      if (!row) return;

      if (active === 'quick_summary') {
        const report = row.quick_summary || {};

        el('h4', 'What the original author mentioned', output);
        el(
          'p',
          'Based on ' + (report.prompt_count || 0) +
            ' prompts in completed exchanges.',
          output
        );

        for (const group of report.groups || []) {
          const details = el('details', undefined, output);
          el('summary', group.label, details);
          passages(group.evidence, details);
        }

        if (report.unmatched?.length) {
          const other = el('details', undefined, output);
          el('summary', 'Other passages', other);
          passages(report.unmatched, other);
        }

        return;
      }

      if (active === 'conversation_insights') {
        const snapshots =
          row.conversation_insights?.snapshots || [];

        const model = snapshots.at(-1)?.model;

        el(
          'p',
          'AI-proposed interpretations, not verified facts. ' +
            'Assistant suggestions are not author decisions.',
          output
        );

        if (!model) {
          el('p', 'No saved concept model.', output);
          return;
        }

        el('h4', 'Concepts, goals, and factors', output);

        for (const concept of model.concepts || []) {
          const details = el('details', undefined, output);
          el('summary', concept.label, details);
          el('p', 'Role: ' + concept.role, details);
          el('p', concept.definition, details);

          if (concept.state_estimate) {
            const estimate = concept.state_estimate;
            el(
              'p',
              'Original user estimate: ' +
                Math.round(estimate.probability * 100) +
                '% — ' + estimate.proposition,
              details
            );
          }

          const evidence = el('details', undefined, details);
          el('summary', 'Source passages', evidence);
          passages(concept.evidence, evidence);
        }

        el('h4', 'Possible connections', output);

        const names = new Map(
          (model.concepts || []).map(c => [c.id, c.label])
        );

        for (const relationship of model.relationships || []) {
          const details = el('details', undefined, output);

          el(
            'summary',
            (names.get(relationship.from_id) ||
              relationship.from_id) +
              ' → ' +
              (names.get(relationship.to_id) ||
                relationship.to_id),
            details
          );

          el('p', relationship.description, details);
          passages(relationship.evidence, details);
        }

        el('h4', 'How the discussion developed', output);

        for (const snapshot of snapshots) {
          const details = el('details', undefined, output);
          el('summary', 'Exchange ' + snapshot.sequence, details);

          const changes = (snapshot.model?.changes || [])
            .filter(change => change.kind !== 'unchanged');

          if (!changes.length) {
            el('p', 'No substantive changes recorded.', details);
          }

          for (const change of changes) {
            el('p', change.description, details);
          }
        }

        el('h4', 'Questions still open', output);
        const questions = el('ul', undefined, output);

        for (const question of model.open_questions || []) {
          el('li', question, questions);
        }

        return;
      }

      const placeholder = el(
        'p',
        'Loading concepts network…',
        output
      );

      import('./concepts-network.js?v=pointer-details-3')
        .then(module => {
          if (
            !isActive() ||
            version !== renderVersion ||
            !output.isConnected
          ) {
            return;
          }

          placeholder.remove();
          networkView = module.renderConceptsNetwork(row, output);
        })
        .catch(error => {
          if (
            !isActive() ||
            version !== renderVersion ||
            !output.isConnected
          ) {
            return;
          }

          disposeNetwork();
          output.replaceChildren();
          el(
            'p',
            'Could not display network: ' + error.message,
            output
          );
        });
    }

    for (const [type, label] of [
      ['quick_summary', 'Quick summary'],
      ['conversation_insights', 'Conversation insights'],
      ['concepts_network', 'Concepts network']
    ]) {
      const button = el('button', label, bar);
      button.type = 'button';
      button.className = 'secondary';
      buttons[type] = button;

      button.onclick = () => {
        active = type;
        render();
      };
    }

    select.onchange = render;
    render();
  }

  async function open(topic) {
    if (isLocked()) return;

    close();

    const token = request;
    const userId = account;

    personalView = $('composer')?.closest('section.card');
    if (!personalView) return;

    viewer = el('section');
    viewer.className = 'card';
    const view = viewer;

    personalView.after(view);
    personalView.hidden = true;

    const active = () =>
      request === token &&
      viewer === view &&
      view.isConnected &&
      getSession()?.user?.id === userId;

    const toolbar = el('div', undefined, view);
    toolbar.className = 'row';

    const back = el('button', 'Back to my chat', toolbar);
    back.type = 'button';
    back.className = 'secondary';
    back.onclick = close;

    const copy = el('button', 'Create my copy', toolbar);
    copy.type = 'button';
    copy.disabled = true;
    copy.dataset.copyCase = 'true';

    el('h2', topic.title || 'Shared conversation', view);

    const notice = el(
      'p',
      topic.is_case_sample
        ? 'Case sample — read-only. Create a personal copy to ' +
          'continue or modify this case without changing the original.'
        : 'Shared original — read-only. A personal copy is independent ' +
          'of the original and may be edited by you.',
      view
    );
    notice.className = 'small';

    const feedback = el('p', 'Loading shared case…', view);
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');

    const content = el('div', undefined, view);

    // Reuse this ID if the request outcome is uncertain.
    const newTopicId = crypto.randomUUID();

    try {
      const data = await rpc('forenture_read_shared_topic', {
        p_conversation_id: topic.conversation_id
      });

      if (!active()) return;

      feedback.textContent = '';

      const conversation = el('details', undefined, content);
      conversation.open = true;
      el('summary', 'Original conversation', conversation);

      for (const turn of data.turns || []) {
        const user = el('article', undefined, conversation);
        user.className = 'msg user';

        el(
          'div',
          'Original author · ' +
            new Date(turn.created_at).toLocaleString(),
          user
        ).className = 'meta';

        el('div', turn.prompt || '', user).className = 'body';

        if (turn.response !== null &&
            turn.response !== undefined) {
          const assistant = el(
            'article',
            undefined,
            conversation
          );
          assistant.className = 'msg assistant';

          el(
            'div',
            'AI assistant · ' +
              new Date(
                turn.completed_at || turn.created_at
              ).toLocaleString(),
            assistant
          ).className = 'meta';

          formatted(assistant, turn.response);
        } else {
          el('p', 'Request status: ' + turn.status, conversation);
        }
      }

      renderReports(data.reports || [], content, active);
      copy.disabled = Boolean(isLocked());

      copy.onclick = async () => {
        if (!active() || copying || isLocked()) return;

        if (!window.confirm(
          'Create an independent copy of this conversation ' +
          'and all its saved reports in your account?'
        )) {
          return;
        }

        copying = true;
        copy.disabled = true;
        back.disabled = true;
        feedback.textContent = 'Creating your full-case copy…';

        try {
          const result = await rpc('forenture_copy_case', {
            p_source_conversation_id: topic.conversation_id,
            p_new_conversation_id: newTopicId
          });

          if (!active()) return;

          // Keep the user informed if loading the new copy fails.
          feedback.textContent =
            'Copy created. Opening your conversation…';

          await onCopied(result.conversation_id);

          if (active()) close();
        } catch (error) {
          if (active()) {
            feedback.textContent =
              error.message +
              ' You can retry with this same button; ' +
              'the same destination ID will be used.';
          }
        } finally {
          if (active()) {
            copying = false;
            back.disabled = false;
            copy.disabled = Boolean(isLocked());
          }
        }
      };
    } catch (error) {
      if (active()) {
        feedback.textContent =
          'Could not open shared case: ' + error.message;
      }
    }
  }

  async function refresh() {
    ensurePanel();

    const version = ++epoch;
    const userId = account;

    if (!userId || !getDb()) return;

    status.textContent = 'Loading shared topics…';
    refreshButton.disabled = true;

    try {
      const topics = await rpc('forenture_shared_topics');

      if (
        version !== epoch ||
        getSession()?.user?.id !== userId
      ) {
        return;
      }

      list.replaceChildren();

      for (const topic of topics || []) {
        const button = el(
          'button',
          '↗ ' + (topic.title || 'Untitled conversation'),
          list
        );
        button.type = 'button';
        button.className = 'history-item';
        button.title =
          'Shared ' + new Date(topic.shared_at).toLocaleString();
        button.onclick = () => open(topic);
      }

      status.textContent = topics?.length
        ? topics.length + ' shared topic(s)'
        : 'No topics have been shared with you yet.';
    } catch (error) {
      if (
        version === epoch &&
        getSession()?.user?.id === userId
      ) {
        status.textContent =
          'Could not load shared topics: ' + error.message;
      }
    } finally {
      if (
        version === epoch &&
        getSession()?.user?.id === userId
      ) {
        refreshButton.disabled = Boolean(isLocked());

        for (const button of list.querySelectorAll('button')) {
          button.disabled = Boolean(isLocked());
        }
      }
    }
  }

  function sync() {
    ensurePanel();

    const next = getSession()?.user?.id || null;

    if (next !== account) {
      account = next;
      epoch++;
      close();
      clearTimeout(timer);

      list.replaceChildren();
      status.textContent = '';
      panel.hidden = !next;

      if (next) {
        timer = setTimeout(refresh, 0);
      }
    }

    refreshButton.disabled = Boolean(isLocked());

    for (const button of list.querySelectorAll('button')) {
      button.disabled = Boolean(isLocked());
    }

    const copy = viewer?.querySelector('[data-copy-case]');

    // Only enable a copy button after its handler has been installed.
    if (copy?.onclick) {
      copy.disabled = copying || Boolean(isLocked());
    }
  }

  return { sync, refresh, close, open };
}

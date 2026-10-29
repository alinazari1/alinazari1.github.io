function el(tag, value, parent) {
  const node = document.createElement(tag);

  if (value != null) {
    node.textContent = String(value);
  }

  if (parent) parent.append(node);

  return node;
}

function when(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString();
}

function author(message) {
  if (message.is_own) return 'You';

  const role =
    message.author_role === 'business_owner'
      ? 'Business user'
      : 'Advisor';

  const identifier = String(
    message.author_id || ''
  ).slice(0, 8);

  return identifier
    ? `${role} · ${identifier}`
    : role;
}

export function createGraphDiscussion({
  row,
  options,
  onCountsChanged
}) {
  const actor = options.getSession?.()?.user?.id;

  const enabled = Boolean(
    actor &&
    typeof options.getDb === 'function' &&
    typeof options.getSession === 'function'
  );

  let destroyed = false;
  let frame = null;
  let counts = new Map();
  let countsRequest = 0;
  let countsBusy = false;
  let active = null;
  let readTimer = null;

  const drafts = new Map();
  const pendingReads = new Set();

  function current() {
    return (
      !destroyed &&
      enabled &&
      options.getSession?.()?.user?.id === actor &&
      (
        typeof options.isCurrent !== 'function' ||
        options.isCurrent()
      )
    );
  }

  function base() {
    return {
      p_snapshot_id: String(row.id),
      p_revision: row.revision
    };
  }

  function targetKey(kind, id) {
    return JSON.stringify([kind, String(id)]);
  }

  function draftKey(state) {
    return JSON.stringify([
      state.turnId,
      state.kind,
      state.id
    ]);
  }

  function targetParams(state) {
    return {
      ...base(),
      p_turn_id: state.turnId,
      p_target_kind: state.kind,
      p_target_id: state.id
    };
  }

  async function rpc(name, parameters) {
    if (!current()) {
      throw new Error(
        'Review access is unavailable. Reopen the topic.'
      );
    }

    const result = await options.getDb().rpc(
      name,
      parameters
    );

    if (result.error) throw result.error;

    if (!current()) {
      throw new Error(
        'The account or topic changed.'
      );
    }

    return result.data;
  }

  function notifyCounts() {
    if (!destroyed) {
      onCountsChanged?.();
    }
  }

  function updateComposer(state) {
    if (active !== state) return;

    state.send.disabled =
      state.posting ||
      !current();

    state.input.disabled =
      state.posting ||
      !current();

    state.send.textContent = state.posting
      ? 'Posting…'
      : state.replyTo
        ? 'Send reply'
        : 'Post comment';

    state.replyLabel.textContent = state.replyTo
      ? `Replying to ${state.replyTo.label}`
      : 'New comment';

    state.cancelReply.hidden = !state.replyTo;
  }

  async function refreshCounts() {
    if (!frame || destroyed || countsBusy) return;

    if (!current()) {
      counts = new Map();
      notifyCounts();

      if (active) {
        active.status.textContent =
          'Review access is unavailable. Reopen the topic.';

        updateComposer(active);
      }

      return;
    }

    const capturedTurn = String(frame.turnId);
    const request = ++countsRequest;

    countsBusy = true;

    try {
      const data = await rpc(
        'graph_review_counts',
        {
          ...base(),
          p_turn_id: capturedTurn
        }
      );

      if (
        destroyed ||
        request !== countsRequest ||
        String(frame?.turnId) !== capturedTurn
      ) {
        return;
      }

      counts = new Map(
        (data || []).map(item => [
          targetKey(
            item.target_kind,
            item.target_id
          ),
          {
            total: Number(item.total_count) || 0,
            unread: Number(item.unread_count) || 0
          }
        ])
      );

      notifyCounts();
    } catch (error) {
      if (
        !destroyed &&
        request === countsRequest &&
        String(frame?.turnId) === capturedTurn
      ) {
        counts = new Map();
        notifyCounts();

        if (active) {
          active.status.textContent =
            'Could not refresh notifications: ' +
            error.message;
        }
      }
    } finally {
      countsBusy = false;

      if (
        !destroyed &&
        String(frame?.turnId) !== capturedTurn
      ) {
        void refreshCounts();
      }
    }
  }

  async function flushReads() {
    readTimer = null;

    if (!current() || !pendingReads.size) return;

    const ids = [...pendingReads].slice(0, 200);

    ids.forEach(id => pendingReads.delete(id));

    try {
      await rpc(
        'graph_review_mark_read',
        {
          ...base(),
          p_comment_ids: ids
        }
      );

      if (active) {
        for (const message of active.messages) {
          if (ids.includes(message.id)) {
            message.is_unread = false;
          }
        }
      }

      void refreshCounts();
    } catch (error) {
      if (active) {
        active.status.textContent =
          'Could not update read status: ' +
          error.message;
      }
    }

    if (pendingReads.size && current()) {
      readTimer = setTimeout(flushReads, 250);
    }
  }

  function queueRead(id) {
    pendingReads.add(id);

    if (!readTimer) {
      readTimer = setTimeout(flushReads, 250);
    }
  }

  function observeMessages(state) {
    state.observer?.disconnect();

    if (
      active !== state ||
      !state.open ||
      document.visibilityState !== 'visible' ||
      !current()
    ) {
      return;
    }

    if (typeof IntersectionObserver !== 'function') {
      // Leave unread flags intact when visibility cannot
      // be checked reliably.
      return;
    }

    state.observer = new IntersectionObserver(
      entries => {
        if (
          active !== state ||
          !state.open ||
          document.visibilityState !== 'visible' ||
          !current()
        ) {
          return;
        }

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          const id = entry.target.dataset.messageId;

          if (id) queueRead(id);

          state.observer.unobserve(entry.target);
        }
      },
      {
        root: state.list,
        threshold: 1
      }
    );

    for (const message of state.messages) {
      if (!message.is_unread) continue;

      const heading = state.headings.get(message.id);

      if (heading) {
        state.observer.observe(heading);
      }
    }
  }

  function appendMessage(state, message) {
    const card = el('article', null, state.list);

    card.className =
      'cn-review-message' +
      (message.is_own ? ' is-own' : '');

    const heading = el(
      'p',
      `${author(message)} · ${when(message.created_at)}`,
      card
    );

    heading.className = 'cn-review-author';
    heading.dataset.messageId = message.id;

    state.headings.set(message.id, heading);

    if (message.parent_id) {
      const parent = state.messages.find(
        item => item.id === message.parent_id
      );

      el(
        'p',
        parent
          ? `Reply to ${author(parent)}`
          : 'Reply to an earlier message',
        card
      ).className = 'cn-note';

      card.classList.add('is-reply');
    }

    el(
      'p',
      message.body,
      card
    ).className = 'cn-review-body';

    const reply = el(
      'button',
      'Reply',
      card
    );

    reply.type = 'button';

    reply.onclick = () => {
      state.replyTo = {
        id: message.id,
        label: author(message)
      };

      updateComposer(state);
      state.input.focus();
    };

    return card;
  }

  async function loadMessages(
    state,
    { seekUnread = false } = {}
  ) {
    if (
      active !== state ||
      state.loading ||
      !current()
    ) {
      return;
    }

    state.loading = true;
    state.status.textContent = 'Loading discussion…';

    try {
      let batch;

      do {
        batch = await rpc(
          'graph_review_messages',
          {
            ...targetParams(state),
            p_after_sequence: state.cursor
          }
        );

        if (active !== state) return;

        batch = batch || [];

        for (const message of batch) {
          const sequence = Number(
            message.sequence_no
          );

          if (!Number.isSafeInteger(sequence)) {
            throw new Error(
              'The message sequence is outside the supported range.'
            );
          }

          state.cursor = Math.max(
            state.cursor,
            sequence
          );

          if (
            state.messages.some(
              saved => saved.id === message.id
            )
          ) {
            continue;
          }

          state.messages.push(message);

          appendMessage(state, message);
        }

        state.more.hidden = batch.length < 200;

        // When opening a notification, continue through
        // earlier pages until the first unread message.
      } while (
        seekUnread &&
        batch.length === 200 &&
        !state.messages.some(
          message => message.is_unread
        )
      );

      state.status.textContent =
        state.messages.length
          ? ''
          : 'No comments yet. Start the discussion below.';

      if (seekUnread) {
        const firstUnread = state.messages.find(
          message => message.is_unread
        );

        const heading = firstUnread
          ? state.headings.get(firstUnread.id)
          : null;

        if (heading) {
          const listRect =
            state.list.getBoundingClientRect();

          const headingRect =
            heading.getBoundingClientRect();

          state.list.scrollTop +=
            headingRect.top - listRect.top - 8;
        }
      }

      observeMessages(state);
    } catch (error) {
      if (active === state) {
        state.status.textContent =
          'Could not load discussion: ' +
          error.message;
      }
    } finally {
      state.loading = false;
    }
  }

  function detach() {
    if (!active) return;

    drafts.set(
      draftKey(active),
      {
        body: active.input?.value || '',
        replyTo: active.replyTo
      }
    );

    active.observer?.disconnect();
    active = null;
  }

  function mount(drawer, { frame: slice, kind, item }) {
    detach();

    const originalContent = [
      ...drawer.childNodes
    ];

    const header = el('div', null);

    header.className = 'cn-review-header';

    const newComment = el(
      'button',
      'New comment',
      header
    );

    newComment.type = 'button';

    const tabs = el('div', null);
    tabs.className = 'cn-review-tabs';

    const detailsButton = el(
      'button',
      'Details & sources',
      tabs
    );

    const discussionButton = el(
      'button',
      'Discussion',
      tabs
    );

    detailsButton.type = 'button';
    discussionButton.type = 'button';

    const overview = el('div', null);

    originalContent.forEach(node => {
      overview.append(node);
    });

    const discussion = el('div', null);
    discussion.hidden = true;

    drawer.replaceChildren(
      header,
      tabs,
      overview,
      discussion
    );

    if (!enabled) {
      el(
        'p',
        'This graph has not been connected to the signed-in ' +
        'review session. Commenting is unavailable.',
        discussion
      ).className = 'cn-note';

      newComment.disabled = true;

      const switchView = showDiscussion => {
        overview.hidden = showDiscussion;
        discussion.hidden = !showDiscussion;
      };

      detailsButton.onclick = () => switchView(false);

      discussionButton.onclick = () => {
        switchView(true);
      };

      return;
    }

    const state = {
      turnId: String(slice.turnId),
      kind,
      id: String(item.id),

      messages: [],
      headings: new Map(),

      cursor: 0,
      loading: false,
      posting: false,
      open: false,
      observer: null,
      replyTo: null
    };

    state.status = el('p', '', discussion);

    state.status.className = 'cn-note';
    state.status.setAttribute('role', 'status');

    state.list = el('div', null, discussion);

    state.list.className = 'cn-review-messages';

    state.more = el(
      'button',
      'Load more messages',
      discussion
    );

    state.more.type = 'button';
    state.more.hidden = true;

    state.more.onclick = () => {
      void loadMessages(state);
    };

    const form = el('form', null, discussion);

    form.className = 'cn-review-form';

    state.replyLabel = el(
      'p',
      'New comment',
      form
    );

    state.cancelReply = el(
      'button',
      'Cancel reply',
      form
    );

    state.cancelReply.type = 'button';
    state.cancelReply.hidden = true;

    state.cancelReply.onclick = () => {
      state.replyTo = null;
      updateComposer(state);
      state.input.focus();
    };

    const label = el(
      'label',
      'Your message',
      form
    );

    state.input = el('textarea', null, label);

    state.input.rows = 4;
    state.input.maxLength = 8000;

    state.input.placeholder =
      'Ask a question, add evidence, or leave feedback…';

    state.send = el(
      'button',
      'Post comment',
      form
    );

    state.send.type = 'submit';

    const savedDraft = drafts.get(
      draftKey(state)
    );

    if (savedDraft) {
      state.input.value = savedDraft.body;
      state.replyTo = savedDraft.replyTo;
    }

    active = state;

    function switchView(showDiscussion) {
      if (active !== state) return;

      state.open = showDiscussion;

      overview.hidden = showDiscussion;
      discussion.hidden = !showDiscussion;

      detailsButton.setAttribute(
        'aria-pressed',
        String(!showDiscussion)
      );

      discussionButton.setAttribute(
        'aria-pressed',
        String(showDiscussion)
      );

      if (!showDiscussion) {
        state.observer?.disconnect();
      } else {
        observeMessages(state);
      }
    }

    state.openDiscussion = ({
      firstUnread = false,
      focus = false
    } = {}) => {
      switchView(true);

      void loadMessages(
        state,
        { seekUnread: firstUnread }
      );

      if (focus) {
        state.input.focus();
      }
    };

    detailsButton.onclick = () => {
      switchView(false);
    };

    discussionButton.onclick = () => {
      state.openDiscussion({
        firstUnread: true
      });
    };

    newComment.onclick = () => {
      state.replyTo = null;
      updateComposer(state);

      state.openDiscussion({
        focus: true
      });
    };

    form.onsubmit = async event => {
      event.preventDefault();

      if (
        active !== state ||
        state.posting ||
        !current()
      ) {
        return;
      }

      const body = state.input.value.trim();

      if (!body) {
        state.status.textContent =
          'Write a message first.';

        state.input.focus();
        return;
      }

      state.posting = true;
      updateComposer(state);

      state.status.textContent = 'Posting message…';

      try {
        await rpc(
          'graph_review_post',
          {
            ...targetParams(state),
            p_body: body,
            p_parent_id: state.replyTo?.id || null
          }
        );

        // The message may finish saving after the user
        // selects another node. Do not change that panel.
        drafts.delete(draftKey(state));

        if (active !== state) {
          void refreshCounts();
          return;
        }

        state.input.value = '';
        state.replyTo = null;

        await loadMessages(state);

        void refreshCounts();

        state.status.textContent = 'Message posted.';
      } catch (error) {
        if (active === state) {
          state.status.textContent =
            'Could not confirm posting: ' +
            error.message +
            '. Refresh the discussion before retrying ' +
            'to avoid posting the same message twice.';
        }
      } finally {
        state.posting = false;

        if (active === state) {
          updateComposer(state);
        }
      }
    };

    switchView(false);
    updateComposer(state);
  }

  function visibilityChanged() {
    if (
      document.visibilityState === 'visible' &&
      active?.open
    ) {
      observeMessages(active);
      void loadMessages(active);
    }
  }

  document.addEventListener(
    'visibilitychange',
    visibilityChanged
  );

  const poll = setInterval(() => {
    if (
      destroyed ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }

    void refreshCounts();

    if (active?.open) {
      void loadMessages(active);
    }
  }, 15000);

  return {
    setFrame(slice) {
      const changed =
        String(frame?.turnId) !==
        String(slice?.turnId);

      frame = slice;

      if (changed) {
        counts = new Map();
        countsRequest++;
        notifyCounts();
        void refreshCounts();
      }
    },

    getCount(kind, id) {
      return counts.get(
        targetKey(kind, id)
      ) || {
        total: 0,
        unread: 0
      };
    },

    mount,

    openDiscussion(settings) {
      active?.openDiscussion?.(settings);
    },

    detach,

    destroy() {
      detach();
      destroyed = true;

      clearInterval(poll);
      clearTimeout(readTimer);

      pendingReads.clear();
      drafts.clear();

      document.removeEventListener(
        'visibilitychange',
        visibilityChanged
      );
    }
  };
}

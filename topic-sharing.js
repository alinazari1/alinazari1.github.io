export function createTopicSharing({
  getDb,
  getSession,
  isLocked
}) {
  let dialog = null;
  let version = 0;
  let ownerId = null;
  let working = false;

  function element(tag, text, parent) {
    const node = document.createElement(tag);

    if (text !== undefined) {
      node.textContent = String(text);
    }

    if (parent) parent.append(node);
    return node;
  }

  function close() {
    version++;

    if (dialog) {
      if (dialog.open) dialog.close();
      dialog.remove();
    }

    dialog = null;
    ownerId = null;
    working = false;
  }

  function sync() {
    if (!dialog) return;

    if (getSession()?.user?.id !== ownerId) {
      close();
      return;
    }

    const locked = working || Boolean(isLocked());

    for (const control of dialog.querySelectorAll(
      'input, select, button[data-share-action]'
    )) {
      control.disabled = locked;
    }

    const closeButton = dialog.querySelector(
      '[data-share-close]'
    );

    if (closeButton) closeButton.disabled = working;
  }

  async function open(topic) {
    if (
      !getDb() ||
      !getSession()?.user?.id ||
      isLocked()
    ) {
      return;
    }

    close();

    ownerId = getSession().user.id;
    const token = version;
    const client = getDb();
    const topicId = topic.id;

    const view = document.createElement('dialog');
    dialog = view;

    Object.assign(view.style, {
      width: 'min(640px, calc(100vw - 24px))',
      maxHeight: '85dvh',
      overflowY: 'auto',
      padding: '24px',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      background: 'var(--surface)',
      color: 'var(--text)'
    });

    const heading = element('h2', 'Share topic', view);
    heading.id = 'topicShareHeading';
    view.setAttribute('aria-labelledby', heading.id);

    element(
      'p',
      topic.title || 'Untitled conversation',
      view
    );

    const explanation = element(
      'p',
      'Recipients can view the whole conversation and saved ' +
      'reports, including future additions, and create an ' +
      'independent personal copy. They cannot edit the original.',
      view
    );
    explanation.className = 'small';

    const assignedLabel = element(
      'label',
      'Choose an assigned user',
      view
    );

    const assigned = element('select', undefined, view);
    assigned.id = 'topicShareAssigned';
    assignedLabel.htmlFor = assigned.id;

    Object.assign(assigned.style, {
      width: '100%',
      padding: '10px',
      font: 'inherit'
    });

    const form = element('form', undefined, view);

    const emailLabel = element(
      'label',
      'Or enter a registered email address',
      form
    );

    const email = element('input', undefined, form);
    email.id = 'topicShareEmail';
    email.type = 'email';
    email.required = true;
    email.autocomplete = 'off';
    email.placeholder = 'Registered user’s email';
    emailLabel.htmlFor = email.id;

    const actions = element('div', undefined, form);
    actions.className = 'row';

    const shareButton = element(
      'button',
      'Share topic',
      actions
    );
    shareButton.type = 'submit';
    shareButton.dataset.shareAction = 'share';

    const status = element('p', '', view);
    status.className = 'small';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    element('h3', 'Current recipients', view);
    const recipients = element('div', undefined, view);

    const note = element(
      'p',
      'Removing a share blocks future access through that share. ' +
      'It does not delete personal copies or remove separate ' +
      'advisor-assignment access.',
      view
    );
    note.className = 'small';

    const footer = element('div', undefined, view);
    footer.className = 'row';

    const closeButton = element('button', 'Close', footer);
    closeButton.type = 'button';
    closeButton.className = 'secondary';
    closeButton.dataset.shareClose = 'true';

    const active = () =>
      token === version &&
      dialog === view &&
      view.isConnected &&
      getSession()?.user?.id === ownerId;

    function requestClose() {
      if (!working) close();
    }

    closeButton.onclick = requestClose;

    view.addEventListener('cancel', event => {
      event.preventDefault();
      requestClose();
    });

    assigned.onchange = () => {
      if (assigned.value) {
        email.value = assigned.value;
      }
    };

    async function invoke(name, args = {}) {
      if (!active()) throw new Error('Session changed.');

      const result = await client.rpc(name, args);

      if (!active()) throw new Error('Session changed.');
      if (result.error) throw new Error(result.error.message);

      return result.data;
    }

    async function loadRecipients() {
      const rows = await invoke(
        'forenture_topic_recipients',
        { p_conversation_id: topicId }
      );

      if (!active()) return;

      recipients.replaceChildren();

      if (!rows?.length) {
        const empty = element(
          'p',
          'This topic has no explicit shares.',
          recipients
        );
        empty.className = 'small';
        return;
      }

      for (const recipient of rows) {
        const row = element('div', undefined, recipients);

        Object.assign(row.style, {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '12px 0',
          borderBottom: '1px solid var(--border)'
        });

        const description = element('div', undefined, row);

        element(
          'div',
          recipient.email || 'Registered user',
          description
        );

        const date = element(
          'div',
          'Shared: ' +
            new Date(recipient.shared_at).toLocaleString(),
          description
        );
        date.className = 'small';

        const remove = element('button', 'Remove access', row);
        remove.type = 'button';
        remove.className = 'secondary';
        remove.dataset.shareAction = 'remove';

        remove.onclick = async () => {
          if (!active() || working || isLocked()) return;

          const confirmed = window.confirm(
            'Remove explicit sharing access for ' +
            (recipient.email || 'this user') +
            '?\n\nPersonal copies and separate advisor ' +
            'access will not be removed.'
          );

          if (!confirmed || !active()) return;

          working = true;
          sync();
          status.textContent = 'Removing access…';

          let removed = false;

          try {
            await invoke('forenture_unshare_topic', {
              p_conversation_id: topicId,
              p_recipient_id: recipient.recipient_id
            });

            removed = true;
            await loadRecipients();

            if (active()) {
              status.textContent = 'Explicit share removed.';
            }
          } catch (error) {
            if (active()) {
              status.textContent = removed
                ? 'Access was removed, but the recipient list ' +
                  'could not refresh. Close and reopen this dialog.'
                : 'Could not confirm removal: ' + error.message +
                  '. Close and reopen to check the current list.';
            }
          } finally {
            if (active()) {
              working = false;
              sync();
            }
          }
        };
      }
    }

    form.onsubmit = async event => {
      event.preventDefault();

      if (!active() || working || isLocked()) return;
      if (!form.reportValidity()) return;

      const targetEmail = email.value.trim();
      if (!targetEmail) return;

      const confirmed = window.confirm(
        'Share "' +
        (topic.title || 'Untitled conversation') +
        '" with ' + targetEmail + '?\n\n' +
        'This includes the whole conversation, saved reports, ' +
        'and future additions. The recipient may create ' +
        'an independent personal copy.'
      );

      if (!confirmed || !active()) return;

      working = true;
      sync();
      status.textContent = 'Sharing topic…';

      let shared = false;

      try {
        await invoke('forenture_share_topic', {
          p_conversation_id: topicId,
          p_email: targetEmail
        });

        shared = true;
        await loadRecipients();

        if (active()) {
          email.value = '';
          assigned.value = '';
          status.textContent = 'Topic shared.';
        }
      } catch (error) {
        if (active()) {
          status.textContent = shared
            ? 'Topic was shared, but the recipient list could ' +
              'not refresh. Close and reopen this dialog.'
            : 'Could not confirm sharing: ' + error.message +
              '. Close and reopen to check the current list.';
        }
      } finally {
        if (active()) {
          working = false;
          sync();
        }
      }
    };

    document.body.append(view);
    view.showModal();

    working = true;
    sync();
    status.textContent = 'Loading sharing settings…';

    let assignmentWarning = '';

    try {
      assigned.replaceChildren();
      const placeholder = element(
        'option',
        'Select a user, or enter an email below',
        assigned
      );
      placeholder.value = '';

      try {
        const users = await invoke(
          'forenture_share_assigned_users'
        );

        if (!active()) return;

        for (const user of users || []) {
          const option = element(
            'option',
            user.email,
            assigned
          );
          option.value = user.email;
        }

        if (!users?.length) {
          placeholder.textContent =
            'No assigned users — enter an email below';
        }
      } catch (error) {
        if (!active()) return;

        placeholder.textContent =
          'Assigned list unavailable — enter an email below';

        assignmentWarning =
          'Assigned-user list unavailable: ' + error.message;
      }

      await loadRecipients();

      if (active()) {
        status.textContent = assignmentWarning;
      }
    } catch (error) {
      if (active()) {
        status.textContent =
          'Could not load sharing settings: ' + error.message;
      }
    } finally {
      if (active()) {
        working = false;
        sync();
      }
    }
  }

  return { open, sync, close };
}

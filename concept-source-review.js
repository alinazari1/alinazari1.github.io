function element(tag, text, parent) {
  const node = document.createElement(tag);

  if (text !== undefined && text !== null) {
    node.textContent = String(text);
  }

  if (parent) {
    parent.append(node);
  }

  return node;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const ROLE_NAMES = {
  concept: 'General concept',
  driver: 'Driver',
  goal: 'Goal',
  constraint: 'Constraint',
  direction: 'Option',
  outcome: 'Outcome'
};

function displayWeight(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  )
    ? value.toFixed(2)
    : 'Not recorded';
}

export function renderSourceReview(row, host) {
  host.replaceChildren();
  host.hidden = !row;

  if (!row) return;

  const snapshots = asArray(
    row.conversation_insights?.snapshots
  );

  const latest = snapshots.at(-1);
  const model = latest?.model;

  if (!model) {
    element(
      'p',
      'Source review is unavailable for this report.',
      host
    );

    return;
  }

  const concepts = asArray(model.concepts);
  const relationships = asArray(model.relationships);

  const sourceTurns = asArray(
    row.source_state?.turns
  );

  const turnsById = new Map(
    sourceTurns.map((turn, index) => [
      String(turn.id),
      {
        ...turn,
        exchangeNumber: index + 1
      }
    ])
  );

  const conceptNames = new Map(
    concepts.map(concept => [
      concept.id,
      concept.label || concept.id
    ])
  );

  const targets = [
    ...concepts.map(concept => ({
      kind: 'concept',
      item: concept,
      label:
        'Concept: ' +
        (concept.label || concept.id)
    })),

    ...relationships.map(relationship => ({
      kind: 'connection',
      item: relationship,
      label:
        'Connection: ' +
        (
          conceptNames.get(relationship.from_id) ||
          relationship.from_id
        ) +
        (
          relationship.directed === true
            ? ' → '
            : ' — '
        ) +
        (
          conceptNames.get(relationship.to_id) ||
          relationship.to_id
        )
    }))
  ];

  const wrapper = element(
    'details',
    null,
    host
  );

  wrapper.className = 'source-review';

  element(
    'summary',
    'Review concepts, connections, and sources',
    wrapper
  );

  element(
    'p',
    'Inspect the interpretations in the selected report ' +
    'snapshot. A matching quotation confirms attribution, ' +
    'not that the interpretation or business claim is true.',
    wrapper
  ).className = 'source-review-note';

  if (!targets.length) {
    element(
      'p',
      'No concepts or connections were saved in this report.',
      wrapper
    );

    return;
  }

  element(
    'p',
    'Report revision: ' +
    (row.revision ?? 'Not recorded') +
    ' · Through exchange: ' +
    (latest.sequence ?? snapshots.length),
    wrapper
  ).className = 'source-review-note';

  const label = element(
    'label',
    'Choose a concept or connection',
    wrapper
  );

  const selector = element(
    'select',
    null,
    label
  );

  selector.className = 'source-review-select';

  targets.forEach((target, index) => {
    const option = element(
      'option',
      target.label,
      selector
    );

    option.value = String(index);
  });

  const content = element(
    'div',
    null,
    wrapper
  );

  content.className = 'source-review-content';

  function showTarget() {
    content.replaceChildren();

    const target = targets[Number(selector.value)];

    if (!target) return;

    const item = target.item;

    element(
      'h4',
      target.label,
      content
    );

    element(
      'p',
      target.kind === 'concept'
        ? item.definition || 'No definition saved.'
        : item.description || 'No description saved.',
      content
    );

    const properties = element(
      'dl',
      null,
      content
    );

    function property(name, value) {
      element('dt', name, properties);
      element('dd', value, properties);
    }

    if (target.kind === 'concept') {
      property(
        'Role',
        ROLE_NAMES[item.role] || 'Unclassified'
      );

      property(
        'Discussion prominence',
        displayWeight(item.weight)
      );
    } else {
      property(
        'Relationship type',
        item.type || 'Not recorded'
      );

      property(
        'Direction',
        item.directed === true
          ? 'Directed; not proof of causation'
          : 'Undirected'
      );

      property(
        'Expressed connection strength',
        displayWeight(item.weight)
      );
    }

    property(
      'Recorded review status',
      item.review_status || 'Not recorded'
    );

    if (item.weight_reason) {
      property(
        'Weight explanation',
        item.weight_reason
      );
    }

    element(
      'p',
      'Discussion prominence and connection strength ' +
      'are not probabilities that a business claim is true.',
      content
    ).className = 'source-review-note';

    element(
      'h4',
      'Supporting source passages',
      content
    );

    const evidence = asArray(item.evidence);

    if (!evidence.length) {
      element(
        'p',
        'No source passages were saved for this item.',
        content
      );

      return;
    }

    for (const reference of evidence) {
      const card = element(
        'article',
        null,
        content
      );

      card.className = 'source-review-evidence';

      const turn = turnsById.get(
        String(reference.turn_id)
      );

      const speaker =
        reference.speaker === 'user'
          ? 'Business user'
          : reference.speaker === 'assistant'
            ? 'AI assistant'
            : 'Unknown speaker';

      element(
        'p',
        speaker +
        ' · ' +
        (
          turn
            ? `Exchange ${turn.exchangeNumber}`
            : 'Exchange unavailable'
        ),
        card
      ).className = 'source-review-attribution';

      const quote =
        typeof reference.quote === 'string'
          ? reference.quote
          : '';

      element(
        'blockquote',
        quote || 'Quotation unavailable.',
        card
      );

      const message =
        reference.speaker === 'user'
          ? turn?.prompt
          : reference.speaker === 'assistant'
            ? turn?.response
            : null;

      const matches =
        Boolean(quote.trim()) &&
        typeof message === 'string' &&
        message.includes(quote);

      const check = element(
        'p',
        matches
          ? 'Quotation matches the captured source.'
          : 'Source match could not be verified in this snapshot.',
        card
      );

      check.className = matches
        ? 'source-review-match'
        : 'source-review-warning';

      if (typeof message === 'string') {
        const context = element(
          'details',
          null,
          card
        );

        element(
          'summary',
          'Read the full source message',
          context
        );

        element(
          'p',
          message,
          context
        ).className = 'source-review-message';
      }
    }
  }

  selector.onchange = showTarget;
  showTarget();
}

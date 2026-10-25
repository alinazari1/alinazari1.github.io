import {
  mountAnalysisUI as mountConversationConceptsUI
} from './conversation-concepts-ui.js?v=inline-1';

import { showInlineAnalysisPanel } from
  './inline-analysis-panels.js?v=inline-1';


export function mountAnalysisUI({
  getDb,
  getSession,
  isLocked
}) {
  const conceptUI = mountConversationConceptsUI({
    getDb,
    getSession,
    isLocked
  });
  let dialog = null;
  let running = false;
  let generation = 0;
  let model = null;
  let editor = null;
  let status = null;
  let downloadButton = null;
  let activeUserId = null;
  let analyzeAgainButton = null;

  /*
   * These rules suggest categories only.
   * Matching a keyword is not evidence of causation,
   * importance, or completeness.
   */
  const rules = [
    {
      id: 'goals',
      label: 'Goals and desired outcomes',
      pattern:
        /\b(goal|objective|aim|want|hope|achieve|success|target|intend)\b/i
    },
    {
      id: 'financial',
      label: 'Financial factors',
      pattern:
        /\b(budget|cost|costs|price|pricing|revenue|profit|funding|cash|money|financial|afford|investment)\b|[$€£]|\bCAD\b|\bUSD\b/i
    },
    {
      id: 'timing',
      label: 'Timing and deadlines',
      pattern:
        /\b(deadline|timeline|launch|delay|urgent|soon|month|months|week|weeks|year|years|time)\b/i
    },
    {
      id: 'customers',
      label: 'Customers and demand',
      pattern:
        /\b(customer|customers|client|clients|market|demand|buyer|buyers|sales|willingness|purchase|adoption)\b/i
    },
    {
      id: 'resources',
      label: 'Resources and capabilities',
      pattern:
        /\b(team|staff|skills|capacity|resource|resources|equipment|technology|supplier|suppliers|expertise|available)\b/i
    },
    {
      id: 'constraints',
      label: 'Constraints and requirements',
      pattern:
        /\b(must|cannot|can't|required|requirement|limit|limited|constraint|restriction|only|compliance|regulation|legal)\b/i
    },
    {
      id: 'risks',
      label: 'Risks and uncertainty',
      pattern:
        /\b(risk|uncertain|uncertainty|unknown|failure|fail|concern|worry|threat|might|may|could)\b/i
    },
    {
      id: 'options',
      label: 'Options and tradeoffs',
      pattern:
        /\b(option|alternative|choose|choice|versus|instead|either|whether|tradeoff|trade-off)\b/i
    },
    {
      id: 'evidence',
      label: 'Evidence and assumptions',
      pattern:
        /\b(evidence|data|interview|interviews|survey|research|tested|test|pilot|assume|assumption|believe|estimate)\b/i
    },
    {
      id: 'stakeholders',
      label: 'Stakeholders and dependencies',
      pattern:
        /\b(partner|partners|investor|investors|advisor|advisors|stakeholder|stakeholders|approval|depends|dependency)\b/i
    }
  ];

  function element(tag, text, parent) {
    const node = document.createElement(tag);

    if (text !== undefined) {
      node.textContent = text;
    }

    if (parent) parent.append(node);
    return node;
  }

  function currentUser() {
    return getSession()?.user?.id || null;
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function validRequest(token, userId) {
    return (
      token === generation &&
      currentUser() === userId &&
      dialog?.isConnected
    );
  }

  function close() {
    generation += 1;
    running = false;
    activeUserId = null;
    model = null;
    editor = null;
    status = null;
    downloadButton = null;
    analyzeAgainButton = null;

    if (dialog) {
      if (dialog.open) dialog.close();
      dialog.remove();
      dialog = null;
    }
  }

  function sync() {
    conceptUI.sync();
    if (dialog && currentUser() !== activeUserId) {
      close();
      return;
    }

    if (analyzeAgainButton) {
      analyzeAgainButton.disabled =
        running || !currentUser() || isLocked();
    }

    if (downloadButton) {
      downloadButton.disabled = running || !model;
    }
  }

  function splitPrompt(text) {
    return String(text || '')
      .split(/\n+|(?<=[.!?])\s+/u)
      .map(value => value.trim())
      .filter(Boolean);
  }

  function createModel(topic, turns) {
    const sources = turns
      .filter(turn => String(turn.prompt || '').trim())
      .map(turn => ({
        turn_id: turn.id,
        created_at: turn.created_at,
        prompt: String(turn.prompt)
      }));

    const passages = [];

    for (const source of sources) {
      splitPrompt(source.prompt).forEach((quote, index) => {
        passages.push({
          source_ref: `${source.turn_id}:p${index + 1}`,
          turn_id: source.turn_id,
          quote
        });
      });
    }

    const matched = new Set();

    const candidates = rules.map(rule => {
      const evidence = passages.filter(passage => {
        const match = rule.pattern.test(passage.quote);

        if (match) matched.add(passage.source_ref);
        return match;
      });

      return {
        category: rule.id,
        label: rule.label,
        review_status: 'unreviewed',
        interpretation: '',
        evidence
      };
    }).filter(candidate => candidate.evidence.length);

    return {
      schema_version: 'conversation-driver-review-v1',
      method: 'local_keyword_assisted_review',
      generated_at: new Date().toISOString(),
      conversation_id: topic.id,
      title: topic.title || 'Untitled conversation',
      scope: 'User prompts only; assistant replies excluded.',
      limitations: [
        'Candidate categories are keyword matches, not validated drivers.',
        'Relevant passages may be missed or categorized incorrectly.',
        'No importance ranking or causal relationship is inferred.',
        'Review original prompts before confirming interpretations.'
      ],
      decision_question: '',
      candidate_drivers: candidates,
      unmatched_passages: passages.filter(
        passage => !matched.has(passage.source_ref)
      ),
      additional_drivers: [],
      relationships: [],
      review_questions: [
        'What decision or question is this conversation addressing?',
        'Which candidate drivers are actually relevant?',
        'Which drivers are missing or incorrectly categorized?',
        'Which statements are assumptions rather than observations?',
        'What evidence supports any proposed relationship?'
      ],
      sources
    };
  }

  function readEditedModel() {
    const value = JSON.parse(editor.value);

    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.conversation_id !== model.conversation_id ||
      !Array.isArray(value.candidate_drivers) ||
      !Array.isArray(value.sources)
    ) {
      throw new Error(
        'Keep conversation_id unchanged and retain ' +
        'candidate_drivers and sources as arrays.'
      );
    }

    return value;
  }

  function downloadModel() {
    try {
      const edited = readEditedModel();

      const blob = new Blob(
        [JSON.stringify(edited, null, 2)],
        { type: 'application/json' }
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download =
        `topic-model-${model.conversation_id}.json`;

      document.body.append(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setStatus(
        'JSON downloaded. No model was saved to the database.'
      );
    } catch (error) {
      setStatus('Cannot download: ' + error.message);
    }
  }

  async function loadTurns(db, userId, conversationId) {
    const result = [];

    for (let start = 0; ; start += 500) {
      const { data, error } = await db
        .from('research_turns')
        .select('id, conversation_id, user_id, created_at, prompt')
        .eq('user_id', userId)
        .eq('conversation_id', conversationId)
        .order('created_at')
        .order('id')
        .range(start, start + 499);

      if (error) throw new Error(error.message);

      if (currentUser() !== userId) {
        throw new Error('The signed-in account changed.');
      }

      result.push(...data);

      if (data.length < 500) return result;
    }
  }

  function renderModel(container) {
    container.replaceChildren();

    element('h3', 'Candidate drivers', container);

    element(
      'p',
      'These are suggested categories from user prompts. ' +
      'Counts are not measures of importance.',
      container
    );

    if (!model.candidate_drivers.length) {
      element(
        'p',
        'No categories matched. Review the original prompts ' +
        'and add drivers manually in the JSON editor.',
        container
      );
    }

    for (const driver of model.candidate_drivers) {
      const details = element('details', undefined, container);

      element(
        'summary',
        `${driver.label} — ${driver.evidence.length} passage(s)`,
        details
      );

      for (const evidence of driver.evidence) {
        element('blockquote', evidence.quote, details);

        const reference = element(
          'p',
          `Source: ${evidence.source_ref}`,
          details
        );

        reference.style.fontSize = '0.85em';
      }
    }

    const unmatched = element('details', undefined, container);

    element(
      'summary',
      `Uncategorized passages (${model.unmatched_passages.length})`,
      unmatched
    );

    for (const passage of model.unmatched_passages) {
      element('blockquote', passage.quote, unmatched);
      element('p', `Source: ${passage.source_ref}`, unmatched);
    }

    const originals = element('details', undefined, container);

    element(
      'summary',
      `All original user prompts (${model.sources.length})`,
      originals
    );

    for (const source of model.sources) {
      element('h4', `Turn ${source.turn_id}`, originals);

      const prompt = element('p', source.prompt, originals);
      prompt.style.whiteSpace = 'pre-wrap';
    }

    element('h3', 'Review and edit the model', container);

    element(
      'p',
      'Add the decision question, correct candidate drivers, ' +
      'and add missing drivers. Relationships are intentionally ' +
      'empty: do not treat keyword matches as causal evidence. ' +
      'Edits remain here only until you download or close.',
      container
    );

    editor = element('textarea', undefined, container);
    editor.setAttribute('aria-label', 'Editable topic model JSON');
    editor.spellcheck = false;
    editor.value = JSON.stringify(model, null, 2);

    Object.assign(editor.style, {
      boxSizing: 'border-box',
      width: '100%',
      minHeight: '360px',
      fontFamily: 'monospace',
      fontSize: '13px',
      padding: '12px'
    });
  }

  async function analyze(conversationId) {
    const db = getDb();
    const userId = currentUser();

    if (!db || !userId || isLocked() || running) return;

    if (dialog) {
      const confirmed = window.confirm(
        'Replace this open analysis? ' +
        'Any edits not downloaded will be lost.'
      );

      if (!confirmed) return;
    }

    close();
    activeUserId = userId;

    dialog = element('dialog');
    dialog.setAttribute('aria-labelledby', 'topicAnalysisHeading');

    Object.assign(dialog.style, {
      boxSizing: 'border-box',
      width: 'min(960px, calc(100vw - 24px))',
      maxHeight: '90dvh',
      overflowY: 'auto',
      padding: '24px',
      border: '1px solid #bbb',
      borderRadius: '12px'
    });

    const heading = element('h2', 'Topic analysis', dialog);
    heading.id = 'topicAnalysisHeading';

    element(
      'p',
      'Local prompt analysis. No new topic is created and ' +
      'no external AI request is made.',
      dialog
    );

    status = element('p', '', dialog);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const content = element('section', undefined, dialog);
    const actions = element('div', undefined, dialog);

    Object.assign(actions.style, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '10px',
      marginTop: '20px'
    });

    analyzeAgainButton = element(
      'button',
      'Rebuild from current prompts',
      actions
    );
    analyzeAgainButton.type = 'button';
    analyzeAgainButton.onclick = () => analyze(conversationId);

    downloadButton = element('button', 'Download model JSON', actions);
    downloadButton.type = 'button';
    downloadButton.onclick = downloadModel;


    const conceptButton = element(
      'button',
      'Concept model',
      actions
    );
    
    conceptButton.type = 'button';
    
    conceptButton.onclick = async () => {
      try {
        await conceptUI.analyze(conversationId);
      } catch (error) {
        console.error('Concept analysis failed:', error);
    
        window.alert(
          'Concept analysis failed: ' +
          (error?.message || String(error))
        );
      }
    };
    
    const closeButton = element('button', 'Close', actions);
    closeButton.type = 'button';

    function requestClose() {
      if (
        editor &&
        model &&
        editor.value !== JSON.stringify(model, null, 2) &&
        !window.confirm('Close and discard your edited model?')
      ) {
        return;
      }

      close();
    }

    closeButton.onclick = requestClose;

    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      requestClose();
    });

    showInlineAnalysisPanel(dialog);

    const token = ++generation;
    running = true;
    sync();
    setStatus('Loading this conversation’s saved prompts…');

    try {
      const { data: topic, error } = await db
        .from('research_conversations')
        .select('id, title, user_id, is_visible')
        .eq('id', conversationId)
        .eq('user_id', userId)
        .single();

      if (error) throw new Error(error.message);

      if (topic.is_visible === 0) {
        throw new Error('This topic has been removed from history.');
      }

      const turns = await loadTurns(db, userId, conversationId);

      if (!validRequest(token, userId)) return;

      model = createModel(topic, turns);

      heading.textContent = `Analyze: ${model.title}`;
      renderModel(content);

      setStatus(
        `Reviewed ${model.sources.length} saved user prompt(s). ` +
        `Found ${model.candidate_drivers.length} candidate categories. ` +
        'Review required; nothing was saved to the database.'
      );
    } catch (error) {
      if (validRequest(token, userId)) {
        setStatus('Analysis failed: ' + error.message);
      }
    } finally {
      if (validRequest(token, userId)) {
        running = false;
        sync();
      }
    }
  }

  return { sync, analyze, close };
}

function getAnalysisHost() {
  let host = document.getElementById('inlineAnalysisPanels');

  if (host) return host;

  const composer = document.getElementById('composer');

  if (!composer) {
    throw new Error(
      'Cannot display inline analysis: composer was not found.'
    );
  }

  host = document.createElement('section');
  host.id = 'inlineAnalysisPanels';

  host.setAttribute(
    'aria-label',
    'Conversation analysis panels'
  );

  Object.assign(host.style, {
    width: '100%',
    minWidth: '0',
    flexShrink: '0',
    boxSizing: 'border-box'
  });

  // Insert as a sibling, not inside the message form.
  composer.before(host);

  return host;
}

export function showInlineAnalysisPanel(panel) {
  const host = getAnalysisHost();

  panel.classList.add('inline-analysis-panel');

  // Override the popup positioning used by the existing code.
  Object.assign(panel.style, {
    position: 'static',
    inset: 'auto',
    transform: 'none',
    width: '100%',
    maxWidth: '100%',
    minWidth: '0',
    height: 'auto',
    maxHeight: 'none',
    margin: '16px 0',
    padding: '20px',
    overflow: 'visible',
    boxSizing: 'border-box',
    border: '1px solid #cbd5d1',
    borderRadius: '12px',
    background: 'var(--surface, #ffffff)',
    color: 'var(--text, #182521)'
  });

  host.append(panel);

  // Nonmodal dialog in normal page flow.
  // Existing close() calls can remain unchanged.
  panel.show();

  panel.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';
import DOMPurify from 'https://esm.sh/dompurify';
import { renderMyTopicsVisuals } from './analysis-visuals.js?v=1';

export function mountAnalysisUI({ getDb, getSession, isLocked }) {
  const $ = id => document.getElementById(id);
  let button = null;
  let account = null;
  let analysisView = null;
  let chatView = null;
  let activeScope = null;
  let activeUser = null;
  let running = false;
  let epoch = 0;

  const blocked = () => !getSession() || isLocked() || running;

  function backToChat() {
    const review = $('advisorReviewView');
  
    if (review) review.hidden = true;
    if (analysisView) analysisView.hidden = true;
    if (chatView) chatView.hidden = false;
  }

  function ensureViews() {
    if (analysisView) return;
    const main = $('workspace').querySelector(':scope > section.card');
    if (!main) throw new Error('Cannot find the main chat section.');
    chatView = document.createElement('div');
    chatView.id = 'personalChatView';
    while (main.firstChild) chatView.append(main.firstChild);
    main.append(chatView);
    analysisView = document.createElement('section');
    analysisView.id = 'mainAnalysisView';
    analysisView.hidden = true;
    main.append(analysisView);

    $('history').addEventListener('click', event => {
      const target = event.target.closest('button.history-item');
      if (target && !target.disabled) backToChat();
    }, true);
    $('new').addEventListener('click', () => {
      if (!$('new').disabled) backToChat();
    }, true);
  }

  function addAssignedButtons() {
    const entries = document.querySelectorAll(
      '#advisorUsersList > details'
    );
  
    for (const details of entries) {
      const userId = details.dataset.userId;
      const summary = details.querySelector(':scope > summary');
  
      if (!userId || !summary) continue;
  
      let action = details.querySelector('.advisorAnalyzeUser');
  
      if (!action) {
        action = document.createElement('button');
        action.type = 'button';
        action.className = 'secondary advisorAnalyzeUser';
  
        action.innerHTML = `
          <span aria-hidden="true">✧</span>
          <span>Analyze</span>
        `;
  
        action.title = 'Analyze this user’s topics';
      }
  
      // Keep the action visible even when the user is collapsed.
      if (action.parentElement !== summary) {
        summary.append(action);
      }
  
      const userLabel =
        summary.querySelector('.assigned-user-name')
          ?.textContent ||
        details.dataset.label ||
        'Assigned user';
  
      action.setAttribute(
        'aria-label',
        'Analyze topics for ' + userLabel
      );
  
      action.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
  
        if (blocked()) {
          const status = document.getElementById('status');
  
          if (status) {
            status.textContent =
              'Finish the current request or voice input before opening analysis.';
          }
  
          return;
        }
  
        open('assigned_user', userId, userLabel);
      };
  
      // Keep button keyboard events separate from the disclosure.
      action.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.stopPropagation();
        }
      };
  
      const disabled = Boolean(blocked());
  
      if (action.disabled !== disabled) {
        action.disabled = disabled;
      }
    }
  }

  function resetForAccount() {
    epoch++;
    activeScope = null;
    activeUser = null;
    analysisView.replaceChildren();
    backToChat();
  }

  function sync() {
    ensureViews();
    if (!button) {
      button = document.createElement('button');
      button.id = 'analyzeMyTopics';
      button.type = 'button';
      button.className = 'secondary compact-analyze';
    
      button.innerHTML = `
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"/>
        </svg>
        <span>Analyze</span>
      `;
    
      button.title = 'Analyze all your topics';
      button.setAttribute('aria-label', 'Analyze all your topics');
    
      const heading = $('myTopicsHeading');
    
      if (heading) {
        let header = $('myTopicsHeader');
    
        if (!header) {
          header = document.createElement('div');
          header.id = 'myTopicsHeader';
          heading.before(header);
          header.append(heading);
        }
    
        header.append(button);
      } else {
        // Fallback if the topics heading is not available.
        $('history').before(button);
      }
    
      button.onclick = () => {
        if (!blocked()) open('mine');
      };
    }
    const next = getSession()?.user.id || null;
    if (next !== account) {
      account = next;
      resetForAccount();
    }
    button.hidden = !next;
    button.disabled = Boolean(blocked());
    addAssignedButtons();
  }

  function open(scope, userId = null, userLabel = '') {
    if (blocked()) return;
    ensureViews();
    const sameSelection = activeScope === scope && activeUser === userId &&
      analysisView.childElementCount > 0;
    if (!sameSelection) {
      epoch++;
      activeScope = scope;
      activeUser = userId;
      buildForm(scope, userId, userLabel);
    }

    const review = $('advisorReviewView');
    if (review) review.hidden = true;
    chatView.hidden = true;
    analysisView.hidden = false;
    
    analysisView.querySelector('h2')?.focus({ preventScroll: true });
    analysisView.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function buildForm(scope, userId, userLabel) {
    analysisView.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 id="analysisHeading" tabindex="-1" style="margin:0">Conversation analysis</h2>
        <button id="analysisBack" type="button" class="secondary">Back to chat</button>
      </div>
      <p id="analysisScopeLabel" class="small"></p>
      <form id="analysisForm">
        <label for="analysisType">Report</label>
        <select id="analysisType" style="width:100%;padding:12px;font:inherit;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)">
          <option value="overview">Overview</option>
          <option value="themes">Themes and connections</option>
          <option value="actions">Decisions, actions, and gaps</option>
          <option value="full">Full report</option>
        </select>
        <p class="small">Dates filter completed messages, not topic creation dates. Dates use UTC; the end date is included.</p>
        <div class="row">
          <div style="flex:1;min-width:150px"><label for="analysisFrom">From</label><input id="analysisFrom" type="date"></div>
          <div style="flex:1;min-width:150px"><label for="analysisTo">To</label><input id="analysisTo" type="date"></div>
        </div>
        <label class="check"><input id="analysisHidden" type="checkbox"><span>Include hidden conversations</span></label>
        <label class="check"><input id="analysisConsent" type="checkbox" required><span>I understand that the selected saved conversation text will be sent to the configured AI provider for analysis.</span></label>
        <div class="row"><button id="analysisGenerate" type="submit">Generate report</button></div>
      </form>
      <p id="analysisStatus" role="status" aria-live="polite" class="small"></p>
      <div id="analysisReport" class="formatted" style="overflow-wrap:anywhere"></div>
      <div id="analysisEvidence"></div>
    `;
    $('analysisScopeLabel').textContent = scope === 'mine'
      ? 'Scope: your own topics only'
      : 'Scope: assigned user ' + userLabel;
    $('analysisBack').onclick = backToChat;
    const form = $('analysisForm');
    form.onsubmit = async event => {
      event.preventDefault();
      if (blocked()) return;
      const owner = getSession()?.user.id;
      const version = epoch;
      const status = $('analysisStatus');
      const report = $('analysisReport');
      const evidence = $('analysisEvidence');
      const submit = $('analysisGenerate');
      const payload = {
        scope,
        user_id: userId,
        report_type: $('analysisType').value,
        from: $('analysisFrom').value || null,
        to: $('analysisTo').value || null,
        include_hidden: $('analysisHidden').checked,
        analysis_acknowledged: $('analysisConsent').checked,
      };
      if (payload.from && payload.to && payload.from > payload.to) {
        status.textContent = 'Start date must be before or equal to the end date.';
        return;
      }
      const current = () => epoch === version && getSession()?.user.id === owner &&
        status.isConnected;
      running = true;
      submit.disabled = true;
      for (const control of form.querySelectorAll('input, select')) control.disabled = true;
      sync();
      report.replaceChildren();
      let visuals = $('analysisVisuals');

      if (!visuals) {
        visuals = document.createElement('div');
        visuals.id = 'analysisVisuals';
      
        // Charts appear above the written report.
        report.before(visuals);
      }
      
      // Remove visuals from the previous report.
      visuals.replaceChildren();
      
      evidence.replaceChildren();
      status.textContent = 'Generating report… You can return to chat while this runs.';
      try {
        const { data, error } = await getDb().functions.invoke('research-analysis', { body: payload });
        if (error) {
          let message = error.message;
          try { message = (await error.context.json()).error || message; } catch {}
          throw new Error(message);
        }
        if (!data || data.error || typeof data.report !== 'string') {
          throw new Error(data?.error || 'Invalid report response.');
        }
        if (!current()) return;
        // Add charts for personal-topic analysis.
        if (scope === 'mine') {
          renderMyTopicsVisuals(
            visuals,
            data.evidence,
            {
              from: payload.from,
              to: payload.to
            }
          );
        }

        
        status.textContent = `${data.stats.topic_count} topic(s), ${data.stats.completed_turn_count} completed turn(s). AI interpretations: review against the evidence. Report not saved to the database.`;
        report.innerHTML = DOMPurify.sanitize(marked.parse(data.report, {
          gfm: true, breaks: true, async: false,
        }), {
          ALLOWED_TAGS: ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6',
            'ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','th','td'],
          ALLOWED_ATTR: ['start'],
        });
        const refs = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Evidence references';
        refs.append(summary);
        for (const item of data.evidence || []) {
          const p = document.createElement('p');
          p.className = 'small';
          p.style.overflowWrap = 'anywhere';
          p.textContent = `[${item.ref}] ${item.topic_title} · ${new Date(item.created_at).toLocaleString()} · conversation ${item.topic_id} · message ${item.turn_id}`;
          refs.append(p);
        }
        evidence.append(refs);
      } catch (error) {
        if (current()) status.textContent = 'Analysis failed: ' + error.message;
      } finally {
        running = false;
        if (current()) {
          submit.disabled = false;
          for (const control of form.querySelectorAll('input, select')) control.disabled = false;
        }
        sync();
      }
    };
  }

  const observer = new MutationObserver(addAssignedButtons);
  observer.observe($('workspace'), { childList: true, subtree: true });
  return { sync };
}

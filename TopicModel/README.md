# Forenture topic-model first release — complete source package

## Scope and status
This is a separate first-release module, NOT a patch to your current chat.js.
It reuses your Supabase Auth project and the existing
public.research_participants(user_id uuid, enabled boolean) eligibility flag.
An enabled account is required. It does not alter existing participant data,
signup triggers, chats, login, website navigation, or advisor-role tables.
Generated source code has not been deployed or run against your project.
Review and test on staging before production. No claim of production readiness.

Included:
- Owner-created topics and append-only user-reported source notes.
- Gemini structured extraction, server-side schema checks and source-ID checks.
- Immutable model snapshots; human JSON revisions produce new snapshots.
- Version-specific owner confirmation and comments.
- Explicit, topic-specific advisor assignments; advisors can read/build/comment,
  not edit the owner's version or impersonate confirmation.
- Side-by-side display of 2–4 accessible topics with the same context label.
- Request IDs, duplicate-request handling and atomic version finalization.

Not included:
- Importing your existing AI Assistant conversations or automatic conversational
  replies. This page collects user notes, not an AI chat transcript.
- Full guided-question orchestration or incremental model updates. Every AI build
  analyzes all allowed source notes from scratch, not prior human revisions.
- Automatic context matching, criterion/unit alignment, scoring, probabilities,
  synthesis generation, shared synthesized outputs or consent workflows.
- A general administrator UI, contact Inbox, email worker or retention/deletion UI.
- Automatic retry scheduling, model-call billing reversal or guaranteed completion.
- Mapping your existing advisor-role/assignment tables to these assignments.

## Files
01-schema.sql — one-time migration, new dm_* tables and RPCs.
02-assign-advisor-example.sql — commented trusted-admin assignment examples.
03-audit-and-recovery.sql — job inspection and optional stale-job cleanup.
TopicModel/index.html, style.css, config.js, app.js — browser application.
supabase/functions/topic-model/index.ts — Edge Function.
supabase/functions/topic-model/.env.example — server configuration template.
supabase/config.toml — configuration block to MERGE into an existing config.

## 1. Database setup
Back up the project. Run 01-schema.sql ONCE in a development Supabase SQL Editor.
The SQL assumes public.research_participants with user_id and enabled exists.
It creates dm_* objects and will fail if those names already exist: inspect,
not blindly drop/recreate or rerun. The transaction protects against partial DDL.
It does not change existing participant rows or existing AI Assistant tables.
No browser grants to jobs or assignment writes. No browser UPDATE/DELETE on
source notes or model versions. New versions and reviews use protected paths.

## 2. Configure and deploy the Edge Function
Use the Supabase Dashboard function editor, or the Supabase CLI.
With the CLI, merge these sources into your local Supabase project directory.
Do NOT replace an existing supabase/config.toml wholesale.

  supabase link --project-ref YOUR_PROJECT_REF
  supabase secrets set --env-file supabase/functions/topic-model/.env.local
  supabase functions deploy topic-model

Create .env.local locally from .env.example, replacing values. Never commit it.
Set GEMINI_API_KEY, GEMINI_MODEL, and exact ALLOWED_ORIGINS. Select a Gemini model
available to your project that supports generateContent structured output.
The code intentionally does not guess your current model/version.
The standard SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY server
variables must be available (normally provided by hosted Supabase Functions).

Merge the [functions.topic-model] block with verify_jwt=false. The function
explicitly checks each Bearer token with getUser(); this is NOT an unauthenticated
endpoint. CORS is only an additional browser restriction, not authorization.
Use an ordinary user-scoped client for topic/message reads and a separate
privileged client only for jobs and version finalization. Never put server keys
in frontend files. Review function secrets and logs access.

## 3. Deploy the browser files
Create a root-level TopicModel folder on your website. Upload its four files.
Edit TopicModel/config.js: same project URL and browser-safe publishable/anon key
as your current AI Assistant. Never use a secret/service-role key in that file.
Keep your existing homepage and root config.js unchanged.

Add a link, for example in ai-chat.html:
  <a href="TopicModel/index.html">Topic-model workspace</a>

Serve over HTTPS (or an allowed localhost origin), not file://.
The browser module imports supabase-js from esm.sh. Your CSP must allow the module
and the necessary Supabase network connections, or bundle it locally instead.
It expects the existing login at Signin/account.html. Sign in there, then return
to TopicModel/index.html. Default Supabase session storage is shared only when
project, origin, and storage configuration match. Align any custom storageKey.

## 4. Test with an owner
Create a test topic, add a few source notes, and build an AI draft.
Inspect every source ID and the interpretation; valid UUID references alone do
not establish entailment or factual truth. Make a JSON revision, save a new
version, then confirm that version. Confirmations do not assert verified facts.
Build again only when you intend a new AI interpretation of the source notes;
it does not automatically preserve the edited human version.

## 5. Test with an advisor
Create/use a second real Auth account with enabled=true in research_participants.
A trusted admin adds a topic-specific assignment using 02-assign-advisor-example.sql.
The advisor can read that topic's notes/versions and comment or build drafts.
They cannot insert owner notes, revise the owner's JSON model, confirm as owner,
write assignments, or see unassigned topics. Test direct API requests too.
There is no automatic data access granted to admins by this module.

## 6. Comparison
Select 2–4 accessible topics with the same context_key. The latest version of
each is shown, not necessarily the latest confirmed version. No model is merged
or ranked. Manually check units, horizons, assumptions, and review state.
Assignment is the explicit access grant in this isolated pilot; implement the
study's purpose/consent rules before enabling broader cross-user processing.

## 7. Requests and limitations
A request ID is kept in sessionStorage. Unknown network outcomes: use Check /
retry SAME request. The backend returns its status instead of starting another
model call. Clearing it locally does not cancel an existing job. Closing the
browser/tab may lose the local pending reference; jobs remain in the database.
Same request ID cannot be reused with a different input. Deliberately using a
fresh ID can create another version and another provider charge.
Build uses one fixed source snapshot (saved message IDs). New notes require a
new build. Source notes are immutable to browser users, not to privileged admins.
Draft results never overwrite older versions. Two concurrent requests may each
save a new version. Revisions can branch from an older parent deliberately.

Limits: 120 notes, 90,000 serialized source characters, 10,000 chars per note,
60,000 serialized model chars, 30 items per model category, 15 next questions.
The function rejects oversized topics, rather than silently truncating input.
Gemini timeout: 60 seconds. Browser wait timeout: 80 seconds. An interrupted Edge
runtime may leave a job processing; inspect and recover using file 03.
Hourly usage check is best-effort (not atomic), not a hard spend cap or complete
rate limiter. Add robust per-user/org limits, monitoring and cost controls before
wide release. Gemini sends your source notes to the configured AI provider;
update participant disclosure, retention terms and relevant consent before use.
No automatic file attachment parsing or external evidence verification.

## 8. Security and acceptance checklist
- Wrong user cannot read/build/review an unassigned topic.
- Disabled participant cannot read topics or start processing.
- Advisor cannot change ownership, edit the owner's model, or confirm as owner.
- Browser cannot insert versions/jobs or self-assign an advisor.
- Invalid source references or malformed model JSON are rejected.
- Pending and failed model calls leave source notes and old versions intact.
- Repeating a request ID returns the existing result/status.
- Concurrent completion cannot produce duplicate version numbers for one topic.
- Context labels are not treated as proof of comparability.
- Sensitive text is rendered with textContent, not innerHTML.
- Secret keys are absent from all browser files and the published repository.

## 9. Connect the existing AI Assistant later
Before changing table names in the function, inspect existing topic/message
columns, ownership keys, participant eligibility, roles, and assignments.
Create a server-side read adapter that returns authorized source snapshots in a
consistent shape, including role/origin and timestamps. The current extraction
schema handles user-reported notes only: adding actual assistant/advisor messages
requires expanding origin validation so suggestions cannot masquerade as user
statements. Keep current chat and retry behavior intact.
No old chat import is included because those schemas were not provided.

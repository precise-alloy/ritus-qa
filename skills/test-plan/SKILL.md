---
name: test-plan
description: Use when the user asks to analyze a Jira/ADO ticket, understand a requirement, or create a test plan (e.g. "analyze ticket PROJ-123", "create a test plan", "plan the testing"). Fetches the ticket and produces a structured English test plan in .qa/<ticket-id>/<ticket-id>-plan.md.
---

# Test Plan

Produce a structured test plan for one ticket.

## TODO

On invocation, create this todo list verbatim (session `todos` table) and mark items off as you complete them:

```
- [ ] Fetch ticket via the plugin-root scripts/fetch-ticket.ts (run from project root)
- [ ] Save raw JSON to .qa/<ticket-id>/ticket.json
- [ ] If a previous ticket.json existed: snapshot it, diff it, write the Change Log
- [ ] Read dependency links; fetch linked tickets that matter (recursively, bounded)
- [ ] Optional: read Figma design if a link is available
- [ ] Write .qa/<ticket-id>/<ticket-id>-plan.md from <plugin-root>/templates/test-plan.md
- [ ] Summarize scope + risks to the user
```

## Input

A ticket reference: Jira key (`PROJ-123`), Jira URL, ADO work item id, or ADO URL. If the user did not provide one, ask for it.

## Procedure

0. Name and retain two roots. `<project-root>` is the project under test — the current directory for every command, and where `.qa/` lives. `<plugin-root>` is the installed ritus-qa directory that contains this skill, `package.json`, and `scripts/`. The scripts do **not** live in the project, so always invoke them by their plugin-root path while the current directory stays `<project-root>`. Invoke with `bun`, never `node`.

1. Fetch the ticket:

   ```powershell
   # current directory: <project-root>
   bun "<plugin-root>\scripts\fetch-ticket.ts" <ticket>
   ```

   On non-zero exit, relay the error to the user verbatim and stop. Common causes: missing/expired PAT in `.qa/.env.local`, wrong base URL, no network/VPN.

   The output already carries link metadata — Jira `issuelinks` (with `type.inward`/`type.outward` + `inwardIssue`/`outwardIssue`), `parent`, `subtasks`; ADO `relations` (`rel` + `url`). You do NOT need a separate call to discover them.

2. Save the raw JSON to `.qa/<ticket-id>/ticket.json` (create the directory first). Never write PATs or env values into any file under `.qa/<ticket-id>/`.

3. **If `.qa/<ticket-id>/ticket.json` already existed before this fetch, this is a later round.** Do not overwrite it blindly:
   Use `.qa/<ticket-id>/execution-results.md` to find the round number: take the highest value in the `Round` column as the round that just finished, so the snapshot belongs to that round and the one now starting is +1. If `execution-results.md` does not exist, no round has run yet, so `ticket.json` is round 1 and the current round is round 2.

   - Move the previous file to `.qa/<ticket-id>/rounds/ticket-r<N-1>.json`, where `N-1` is the round it belonged to, then write the freshly fetched ticket to `ticket.json`.
   - Compare only the fields that carry QA meaning: `summary`/`title`, `description`, `acceptanceCriteria`, `status`, `attachments`, and newly linked tickets. Ignore churn — `updated` timestamps, comment counts, field reordering. A diff that reports noise teaches the QA to skim past it.
   - Sort what changed into the three kinds, because they imply different re-test scope:

     | Kind | Signal | What it implies |
     |---|---|---|
     | Bug fix | status moved, acceptance criteria unchanged | existing cases still valid; verify the failures and the area around the fix |
     | Criterion amended | an existing AC's text changed | cases bound to that AC may now assert the wrong thing |
     | Criterion added | a new AC appeared | existing cases still valid; new cases needed |

   - If the previous `ticket.json` is missing — the QA cleared `.qa/`, or is on another machine — say you cannot compare and ask what changed. Never fall through to treating everything as new: that pushes every case into "re-run" with nothing behind it.

4. **Dependency tickets (nested, multi-level).** A ticket can depend on others across several levels — including many `relates to` links pointing at old, closed tickets (regression context) alongside `blocked`/`dependency` links. Read the link metadata from step 1 and decide by **purpose**, not by link type alone:

   - **Gating dependencies** (`blocks` / `is blocked by`, ADO `System.LinkTypes.Dependency`, parent/epic): always fetch in full — their state decides whether the current ticket's cases can run at all.
   - **Regression context** (`relates to` / `duplicates` pointing at old/closed tickets): fetch the linked ticket but read only its summary, status, and resolution — enough to know what previously broke here, without pulling its full history.
   - **Loose links** that add no scope or context: skip.
   - For each linked ticket worth reading, call `bun "<plugin-root>\scripts\fetch-ticket.ts" <linked-key>` yourself and save to `.qa/<ticket-id>/deps/<linked-key>.json` (create the `deps/` subdir).

   **Depth is your call, not a fixed number.** Recurse into a linked ticket's own links when they affect scope or testability; stop when further levels add no QA value. Two safety rails, always:
   - Track visited keys and never refetch one — this prevents infinite loops on cyclic links.
   - When you go beyond ~2 levels or read more than a handful of deps, tell the user how many tickets you've pulled and why, so the walk never silently burns tokens.
   - Record in the plan's Risks any dependency that is not done/available on the target environment (its state affects whether cases for the current ticket can run).

5. If the ticket JSON or the user mentions a Figma link, note it for step 6. Figma is optional: if no link is available, skip design input without asking more than once.

6. Optionally read the Figma design via the Figma MCP tools to extract component states and variants (default, hover, empty, error, loading) that belong in scope.

7. Write `.qa/<ticket-id>/<ticket-id>-plan.md` from `<plugin-root>/templates/test-plan.md`, filling every `{{PLACEHOLDER}}` in English:
   - Requirement Summary: what the ticket asks, in QA terms (fold in relevant context from dependency tickets fetched in step 4).
   - Acceptance Criteria: from the ticket (ADO `acceptanceCriteria` field; Jira description section if present). If absent, state "None provided" and list implied criteria under Risks.
   - Scope: In Scope / Out of Scope — be explicit about what will NOT be tested.
   - Risks: ambiguous requirements, CMS content dependencies (visitor groups, scheduled publish), environment risks, **and any dependency ticket not yet done/available on the target environment**.
   - Test Approach: which of these apply — functional cases, CMS content verification (`cms-content-check`), UI/responsive verification (`ui-ux-check`), auto-execution (`auto-execute`).
   - Environments: CMS edit-mode URL, frontend URL (from `TEST_BASE_URL` in `.qa/.env.local` or ask the user), browsers, Figma link or "None".

   On a later round, update the existing plan in place rather than rewriting it from scratch: amend the sections the ticket changed, leave the rest, and append a dated entry to `## Change Log`:

   ```markdown
   ### Round 2 — 2026-08-25
   - AC-3 changed: "shows 5 results" → "shows 10 results"
   - AC-6 added: filter by category
   - Status: In Progress → Ready for QA
   ```

   The Change Log is what a QA reads to see what happened; `ticket.json` is for the diff, and nobody should have to read it.

8. Show the user a short summary (scope bullets + risk count + how many dependency tickets were read) and the path to `<ticket-id>-plan.md`. Suggest the next step: `test-case-design`.

9. If the user explicitly asks for a client-shareable copy of the finished plan, mention the optional follow-up `artifact-export` skill for `.qa/<ticket-id>/<ticket-id>-plan.md` → `.qa/<ticket-id>/exports/<ticket-id>-plan.docx` and/or `.qa/<ticket-id>/exports/<ticket-id>-plan.pdf`. Do not offer export automatically.

## Rules

- Artifact language: English. Conversation with the QA: match their language.
- Do not invent requirements. If something is unclear, list it under Risks instead of guessing.
- Keep the plan proportional: a small copy-change ticket gets a short plan.
- Never recurse dependency fetches unbounded — track visited keys (cycle protection); depth is your judgment call, and tell the user when you go deep.

## Handoff

- **Produces:** `.qa/<ticket-id>/<ticket-id>-plan.md` (+ `ticket.json`, + `deps/<linked-key>.json` for each dependency read, + `rounds/ticket-r<N-1>.json` and a `## Change Log` entry on a later round).
- **Next:** `invoke test-case-design` — ask the user before proceeding. Optional user-requested follow-up: `invoke artifact-export` for `<ticket-id>-plan.docx` and/or `<ticket-id>-plan.pdf`.

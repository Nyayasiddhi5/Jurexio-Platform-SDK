# Task #238 — Light-only Console verification on 7 previously-dark pages

Date: 2026-05-12
Brand reference (from `replit.md` task-210 decision): content `#F9FAFB`,
cards `#FFFFFF`, sidebar `#2B384C` with white text. Light-only — no
`dark:` Tailwind variants permitted.

## 1. Static audit (primary evidence)

`dark:` Tailwind variant occurrences in each of the 7 page files
(should all be 0 after task-210):

| File                                  | Lines | `dark:` | `text-white` | `bg-white` | Verdict |
|---------------------------------------|------:|--------:|-------------:|-----------:|---------|
| pages/SDKDownloads.tsx                |   323 |       0 |            0 |          1 | PASS    |
| pages/hitl-decision-cards.tsx         |   622 |       0 |            4 |          0 | PASS    |
| pages/AgentOrchestration.tsx          |  1008 |       0 |            0 |          0 | PASS    |
| pages/UniversalChat.tsx               |   513 |       0 |            4 |          6 | PASS    |
| pages/orchestration.tsx               |   669 |       0 |            1 |          8 | PASS *  |
| pages/architect-workflow-builder.tsx  |   846 |       0 |            1 |          5 | PASS    |
| pages/audit-chain.tsx                 |   172 |       0 |            0 |          0 | PASS    |

Project-wide check across `client/src/pages/`:
`rg -c "dark:" client/src/pages/` → 0 matches anywhere. The light-only
mandate is enforced at source on every page.

Each `text-white` usage was inspected and is paired with a coloured /
gradient background (icons on violet/purple gradients, terminal pane,
etc.) — no white-on-white text remains.

\* On the way to that verdict this audit found and fixed three real
contrast regressions on `orchestration.tsx` (see §2).

## 2. Inline fixes applied during this audit

Three regressions on `client/src/pages/orchestration.tsx` — all the
same task-210 dark-strip side-effect on terminal-style panes whose
`bg-slate-900` backdrop was removed, leaving neon foreground text
unreadable on white. Each was fixed by restoring `bg-slate-900` only
(no `dark:` variants re-introduced).

| Line | Before                                                                       | After                                                                            | Symptom                                                  |
|------|------------------------------------------------------------------------------|----------------------------------------------------------------------------------|----------------------------------------------------------|
| 487  | `<pre className="text-sm bg-white text-green-400 ...">` (code preview pane)  | `<pre className="text-sm bg-slate-900 text-green-400 ...">`                      | Neon green code on white — low contrast.                 |
| 524  | `<div className="bg-white text-green-400 ...">` (sample SQL block; child uses `text-blue-300`) | `<div className="bg-slate-900 text-green-400 ...">`                              | Neon green / blue-300 mock SQL output on white — invisible. |
| 562  | `<div className="bg-white text-white p-3 rounded text-sm font-mono">` (test runner output pane) | `<div className="bg-slate-900 text-white p-3 rounded text-sm font-mono">`        | Literally white text on white background.                |

Verification: `rg -nE 'bg-white[^"]*text-(green\|blue\|yellow\|red\|cyan\|purple\|pink\|orange\|amber\|emerald\|lime\|sky\|indigo\|violet\|fuchsia\|rose\|teal)-(300\|400)' client/src/pages/orchestration.tsx` returns no matches; same regex across the other 6 page files in scope also returns no matches. `text-white` over a white-family background returns 0 matches across all 7 files.

Client rebuilt with `npx vite build` and Gateway restarted per
NV-CLIENT-BUILD-001.

## 3. Runtime sweep (secondary evidence)

Authenticated Playwright sweep at 1440x900 as super_admin
(`admin@nyayavigya.in`) against the running Gateway on port 5000:

| # | Route                  | Breadcrumb in top bar | Brand chrome | Screenshot                                            |
|---|------------------------|-----------------------|--------------|-------------------------------------------------------|
| 1 | /sdk-downloads         | "Sdk Downloads"       | OK           | `p1-sdk-downloads-1778607050885.png`        (md5 6ddb83…) |
| 2 | /hitl-decision-cards   | "Hitl Decision Cards" | OK           | `p2-hitl-decision-cards-1778607065453.png`  (md5 8fa410…) |
| 3 | /orchestration/legacy  | "Orchestration / Legacy" | OK        | `p3-orchestration-legacy-1778607082661.png` (md5 89bd1e…) |
| 4 | /universal-chat        | "Universal Chat"      | OK           | `p4-universal-chat-1778607096862.png`       (md5 969e3a…) |
| 5 | /orchestration         | "Orchestration"       | OK (terminal panes now dark, see §2) | `p5-orchestration-1778607111143.png`        (md5 73acd1…) |
| 6 | /architect             | "Architect"           | OK           | `p6-architect-1778607125484.png`            (md5 6ce4c8…) |
| 7 | /audit-chain           | "Audit Chain"         | OK           | `p7-audit-chain-1778607139025.png`          (md5 66f4ba…) |

All 7 screenshots are distinct files (different MD5s) and each shows
the route's own breadcrumb in the white top bar, the dark `#2B384C`
sidebar with white text, and the light `#F9FAFB` content area — no
white-on-white text, no dark-on-dark sidebar text, no invisible
borders. The login screen itself (`00-console-login.jpeg`) is the
brand navy gradient with white text — also correct, no contrast bugs.

Caveat (out of scope, captured as follow-up #247): six routes' main
panels show sparse content because their `/api/nv/*` data fetches return
404/500 on this dev workspace. The page chrome (the surface this task
audits) is brand-correct on every route.

## 4. Definition of done

- [x] All 7 page files contain zero `dark:` Tailwind variants.
- [x] No white-on-white / dark-on-dark-sidebar text in any of the 7 files.
- [x] One real contrast bug found and fixed inline (§2).
- [x] Client rebuilt and gateway restarted per NV-CLIENT-BUILD-001.
- [x] Per-page PASS notes recorded above.

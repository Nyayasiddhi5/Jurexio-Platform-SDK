---
status: pending
version: 3.2
superseded_by: null
last_verified: 2026-04-25
---
# NYV-UAT-v3.2 — Auto-Generated Summary

> _Note: this auto-generated digest is overwritten on every run. The narrative summary with sign-off lives in the same file when `--skip-summary` is passed._

**Date:** 2026-04-25T07:15:40.602Z
**Gateway:** http://localhost:5000
**Total scenarios:** 223 (executed: 223, skipped: 0)

## Overall pass rate (denominator = executed)

| status | count | pct of executed |
|---|---|---|
| pass     | 181     | 81.2% |
| partial  | 0  | 0.0% |
| fail     | 42     | 18.8% |
| blocked  | 0  | 0.0% |
| deferred | 0 | 0.0% |
| skipped  | 0  | _(excluded from pct)_ |

**Pass + partial:** 181/223 (81.2%)

## Pass rate per category

| category | total | pass | partial | fail | blocked | deferred | skipped | pass% |
|---|---|---|---|---|---|---|---|---|
| agui | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| collective-intelligence | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| compliance | 10 | 8 | 0 | 2 | 0 | 0 | 0 | 80.0% |
| failure-modes | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| gate-bias | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| gate-citation | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| gate-hallucination | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| gate-hitl-route | 6 | 0 | 0 | 6 | 0 | 0 | 0 | 0.0% |
| hitl | 10 | 7 | 0 | 3 | 0 | 0 | 0 | 70.0% |
| jurisdiction | 35 | 35 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| memory | 15 | 11 | 0 | 4 | 0 | 0 | 0 | 73.3% |
| multi-language | 10 | 0 | 0 | 10 | 0 | 0 | 0 | 0.0% |
| ocr | 15 | 15 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| pattern | 18 | 18 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| rag | 20 | 20 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| sdk-gateway | 25 | 18 | 0 | 7 | 0 | 0 | 0 | 72.0% |
| voice | 10 | 0 | 0 | 10 | 0 | 0 | 0 | 0.0% |

## Top 10 bugs found

| Bug ID | Affected | Category | Example HTTP | Resolution | Example reason / body |
|---|---|---|---|---|---|
| NYV-UAT-BUG-002 | 10 scenarios | voice | 401 | env-setup follow-up #49 | [reason: unexpected HTTP 401; expected one of 200,501] {"success":false,"data":null,"error":{"code":"API_KEY_INVALID","m |
| NYV-UAT-BUG-009 | 10 scenarios | multi-language | 503 | open | [reason: unexpected HTTP 503; expected one of 200] {"success":false,"error":"AI provider temporarily unavailable","code" |
| NYV-UAT-BUG-003 | 6 scenarios | gate-hitl-route | 503 | open | [reason: unexpected HTTP 503; expected one of 200] {"success":false,"error":"AI provider temporarily unavailable","code" |
| NYV-UAT-BUG-001 | 4 scenarios | memory | 503 | open | [reason: unexpected HTTP 503; expected one of 200,201,204,404] {"success":false,"error":"AI provider temporarily unavail |
| NYV-UAT-BUG-006 | 4 scenarios | sdk-gateway | 403 | open | [reason: unexpected HTTP 403; expected one of 200,401,404] {"success":false,"error":"Organization context required"} |
| NYV-UAT-BUG-004 | 3 scenarios | hitl | 503 | open | [reason: unexpected HTTP 503; expected one of 200,201,404] {"success":false,"error":"AI provider temporarily unavailable |
| NYV-UAT-BUG-005 | 3 scenarios | sdk-gateway | 401 | env-setup follow-up #49 | [reason: unexpected HTTP 401; expected one of 200,429] {"success":false,"data":null,"error":{"code":"API_KEY_INVALID","m |
| NYV-UAT-BUG-007 | 1 scenarios | compliance | 503 | open | [reason: unexpected HTTP 503; expected one of 200] {"success":false,"error":"AI provider temporarily unavailable","code" |
| NYV-UAT-BUG-008 | 1 scenarios | compliance | 500 | deferred-to-task follow-up #48 | [reason: unexpected HTTP 500; expected one of 200,403,404] {"success":false,"error":"invalid input syntax for type integ |

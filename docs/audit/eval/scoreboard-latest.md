# Nyayavigya — Legal Accuracy & Hallucination Scoreboard

- **Generated:** 2026-06-03T06:17:37.638Z
- **Mode:** live
- **Release gate:** ❌ FAIL
- **Thresholds:** accuracy ≥ 95% · citation-faithfulness ≥ 0.95 · hallucination ≤ 0% · adversarial-detection ≥ 90%

> LIVE: scored against live gateway model output.

| Jurisdiction | Adapter | Live API | Items | Accuracy | Citation faithfulness | Hallucination rate | Unverified surfaced | Adversarial detection | Gate |
|---|---|:--:|--:|--:|--:|--:|--:|--:|:--:|
| EU | EUR-Lex | on | 4 | 43.611% | 1 | 0% | 0 | 100% | ❌ |
| IN | India Code | on | 4 | 37.056% | 1 | 0% | 0 | 100% | ❌ |
| SG | Singapore Statutes Online | on | 4 | 76.556% | 1 | 0% | 0 | 100% | ❌ |
| UK | legislation.gov.uk | on | 4 | 32.889% | 1 | 0% | 0 | 100% | ❌ |

- **EU gate failures:** accuracy 43.611% < 95%
- **IN gate failures:** accuracy 37.056% < 95%
- **SG gate failures:** accuracy 76.556% < 95%
- **UK gate failures:** accuracy 32.889% < 95%

_Authority sources per jurisdiction:_
- **EU** — EUR-Lex (eur-lex.europa.eu), CJEU case-law (CURIA)
- **IN** — India Code (indiacode.nic.in), Constitution of India
- **SG** — Singapore Statutes Online (sso.agc.gov.sg), SG Supreme Court neutral citations
- **UK** — legislation.gov.uk, The National Archives (case neutral citations)

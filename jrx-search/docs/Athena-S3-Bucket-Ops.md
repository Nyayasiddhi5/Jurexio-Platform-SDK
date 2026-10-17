# Athena / S3 judgment PDF buckets (ops note)

**Owned PDF estates (presign + extract allowlist)** — see `artifacts/api-server/src/lib/archiveDocs.ts` → `DOCUMENT_BUCKET_REGIONS`.

| Bucket | Region | Role |
|--------|--------|------|
| `your-supreme-court-data-bucket` | us-east-1 | **Live owned India SC full PDFs** under `data/tar/year=YYYY/…`. The name looks like a template placeholder but the bucket **exists and holds production objects**. Do **not** remove from allowlist or treat as "unset". |
| `ns-highcourt-data-bucket` | us-east-1 | Owned HC PDFs (primary key layout). |
| `ns-indian-highcourt-judgements-2` | ap-south-1 | HC sibling fallback (identical keys). |
| `usa-caselaw` | ap-south-1 | Athena CTAS/results + US corpus support. |

**Public metadata (Glue/Athena sources, not always direct PDF):**

- `s3://indian-supreme-court-judgments/` — public SC metadata parquet (`sc_meta_src`).
- Owned CTAS: `s3://usa-caselaw/athena/judgments_meta/` → `nyv_docs.judgments_meta` (`s3_path` → SC owned bucket).
- HC: `nyv_docs.judgments_meta_hc` → `ns-highcourt-data-bucket` (+ sibling).

**Search behaviour (2026-08-06):** default archive scope = **SC only**; UI can select HC or All. Match = title/description `LIKE` only.

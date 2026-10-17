/**
 * NV-ANALYZE-STATUS-005 / NV-NSP-503-PERMANENCE-006 — "AFTER" verification.
 *
 * The gateway container runs `node --import tsx src/index.ts`, so the deployed
 * TypeScript SOURCE is what executes and can be driven in a short-lived sibling
 * process. That lets the fix be verified on the real deployed artifact WITHOUT a
 * deploy and without restarting the running gateway.
 *
 * The edited files are copied in beside the deployed tree first, so this measures the
 * changed code rather than the currently-running code — stated plainly because the
 * running gateway still serves the OLD behaviour until the architect deploys.
 *
 * Positive controls: PC=5150; the court fixture must yield fieldCount>0 (otherwise the
 * extractor, not the status, is what is being measured); and the three statuses must be
 * distinguishable, since a status that reports one value is no status at all.
 */
const COURT_DOC = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Ram Kumar Reddy, S/o Late Venkat Reddy, aged 42 years ..... PETITIONER
AND
The State of Telangana, rep. by Public Prosecutor ..... RESPONDENT
The petitioner seeks anticipatory bail under Section 438 of the Code of Criminal Procedure, 1973
in connection with FIR No. 233 of 2025 registered at Banjara Hills Police Station for offences
punishable under Sections 420 and 406 of the Indian Penal Code, 1860 and Section 66D of the
Information Technology Act, 2000. The matter is listed before the Hon'ble Justice A. Rajashekar
Reddy on 28 March 2025. The petitioner undertakes to deposit Rs. 5,00,000 within 30 days.
PRAYER: It is prayed that this Hon'ble Court may be pleased to grant anticipatory bail to the
petitioner pending disposal of the investigation.`;

(async () => {
  console.log('PC=5150');

  const fields = await import('/app/src/services/nv-court-document-fields.ts');
  const { buildCourtDocFieldBlock, extractCourtDocumentFields } = fields;

  console.log('\n=== NYV-6: three statuses on the deployed source ===');
  const extraction = await extractCourtDocumentFields(COURT_DOC, 'IN');
  console.log(`extractor_control fieldCount=${extraction.fieldCount} (must be > 0)`);
  if (!(extraction.fieldCount > 0)) { console.log('PROBE_BROKEN: extractor found nothing'); process.exit(1); }

  const structured = buildCourtDocFieldBlock(extraction, null, null);
  const unstructured = buildCourtDocFieldBlock(null, null, null);
  const failed = buildCourtDocFieldBlock(null, null, { failed: true, reason: 'extraction did not complete' });

  for (const [label, b] of [['STRUCTURED', structured], ['UNSTRUCTURED', unstructured], ['FAILED', failed]]) {
    console.log(`${label}: analysisStatus=${b.analysisStatus} fieldCount=${b.fieldCount} fieldSource=${b.fieldSource} statutes=${b.statutes.length}`);
    console.log(`  reason: ${b.analysisStatusReason}`);
  }

  const distinct = new Set([structured.analysisStatus, unstructured.analysisStatus, failed.analysisStatus]);
  console.log(`distinct_statuses=${distinct.size} (must be 3) -> ${JSON.stringify([...distinct])}`);

  // The crux of NSP's report: empty and failed carry identical arrays.
  const identical = ['fields', 'statutes', 'entitiesFlat', 'deadlinesFlat', 'obligationsFlat', 'risksFlat']
    .every((k) => JSON.stringify(unstructured[k]) === JSON.stringify(failed[k]));
  console.log(`empty_vs_failed_arrays_identical=${identical} (must be true — status is the ONLY difference)`);

  console.log('\n=== NYV-10: breaker is partitioned, hybrid can no longer blind fts/legal-work ===');
  const client = await import('/app/src/services/nv-nys-knowledge-client.ts');
  const { nysKnowledgeRequest, getNysKnowledgeClientStats, __resetNysBreakersForTest } = client;

  __resetNysBreakersForTest();
  process.env.NYS_KNOWLEDGE_BASE_URL = 'http://127.0.0.1:9'; // closed port: deterministic failure
  process.env.NYS_KNOWLEDGE_RETRIES = '0';
  process.env.NYS_KNOWLEDGE_CB_FAILURES = '2';
  process.env.NYS_KNOWLEDGE_CB_COOLDOWN_MS = '60000';

  for (let i = 0; i < 3; i++) {
    await nysKnowledgeRequest({ path: '/caselaw/search', query: { mode: 'hybrid' }, timeoutMs: 800 });
  }
  const stats = getNysKnowledgeClientStats();
  console.log(`openCircuits=${JSON.stringify(stats.openCircuits)} aggregate=${stats.circuit}`);

  const tripped = await nysKnowledgeRequest({ path: '/caselaw/search', timeoutMs: 800 });
  console.log(`caselaw/search (tripped)  -> status=${tripped.status} error="${tripped.error}"`);

  const other = await nysKnowledgeRequest({ path: '/legal-work/tasks', timeoutMs: 800 });
  console.log(`legal-work/tasks (other)  -> status=${other.status} error="${other.error}"`);
  console.log(`legal_work_still_attempts_upstream=${!/circuit open/i.test(String(other.error))} (must be true — this was the NSP defect)`);

  const verify = await nysKnowledgeRequest({ path: '/caselaw/verify-citation', method: 'POST', body: { citation: 'x' }, timeoutMs: 800 });
  console.log(`verify-citation (other)   -> status=${verify.status} error="${verify.error}"`);
  console.log(`verify_still_attempts_upstream=${!/circuit open/i.test(String(verify.error))} (must be true)`);

  console.log('DONE=5150');
})().catch((e) => { console.log(`PROBE_ERROR ${e && e.stack ? e.stack : e}`); process.exit(1); });

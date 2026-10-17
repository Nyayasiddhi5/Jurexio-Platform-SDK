#!/usr/bin/env bash
# NV-LEGALCHAT-QE-001 — READ-ONLY before-picture probe.
#
# Confirms whether the CURRENTLY DEPLOYED gateway emits `qualityEnvelope` on the
# legal-chat run_complete SSE event, and (as a positive control) that the same
# build DOES emit one on /api/jrx/orchestrate. The container has no curl, so the
# request is made with node+fetch inside it.
#
# Strictly read-only: no restart, no redeploy, no compose invocation.
set -uo pipefail

C=nyv-gateway

echo "=== instrument validation: container up? ==="
docker ps --filter "name=${C}" --format '{{.Names}} {{.Status}}' || true

echo
echo "=== instrument validation: node present + key readable (length only, never the value) ==="
docker exec "$C" node -e 'const k=process.env.NYV_SDK_KEY_NSP||""; console.log("node_ok=1 key_len="+k.length)' 2>&1 | tail -3

echo
echo "=== PROBE A (positive control): /api/jrx/orchestrate should carry qualityEnvelope ==="
docker exec "$C" node -e '
const key = process.env.NYV_SDK_KEY_NSP || "";
if (!key) { console.log("ABORT: key_len=0 — instrument wrong, not a platform finding"); process.exit(0); }
(async () => {
  const r = await fetch("http://127.0.0.1:5000/api/jrx/orchestrate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key,
               "x-nyv-platform": "nsp", "x-nyv-consent": "granted" },
    body: JSON.stringify({ prompt: "One line: is anticipatory bail maintainable in India?", tier: "pro" }),
  });
  const j = await r.json().catch(() => null);
  const qe = j && (j.data ? j.data.qualityEnvelope : j.qualityEnvelope);
  console.log("http=" + r.status);
  console.log("hasQualityEnvelope=" + !!qe);
  if (qe) {
    console.log("completed=" + JSON.stringify(qe.completed));
    console.log("scaledOptional=" + JSON.stringify(qe.scaledOptional));
    console.log("deferred=" + JSON.stringify(qe.deferred === undefined ? "FIELD_ABSENT" : qe.deferred));
    console.log("missingMandatory=" + JSON.stringify(qe.missingMandatory));
    console.log("ok=" + qe.ok + " failClosed=" + qe.failClosed);
    const hitl = (qe.steps || []).find(s => s.id === "hitl");
    console.log("hitlRecord=" + JSON.stringify(hitl || null));
    console.log("hitlInCompleted=" + (qe.completed || []).includes("hitl"));
  }
})().catch(e => console.log("PROBE_A_ERR " + e.message));
' 2>&1 | tail -20

echo
echo "=== PROBE B: legal-chat /send run_complete — does data carry qualityEnvelope? ==="
echo "(legal-chat is admin-JWT gated, so a partner key is expected to be rejected;"
echo " the status code itself tells us which auth wall we hit.)"
docker exec "$C" node -e '
const key = process.env.NYV_SDK_KEY_NSP || "";
(async () => {
  const r = await fetch("http://127.0.0.1:5000/api/jrx/legal-chat/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key,
               "x-nyv-platform": "nsp", "x-nyv-consent": "granted" },
    body: JSON.stringify({ prompt: "One line: is anticipatory bail maintainable?" }),
  });
  console.log("http=" + r.status + " ctype=" + r.headers.get("content-type"));
  const text = await r.text();
  console.log("bodylen=" + text.length);
  console.log("body_head=" + text.slice(0, 400));
  const line = text.split("\n").find(l => l.startsWith("data: ") && l.includes("run_complete"));
  if (!line) { console.log("no run_complete event observed"); return; }
  const ev = JSON.parse(line.slice(6));
  console.log("run_complete_data_keys=" + JSON.stringify(Object.keys(ev.data || {})));
  console.log("hasQualityEnvelope=" + ("qualityEnvelope" in (ev.data || {})));
})().catch(e => console.log("PROBE_B_ERR " + e.message));
' 2>&1 | tail -20

echo
echo "=== done (read-only; nothing restarted) ==="

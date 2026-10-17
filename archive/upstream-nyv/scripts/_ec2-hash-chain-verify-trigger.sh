#!/usr/bin/env bash
set -euo pipefail
echo "=== trigger hash chain verification ==="
docker exec nyv-gateway node -e "
import('./services/hash-chain-verifier.js').then(m => m.runHashChainVerification())
  .then(r => { console.log(JSON.stringify(r.map(x => ({ platform: x.platform, verified: x.verified, broken: x.brokenLinks.length, linkage: x.linkageBreaks })))); process.exit(r.every(x => x.verified) ? 0 : 1); })
  .catch(e => { console.error(e); process.exit(2); });
" 2>&1 || docker exec nyv-gateway npx tsx -e "
import { runHashChainVerification } from './src/services/hash-chain-verifier.js';
const r = await runHashChainVerification();
console.log(JSON.stringify(r.map(x => ({ platform: x.platform, verified: x.verified, broken: x.brokenLinks.length, linkage: x.linkageBreaks }))));
process.exit(r.every(x => x.verified) ? 0 : 1);
"
echo "=== log tail ==="
docker logs nyv-gateway --since 2m 2>&1 | grep -E 'hash_chain_integrity_(ok|failure)' | tail -5 || echo "(none yet)"
curl -sS -o /dev/null -w 'health_http=%{http_code}\n' http://127.0.0.1:5000/api/jrx/health
echo "=== PROBE COMPLETE ==="

#!/usr/bin/env bash
# Extract CNR/athena context from live bundle (no secrets).
node -e "
const fs=require('fs');
const s=fs.readFileSync('/opt/nyv/api/index.mjs','utf8');
const keys=['opendata_athena','45000','resolveCnr','athenaByCnr','caseCreate','cnr/resolve'];
for (const k of keys) {
  const i=s.indexOf(k);
  console.log('---', k, 'idx', i);
  if (i>=0) console.log(s.slice(Math.max(0,i-120), i+180).replace(/\n/g,' '));
}
"

#!/usr/bin/env bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('/opt/nyv/api/index.mjs','utf8');
const start=s.indexOf('async function athenaByCnr');
console.log(s.slice(start, start+2500));
console.log('--- resolve athena tier ---');
const r=s.indexOf('if (!judgments.length)');
console.log(s.slice(r, r+1800));
"

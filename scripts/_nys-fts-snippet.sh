#!/usr/bin/env bash
node -e "
const fs=require('fs');
const s=fs.readFileSync('/opt/nyv/api/index.mjs.bak-cnr-20260902T165735Z','utf8');
const i=s.indexOf('nys_fts');
console.log('idx', i);
console.log(s.slice(i-200, i+500));
"

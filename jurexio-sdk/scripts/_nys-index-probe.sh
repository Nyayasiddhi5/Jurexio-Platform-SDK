#!/usr/bin/env bash
grep -c opendata_athena /opt/nyv/api/index.mjs || true
grep -c 45000 /opt/nyv/api/index.mjs || true
grep -c cnrResolve /opt/nyv/api/index.mjs || true
ls -la /opt/nyv/api/node_modules/esbuild/package.json 2>/dev/null || echo no_esbuild
wc -c /opt/nyv/api/index.mjs

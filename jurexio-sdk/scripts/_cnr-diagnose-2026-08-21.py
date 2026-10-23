#!/usr/bin/env python3
"""CNR diagnostic — logs + RDS + stack trace probe."""
import json
import os
import subprocess
import urllib.request

def run(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, text=True, timeout=60)
    except subprocess.CalledProcessError as e:
        return e.output
    except Exception as e:
        return str(e)

print("=== LOGS (cnr/error) ===")
print(run("journalctl -u nyv-api --no-pager -n 120 2>/dev/null | grep -iE 'cnr|resolve|error' | tail -25") or run("tail -60 /opt/nyv/logs/api.log 2>/dev/null | grep -iE 'cnr|error' | tail -25"))

print("=== RDS NODE ===")
print(run(
    "set -a && source /opt/nyv/api/.env && set +a && "
    "node -e \"const pg=require('pg');(async()=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); "
    "for (const c of ['RJHC010324382023','TSWL000000742024','TSWL010000012024']) { "
    "try { const j=await p.query('SELECT id,court_type,cnr,left(title,50) t FROM judgments WHERE cnr=\\$1 LIMIT 1',[c]); "
    "const d=await p.query('SELECT cnr FROM cnr_case_details WHERE cnr=\\$1 LIMIT 1',[c]); "
    "console.log('RDS',c,'j=',j.rowCount,'d=',d.rowCount,j.rows[0]||''); } catch(e){console.log('RDS',c,'ERR',e.message);} } "
    "await p.end();})();\""
))

print("=== RESOLVE INLINE NODE (catch err) ===")
print(run(
    "set -a && source /opt/nyv/api/.env && set +a && "
    "cd /opt/nyv/api && node -e \""
    "(async()=>{ try { const m=await import('./index.mjs'); console.log('index import ok'); } catch(e){ console.log('import err', e.message); } "
    "try { const { resolveCnr } = await import('./lib/cnrResolve.js'); "
    "const r=await resolveCnr({cnr:'TSWL000000742024'}); console.log('resolve ok', r.status, r.source); "
    "} catch(e){ console.log('resolve ERR', e.message, e.stack?.split('\\n').slice(0,8).join(' | ')); } "
    "try { const { resolveCnr } = await import('./lib/cnrResolve.js'); "
    "const r=await resolveCnr({cnr:'RJHC010324382023', profile:'caseCreate'}); console.log('rjhc ok', r.status, r.source, !!r.caseCreate); "
    "} catch(e){ console.log('rjhc ERR', e.message, e.stack?.split('\\n').slice(0,8).join(' | ')); } "
    "})();\""
))

print("=== WORKER MD5 ===")
print(run("md5sum /opt/nyv/api/index.mjs 2>/dev/null || ls -la /opt/nyv/api/index.mjs"))

#!/usr/bin/env bash
# NV-AGENT-PROMPT-DEPTH-001 — A/B the depth ladder against the LIVE gateway.
#
# Runs ON the EC2 host (same pattern as _ec2-partner-coverage-verify.sh) so it
# uses the canonical partner keys and localhost, with no public exposure.
#
# Same build, same prompts, same keys. The ONLY difference between arms is the
# NYV_AGENT_PROMPT_DEPTH override, so the comparison isolates the restored
# registry sections instead of confounding a redeploy:
#
#   arm A (control) = NYV_AGENT_PROMPT_DEPTH=core  → exact pre-fix behaviour
#   arm B (treated) = override removed             → budget-derived depth
#
# Scored on observable signals that map 1:1 to the sections restored, so the
# verdict does not rest on anyone's taste:
#   bns      §3 — cites BNS/BNSS/BSA 2023
#   stale    §3 — cites IPC/CrPC with NO repeal framing  (lower is better)
#   cite     §6 — emits [CITATION: …] markers
#   irac     §4 — Issue / Rule / Application / Conclusion structure
#   proof    §5 — names a standard of proof
#
# Usage (on host):  sh /tmp/ab.sh [runs_per_prompt]
set -uo pipefail

CANON="${NVB_CANON:-/opt/Nyayavigya/secrets/.env.production}"
API=http://localhost:5000
RUNS="${1:-2}"
OUT="/tmp/jrx-ab-depth-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"

key() { grep -E "^$1=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NSPK=$(key NYV_SDK_KEY_NSP)
[ -n "$NSPK" ] || { echo "FATAL: NSP key not resolved from $CANON"; exit 1; }

LIVE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' nyv-gateway 2>/dev/null)
[ -n "$LIVE" ] || { echo "FATAL: cannot resolve live compose dir"; exit 1; }
echo "live compose dir: $LIVE"
echo "output: $OUT"

# Safety: never leave the control-arm override in place. If this script dies
# mid-run, the trap restores the shipped (budget-derived) behaviour rather than
# silently pinning production to the pre-fix `core` rung.
cleanup() {
  if [ -f "$LIVE/docker-compose.ab-depth.yml" ]; then
    echo "cleanup: removing depth override and restoring shipped default"
    rm -f "$LIVE/docker-compose.ab-depth.yml"
    P=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' nyv-gateway 2>/dev/null)
    ( cd "$LIVE" && docker compose -p "${P:-nyayavigya-platform-312}" \
        -f docker-compose.aws-dev.yml up -d --force-recreate --no-deps gateway 2>&1 | tail -3 )
    echo "cleanup: containerEnv now=$(docker exec nyv-gateway sh -lc 'printenv NYV_AGENT_PROMPT_DEPTH' 2>/dev/null || echo '<unset>')"
  fi
}
trap cleanup EXIT INT TERM

# Phrased in the REPEALED vocabulary on purpose: a correct answer has to apply
# the §3 repeal rule rather than mirror the user's wording back.
P0="What is the punishment for cheating under IPC 420 and which court has jurisdiction?"
P1="Draft a legal notice for recovery of money for a Delhi client under CrPC procedure."
P2="Research the position on anticipatory bail under CrPC 438, including the standard of proof."

set_depth() { # $1 = core | auto
  # Two lessons are encoded here, both learned the hard way in this session:
  #
  # 1. docker-compose.aws-dev.yml declares `environment:` explicitly, so an
  #    exported shell var does NOT reach the container. It must come in via a
  #    compose override file.
  # 2. Passing `-f a.yml -f b.yml` changes compose's derived PROJECT NAME, which
  #    made `up` try to CREATE a second container called nyv-gateway and fail
  #    with a name conflict. `-p` pins the project so the existing container is
  #    recreated in place. (First attempt hid this by discarding stderr and then
  #    scored the untouched container twice, yielding a bogus "zero delta".)
  OVR="$LIVE/docker-compose.ab-depth.yml"
  PROJ=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' nyv-gateway 2>/dev/null)
  PROJ="${PROJ:-nyayavigya-platform-312}"

  if [ "$1" = "core" ]; then
    printf 'services:\n  gateway:\n    environment:\n      - NYV_AGENT_PROMPT_DEPTH=core\n' > "$OVR"
    ( cd "$LIVE" && docker compose -p "$PROJ" \
        -f docker-compose.aws-dev.yml -f docker-compose.ab-depth.yml \
        up -d --force-recreate --no-deps gateway 2>&1 | tail -6 )
  else
    rm -f "$OVR"
    ( cd "$LIVE" && docker compose -p "$PROJ" -f docker-compose.aws-dev.yml \
        up -d --force-recreate --no-deps gateway 2>&1 | tail -6 )
  fi

  # Wait for the recreated container to answer, then assert the arm is genuinely
  # configured before any request is scored against it.
  i=0; c=000
  while [ $i -lt 80 ]; do
    c=$(curl -s -o /dev/null -w '%{http_code}' "$API/health" 2>/dev/null || echo 000)
    [ "$c" = "200" ] && break
    i=$((i+1)); sleep 3
  done
  CID12=$(docker inspect -f '{{.Id}}' nyv-gateway 2>/dev/null | cut -c1-12)
  ENVV=$(docker exec nyv-gateway sh -lc 'printenv NYV_AGENT_PROMPT_DEPTH' 2>/dev/null)
  echo "  arm=$1 project=$PROJ health=$c after $((i*3))s container=$CID12 containerEnv=${ENVV:-<unset>}"

  if [ "$1" = "core" ] && [ "$ENVV" != "core" ]; then
    echo "  FATAL: control arm did not receive NYV_AGENT_PROMPT_DEPTH=core — aborting rather than reporting a bogus zero delta"
    exit 3
  fi
  if [ "$1" = "auto" ] && [ -n "$ENVV" ]; then
    echo "  FATAL: treated arm still has an override ($ENVV) — aborting"
    exit 3
  fi
}

ask() { # $1 arm  $2 idx  $3 run  $4 prompt  $5 task
  # Cache defeat. The first run returned several answers in 0-1s with byte-identical
  # lengths across arms — those were cache replays, which would mask any prompt
  # difference no matter how large. A unique nonce per (arm, prompt, run) forces a
  # genuine generation, and `noCache` is set in case the gateway honours it.
  NONCE="ab-$1-p$2-r$3-$(date +%s)-$$"
  body=$(python3 -c "
import json,sys
p, task, nonce = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({
  'prompt': p + '\n\n[ref:' + nonce + ']',
  'taskType': task,
  'jurisdiction': 'IN',
  'enableRAG': True,
  'enableCoT': True,
  'noCache': True,
  'sessionId': nonce,
}))
" "$4" "$5" "$NONCE")
  f="$OUT/$1-p$2-r$3.json"
  t0=$(date +%s)
  http=$(curl -sS -m 300 -o "$f" -w '%{http_code}' -X POST \
    -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -H 'X-NYV-Consent: granted' -H 'Cache-Control: no-cache' \
    -d "$body" "$API/api/jrx/orchestrate" 2>/dev/null || echo 000)
  t1=$(date +%s)
  DUR=$((t1-t0))
  echo "$1 p$2 r$3 http=$http ${DUR}s" >> "$OUT/http.txt"
  # A sub-2s answer on a research/drafting task is almost certainly still a
  # replay; flag it so the scorer's verdict can be read with that in mind.
  [ "$DUR" -lt 2 ] && echo "$1-p$2-r$3" >> "$OUT/suspected-cache.txt"
}

run_arm() {
  arm="$1"
  n=1
  while [ $n -le "$RUNS" ]; do
    ask "$arm" 0 "$n" "$P0" chat
    ask "$arm" 1 "$n" "$P1" document-drafting
    ask "$arm" 2 "$n" "$P2" research
    n=$((n+1))
  done
}

echo
echo "=== arm A (control: depth=core = pre-fix) ==="
set_depth core
run_arm A

echo
echo "=== arm B (treated: budget-derived depth) ==="
set_depth auto
run_arm B

echo
echo "=== scoring ==="
python3 - "$OUT" <<'PY'
import json, os, re, sys
out = sys.argv[1]
def text(p):
    try:
        d = json.load(open(p))
    except Exception:
        return ''
    for k in ('content','answer','response','result','text','output'):
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return json.dumps(d)

def score(t):
    bns   = 1 if re.search(r'BNS\s*2023|BNSS\s*2023|BSA\s*2023|Bharatiya Nyaya', t, re.I) else 0
    ipc   = bool(re.search(r'\bIPC\b|\bCrPC\b', t, re.I))
    frame = bool(re.search(r'repeal|prior law|erstwhile|now BNS|replaced by|superseded', t, re.I))
    stale = 1 if (ipc and not frame) else 0
    cite  = len(re.findall(r'\[CITATION:', t))
    irac  = 1 if (re.search(r'\bissue', t, re.I) and re.search(r'\brule|applicable law', t, re.I)
                  and re.search(r'application|analysis', t, re.I) and re.search(r'conclusion', t, re.I)) else 0
    proof = 1 if re.search(r'beyond reasonable doubt|preponderance|balance of probabilit|prima facie', t, re.I) else 0
    return bns, stale, cite, irac, proof, len(t)

agg = {}
print(f"{'arm':<4}{'p':<4}{'run':<5}{'bns':<5}{'stale':<7}{'cite':<6}{'irac':<6}{'proof':<7}{'len':<7}")
for arm in ('A','B'):
    tot = [0,0,0,0,0,0]; n = 0
    for fn in sorted(os.listdir(out)):
        if not fn.startswith(f'{arm}-') or not fn.endswith('.json'):
            continue
        m = re.match(rf'{arm}-p(\d+)-r(\d+)\.json', fn)
        if not m: continue
        s = score(text(os.path.join(out, fn)))
        print(f"{arm:<4}{m.group(1):<4}{m.group(2):<5}{s[0]:<5}{s[1]:<7}{s[2]:<6}{s[3]:<6}{s[4]:<7}{s[5]:<7}")
        tot = [a+b for a,b in zip(tot,s)]; n += 1
    agg[arm] = (tot, n)

print()
print(f"{'arm':<4}{'n':<4}{'bns%':<7}{'stale%':<8}{'cite/ans':<10}{'irac%':<7}{'proof%':<8}")
for arm,(t,n) in agg.items():
    if not n: continue
    print(f"{arm:<4}{n:<4}{100*t[0]//n:<7}{100*t[1]//n:<8}{t[2]/n:<10.1f}{100*t[3]//n:<7}{100*t[4]//n:<8}")

if agg['A'][1] and agg['B'][1]:
    a,na = agg['A']; b,nb = agg['B']
    print("\ndelta B-A (positive = depth helped; stale should go DOWN):")
    print(f"  BNS2023 cited : {100*b[0]//nb - 100*a[0]//na:+d} pp")
    print(f"  stale IPC/CrPC: {100*b[1]//nb - 100*a[1]//na:+d} pp")
    print(f"  [CITATION]/ans: {b[2]/nb - a[2]/na:+.1f}")
    print(f"  IRAC structure: {100*b[3]//nb - 100*a[3]//na:+d} pp")
    print(f"  proof standard: {100*b[4]//nb - 100*a[4]//na:+d} pp")
PY

echo
echo "http codes:"; cat "$OUT/http.txt" 2>/dev/null
if [ -f "$OUT/suspected-cache.txt" ]; then
  echo
  echo "WARNING — sub-2s responses (likely cache replays, not fresh generations):"
  cat "$OUT/suspected-cache.txt"
  echo "Treat any zero delta involving these as INCONCLUSIVE, not as evidence the fix does nothing."
fi
echo "raw bodies in $OUT"

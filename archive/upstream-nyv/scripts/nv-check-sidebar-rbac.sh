#!/usr/bin/env bash
# NV-SIDEBAR-RBAC-001 (2026-05-11) — Verify every NyvSidebar entry maps to a
# real App.tsx route AND its section minRole >= the route's ProtectedRoute
# minRole. Prevents sidebar/route RBAC drift like the 4 bugs found in the
# Phase-2 architect review.
#
# Run: bash scripts/jrx-check-sidebar-rbac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SIDEBAR="client/src/components/NyvSidebar.tsx"
APP="client/src/App.tsx"

fail=0
# Extract section blocks: id, minRole, and item paths.
# Crude but robust enough for the static sidebar layout we maintain.
python3 - "$SIDEBAR" "$APP" <<'PY'
import re, sys
sidebar_src = open(sys.argv[1]).read()
app_src     = open(sys.argv[2]).read()

LVL = {
  'super_admin':100,'enterprise_admin':80,'org_admin':70,'manager':60,
  'senior_analyst':55,'analyst':50,'developer':45,'operator':40,'user':10,
}

# Build route presence + {path: minRole?} map from App.tsx.
route_path_re = re.compile(r'<Route path="([^"]+)"')
route_paths = {m.group(1) for m in route_path_re.finditer(app_src)}
route_role_re = re.compile(r'<Route path="([^"]+)">\{\(\) => <ProtectedRoute minRole="(\w+)"')
route_roles = {m.group(1): m.group(2) for m in route_role_re.finditer(app_src)}

# Parse sidebar SECTIONS array — find each section's id, minRole, and items.
section_re = re.compile(
  r"id:\s*'([^']+)',\s*\n\s*title:\s*'[^']+',\s*\n[^}]*?minRole:\s*'(\w+)',\s*\n\s*items:\s*\[(.*?)\],",
  re.S,
)
item_obj_re = re.compile(r"\{[^{}]*path:\s*'([^']+)'[^{}]*\}", re.S)
item_role_re = re.compile(r"minRole:\s*'(\w+)'")

problems = []
for sec_id, sec_role, items_block in section_re.findall(sidebar_src):
  for obj in item_obj_re.finditer(items_block):
    path = obj.group(1)
    base_path = path.split('?')[0]
    item_blob = obj.group(0)
    item_role_match = item_role_re.search(item_blob)
    effective_role = item_role_match.group(1) if item_role_match else sec_role
    sec_lvl = LVL.get(effective_role, 0)
    if base_path not in route_paths:
      problems.append(f"  [MISSING ROUTE]  section={sec_id}  path={path}  (no <Route path=\"{base_path}\"> in App.tsx)")
      continue
    route_role = route_roles.get(base_path)
    if route_role is None:
      continue
    rt_lvl = LVL.get(route_role, 0)
    if sec_lvl < rt_lvl:
      problems.append(f"  [RBAC GAP]       section={sec_id}({effective_role}={sec_lvl}) < route={base_path}({route_role}={rt_lvl})")

if problems:
  print("✗ NV-SIDEBAR-RBAC-001 violations:")
  for p in problems:
    print(p)
  sys.exit(1)
print("✓ NV-SIDEBAR-RBAC-001 — all sidebar entries map to live routes with compliant RBAC.")
PY

/**
 * tests/regression/sidebar-route-render.test.tsx
 *
 * Regression sweep — for every path declared in `client/src/components/
 * NyvSidebar.tsx`, find the matching `<Route path=…>` in `client/src/App.tsx`,
 * resolve the lazy-import target, and dynamic-import the page module.
 *
 * Asserts:
 *   • each sidebar path has a matching Route in App.tsx,
 *   • the lazy-imported page module loads without throwing, and
 *   • exposes a default export that is a function (React component).
 *
 * We deliberately do NOT mount with @testing-library/react — pulling the
 * full component tree into vitest would require jsdom + every page's
 * Provider chain (Auth/Org/Language/QueryClient/Wouter). The module-load
 * sweep catches the most common regressions (broken import paths, missing
 * default export, top-level evaluation errors) without that overhead.
 *
 * @vitest-environment node
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const SIDEBAR = path.join(ROOT, 'client', 'src', 'components', 'NyvSidebar.tsx');
const APP_TSX = path.join(ROOT, 'client', 'src', 'App.tsx');

function readSidebarPaths(): string[] {
  const src = fs.readFileSync(SIDEBAR, 'utf8');
  const re = /path:\s*['"]([^'"]+)['"]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  return Array.from(out).sort();
}

interface RouteMap {
  // path -> component identifier (e.g. CommandCentre)
  pathToComponent: Map<string, string>;
  // component identifier -> import target (e.g. ./pages/command-centre)
  componentToImport: Map<string, string>;
  // path -> minRole declared on its <ProtectedRoute>
  pathToMinRole: Map<string, string>;
}

// Mirror of ROLE_LEVELS in client/src/components/NyvSidebar.tsx — kept in
// sync manually because the sidebar file is JSX/TSX and we read it as text.
const ROLE_LEVELS: Record<string, number> = {
  super_admin: 100, enterprise_admin: 80, org_admin: 70, manager: 60,
  senior_analyst: 55, analyst: 50, developer: 45, operator: 40, user: 10,
};

interface SidebarItem { sectionMin: string; itemMin: string | null; path: string; }

function readSidebarItems(): SidebarItem[] {
  const src = fs.readFileSync(SIDEBAR, 'utf8');
  // Parse SECTIONS by splitting on top-level section objects. Cheap and
  // robust enough for our literal-array structure.
  const sectionRe = /\{\s*id:\s*'[^']+',[\s\S]*?minRole:\s*'(\w+)',[\s\S]*?items:\s*\[([\s\S]*?)\][\s\S]*?\},/g;
  const itemRe    = /\{\s*label:[^}]*?path:\s*['"]([^'"]+)['"][^}]*?\}/g;
  const itemMinRe = /minRole:\s*['"](\w+)['"]/;
  const out: SidebarItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(src))) {
    const sectionMin = m[1];
    const body = m[2];
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(body))) {
      const itemBlock = im[0];
      const path = im[1];
      const min = itemMinRe.exec(itemBlock);
      out.push({ sectionMin, itemMin: min ? min[1] : null, path });
    }
  }
  return out;
}

function readAppRoutes(): RouteMap {
  const src = fs.readFileSync(APP_TSX, 'utf8');
  const pathToComponent = new Map<string, string>();
  const componentToImport = new Map<string, string>();
  const pathToMinRole = new Map<string, string>();

  // <Route path="/foo">{() => <ProtectedRoute minRole="…">…</ProtectedRoute>}</Route>
  const protectedRe = /<Route\s+path="([^"]+)">\s*\{[^}]*?<ProtectedRoute[^>]*?minRole="(\w+)"/g;
  let pm: RegExpExecArray | null;
  while ((pm = protectedRe.exec(src))) {
    if (!pathToMinRole.has(pm[1])) pathToMinRole.set(pm[1], pm[2]);
  }

  // <Route path="/foo">...</Route>  — capture the path, then within
  // each Route's body separately extract the FIRST self-closing JSX
  // identifier (the page component). The previous single-regex form
  // had a lazy quantifier that consumed across sibling Route blocks,
  // which silently dropped paths whose body's first self-close lived
  // inside a NESTED component (e.g. `<RedirectTo to=… />` wrappers).
  const routeBlockRe = /<Route\s+path="([^"]+)">([\s\S]*?)<\/Route>/g;
  const innerSelfCloseRe = /<(\w+)\s*\/>/;
  let m: RegExpExecArray | null;
  while ((m = routeBlockRe.exec(src))) {
    const path = m[1];
    const body = m[2];
    if (!pathToComponent.has(path)) {
      const inner = innerSelfCloseRe.exec(body);
      pathToComponent.set(path, inner ? inner[1] : '__no-component__');
    }
  }

  // const Foo = lazy(() => import('./pages/foo'));
  const lazyRe = /const\s+(\w+)\s*=\s*lazy\(\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
  while ((m = lazyRe.exec(src))) componentToImport.set(m[1], m[2]);

  return { pathToComponent, componentToImport, pathToMinRole };
}

const sidebarPaths = readSidebarPaths();
const sidebarItems = readSidebarItems();
const { pathToComponent, componentToImport, pathToMinRole } = readAppRoutes();

describe('NyvSidebar → App.tsx Route coverage', () => {
  it('sidebar fits the 7-section / ≤25-entry IA (task-344, 2026-05-13)', () => {
    // Floor (20) guards against accidental deletions; ceiling (25) guards
    // against the sidebar drifting back toward the pre-consolidation 50+ entries.
    expect(sidebarPaths.length).toBeGreaterThanOrEqual(20);
    expect(sidebarPaths.length).toBeLessThanOrEqual(25);
  });

  for (const p of sidebarPaths) {
    it(`route exists for sidebar path ${p}`, () => {
      // Strip ?tab=…/?jurisdiction=… deep-link suffixes — sidebar entries
      // legitimately point at hub URLs with query strings; the matching
      // <Route> in App.tsx is registered against the bare path.
      const bare = p.split('?')[0];
      expect(
        pathToComponent.has(bare),
        `Sidebar path ${p} has no <Route path="${bare}"> in App.tsx`,
      ).toBe(true);
    });
  }
});

// task-344 Step 5 — assert no <Route> in App.tsx points at an undefined
// component identifier (catches the orphan-import regressions that crashed
// /agent-activity, /digital-twin, /feature-test in earlier sessions).
describe('App.tsx Route coverage — every Route resolves to a defined component', () => {
  // Eager-imported components from the top of App.tsx (NotFound, Login,
  // IndexLanding) plus the local helper component RedirectTo are not
  // registered via lazy() but are still legitimate route targets.
  const EAGER_COMPONENTS = new Set([
    'NotFound', 'Login', 'IndexLanding', 'RedirectTo', 'OnboardingWizard', 'RoleHome',
  ]);

  for (const [path, component] of pathToComponent.entries()) {
    if (component === '__no-component__') continue;
    it(`Route ${path} → <${component} /> is a defined import`, () => {
      const isLazy = componentToImport.has(component);
      const isEager = EAGER_COMPONENTS.has(component);
      expect(
        isLazy || isEager,
        `Route path="${path}" renders <${component} /> but no lazy() or eager import is declared in App.tsx — orphan route.`,
      ).toBe(true);
    });
  }
});

// task-344 — sidebar role declarations must be consistent with the
// ProtectedRoute on the matching <Route>. Two failure modes:
//   1. Section gates a user out of a section whose item they could open
//      (operator-visible HITL hidden behind an analyst-gated section).
//   2. Sidebar item promises a role lower than the route actually requires
//      (sidebar shows /audit-chain to analyst, route demands org_admin —
//      user clicks, gets the access-denied screen).
describe('NyvSidebar ↔ App.tsx role-gating consistency', () => {
  for (const it_ of sidebarItems) {
    const bare = it_.path.split('?')[0];
    const routeMin = pathToMinRole.get(bare);

    if (it_.itemMin) {
      it(`sidebar item ${it_.path} (minRole=${it_.itemMin}) ≥ section minRole (${it_.sectionMin})`, () => {
        // Section is a hard filter — an item gated lower than its section
        // would simply never display, so item minRole must be ≥ section
        // minRole. (Item ungated = inherits section gate, also fine.)
        expect(
          (ROLE_LEVELS[it_.itemMin!] ?? 0) >= (ROLE_LEVELS[it_.sectionMin] ?? 0),
          `Item ${it_.path} sets minRole=${it_.itemMin} below its section's minRole=${it_.sectionMin} → section filter would hide it.`,
        ).toBe(true);
      });
    }

    if (routeMin) {
      const effectiveSidebarMin = it_.itemMin ?? it_.sectionMin;
      it(`sidebar item ${it_.path} effective minRole (${effectiveSidebarMin}) ≥ route minRole (${routeMin})`, () => {
        // The user's role must clear BOTH gates. If the sidebar shows the
        // entry to a role that the route then refuses, we send that user
        // straight into Access Denied — broken UX.
        expect(
          (ROLE_LEVELS[effectiveSidebarMin] ?? 0) >= (ROLE_LEVELS[routeMin] ?? 0),
          `Sidebar shows ${it_.path} to role "${effectiveSidebarMin}" but route requires "${routeMin}" — user would land on Access Denied.`,
        ).toBe(true);
      });
    }
  }
});

// task-344 Step 5 — every `lazy(() => import('./pages/x'))` target in
// App.tsx must resolve to an actual file on disk. Catches the orphan-import
// class of bug (a `lazy()` whose import path no longer exists silently
// compiles, and only crashes the browser when a user navigates to that
// route). We can't load App.tsx as a module here because it touches
// browser-only globals (`window.addEventListener`) at module top, and
// the full jsdom provider chain (Auth/Org/QueryClient/Wouter) is too
// heavy for a regression sweep — a static disk check gives the same
// guarantee without that overhead.
describe('App.tsx lazy() imports — every target file exists', () => {
  for (const [component, importPath] of componentToImport.entries()) {
    it(`lazy(${component}) → ${importPath} resolves on disk`, () => {
      const base = path.resolve(path.dirname(APP_TSX), importPath);
      const candidates = [
        base,
        `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`,
        path.join(base, 'index.ts'),  path.join(base, 'index.tsx'),
        path.join(base, 'index.js'),  path.join(base, 'index.jsx'),
      ];
      const exists = candidates.some(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
      expect(
        exists,
        `lazy(${component}) imports "${importPath}" but no matching file exists on disk — orphan route in App.tsx.`,
      ).toBe(true);
    });
  }
});

describe('NyvSidebar lazy-import sweep — every sidebar page module loads', () => {
  for (const p of sidebarPaths) {
    const componentName = pathToComponent.get(p);
    if (!componentName) continue;
    const importTarget = componentToImport.get(componentName);
    if (!importTarget) {
      // Not a lazy-loaded page (e.g. eager-imported NotFound) — skip silently.
      it.skip(`${p} → ${componentName} (eager import, skipped)`, () => {});
      continue;
    }

    it(`${p} → ${componentName} module loads`, async () => {
      // Resolve relative-to-App.tsx import target → absolute path.
      const abs = path.resolve(path.dirname(APP_TSX), importTarget);
      // Dynamic import via file:// URL so vitest resolves with the right loader.
      const url = (await import('node:url')).pathToFileURL(abs).href;
      let mod: any;
      try {
        mod = await import(/* @vite-ignore */ url);
      } catch (err) {
        // Some pages import .css / static asset side-effects that the node
        // loader can't resolve — accept ONLY those as non-regressions.
        //
        // Architect-tightened (2026-05-06): the previous regex also matched
        // `@/` alias errors and silently soft-passed them, hiding real
        // import-path regressions. The vitest config now provides the `@/`
        // alias (vitest.config.ts), so any `@/` failure here is a true
        // regression and MUST throw.
        const msg = (err as Error).message || '';
        if (/ERR_UNKNOWN_FILE_EXTENSION|Cannot find module .*\.(css|scss|sass|less|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|otf|eot)['"]?$/i.test(msg)) {
          return;
        }
        throw err;
      }
      expect(mod).toBeDefined();
      expect(typeof mod.default === 'function' || typeof mod.default === 'object').toBe(true);
    });
  }
});

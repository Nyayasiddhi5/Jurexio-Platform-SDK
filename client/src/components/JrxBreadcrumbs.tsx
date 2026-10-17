/**
 * JrxBreadcrumbs — Console route breadcrumbs derived from the exported B4
 * sidebar tree (task-180/B5). The path → section/item index is *built* from
 * JrxSidebar's `SECTIONS` array at module load — there is no parallel hand-
 * maintained map, so adding a sidebar item automatically gives that route a
 * breadcrumb without any extra wiring.
 */

import React, { useMemo } from 'react';
import { useLocation } from 'wouter';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SECTIONS } from '@/components/JrxConsoleSidebar';

interface CrumbEntry {
  section: string;
  item: string;
}

// Build the path index from the sidebar tree. Strip query strings since some
// sidebar items embed `?tab=` (e.g. /sdk-hub?tab=overview).
function buildPathIndex(): Record<string, CrumbEntry> {
  const idx: Record<string, CrumbEntry> = {};
  for (const section of SECTIONS) {
    for (const item of section.items) {
      const path = item.path.split('?')[0];
      if (!idx[path]) {
        idx[path] = { section: section.title, item: item.label };
      }
    }
  }
  return idx;
}

const PATH_INDEX = buildPathIndex();

function humanise(segment: string): string {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function lookupCrumb(pathname: string): CrumbEntry | null {
  if (PATH_INDEX[pathname]) return PATH_INDEX[pathname];
  // Walk parents (e.g. /orchestration/lineage/abc → /orchestration).
  const parts = pathname.split('/').filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = '/' + parts.slice(0, i).join('/');
    if (PATH_INDEX[candidate]) {
      return {
        section: PATH_INDEX[candidate].section,
        item: `${PATH_INDEX[candidate].item} · ${humanise(parts[parts.length - 1])}`,
      };
    }
  }
  if (parts.length > 0) {
    return {
      section: humanise(parts[0]),
      item: parts.length > 1 ? humanise(parts.slice(1).join(' / ')) : humanise(parts[0]),
    };
  }
  return null;
}

interface JrxBreadcrumbsProps {
  className?: string;
}

export function JrxBreadcrumbs({ className }: JrxBreadcrumbsProps) {
  const [location] = useLocation();

  // Hook must run unconditionally (Rules of Hooks).
  const pathname = (location ?? '').split('?')[0];
  const crumb = useMemo(() => lookupCrumb(pathname), [pathname]);

  // Suppress only on landing/login. Every authenticated route — including
  // /dashboard — gets a breadcrumb so users always know where they are.
  if (!location || location === '/' || location === '/login') return null;
  if (!crumb) return null;

  // Brand: page-bg surface (#F9FAFB), text-secondary (#61697D),
  // border-default (#E4E7EC), text-primary navy (#152448), gold separator (#C7B15B).
  return (
    <nav
      aria-label="breadcrumb"
      className={cn(
        'flex items-center gap-1.5 px-4 py-1.5 text-xs font-[Inter,system-ui,sans-serif]',
        'border-b',
        className,
      )}
      style={{
        backgroundColor: '#F9FAFB',
        borderBottomColor: '#E4E7EC',
        color: '#61697D',
      }}
      data-testid="jrx-breadcrumbs"
    >
      <Home className="w-3 h-3" aria-hidden="true" style={{ color: '#61697D' }} />
      <span>{crumb.section}</span>
      <ChevronRight className="w-3 h-3" aria-hidden="true" style={{ color: '#C7B15B' }} />
      <span className="font-semibold" style={{ color: '#152448' }}>{crumb.item}</span>
    </nav>
  );
}

export default JrxBreadcrumbs;

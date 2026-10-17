/**
 * Platform v5 — Hub (B4 / task-179, 2026-05-12)
 *
 * Folds the nine /platform-v5/* sub-pages into a single tabbed hub at
 * /platform-v5?tab={orch|compliance|doc-ai|gov|internal|legal-pipeline|
 * multimodal|voice|workflows}. The original /platform-v5/<slug> routes
 * remain mounted in App.tsx so existing bookmarks keep working.
 *
 * No new backend wiring — each tab simply mounts the existing sub-page
 * component, so feature flags, RBAC, and audit panels are unchanged.
 */

import React, { lazy, Suspense, useMemo } from 'react';
import { useLocation } from 'wouter';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

const PV5Orch          = lazy(() => import('./orch'));
const PV5Compliance    = lazy(() => import('./compliance'));
const PV5DocAi         = lazy(() => import('./doc-ai'));
const PV5Gov           = lazy(() => import('./gov'));
const PV5Internal      = lazy(() => import('./internal'));
const PV5LegalPipeline = lazy(() => import('./legal-pipeline'));
const PV5Multimodal    = lazy(() => import('./multimodal'));
const PV5Voice         = lazy(() => import('./voice'));
const PV5Workflows     = lazy(() => import('./workflows'));

const TABS: Array<{ id: string; label: string; Component: React.LazyExoticComponent<React.ComponentType> }> = [
  { id: 'orch',           label: 'Orchestration',  Component: PV5Orch          },
  { id: 'compliance',     label: 'Compliance',     Component: PV5Compliance    },
  { id: 'doc-ai',         label: 'Doc-AI',         Component: PV5DocAi         },
  { id: 'gov',            label: 'Governance',     Component: PV5Gov           },
  { id: 'internal',       label: 'Internal Ops',   Component: PV5Internal      },
  { id: 'legal-pipeline', label: 'Legal Pipeline', Component: PV5LegalPipeline },
  { id: 'multimodal',     label: 'Multimodal',     Component: PV5Multimodal    },
  { id: 'voice',          label: 'Voice',          Component: PV5Voice         },
  { id: 'workflows',      label: 'Workflows',      Component: PV5Workflows     },
];

export default function PlatformV5Hub() {
  const [, navigate] = useLocation();

  const activeId = useMemo(() => {
    if (typeof window === 'undefined') return TABS[0].id;
    const tab = new URLSearchParams(window.location.search).get('tab');
    return TABS.find(t => t.id === tab)?.id ?? TABS[0].id;
  }, [typeof window !== 'undefined' ? window.location.search : '']);

  const Active = TABS.find(t => t.id === activeId)!.Component;

  return (
    <div className="flex flex-col min-h-full">
      <div className="border-b bg-white sticky top-0 z-10">
        <div className="px-4 pt-3">
          <h1 className="text-lg font-bold text-[#152448]">Platform v5 (internal)</h1>
          <p className="text-xs text-slate-700 mb-2">
            Super-admin surface for the nine /api/nv5/* admin namespaces. Most tabs
            stub out unless their JRX_F_* feature flags are enabled.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 px-4 pb-2 border-t border-slate-100 pt-2">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => navigate(`/platform-v5?tab=${t.id}`)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded transition-colors',
                t.id === activeId
                  ? 'bg-[#152448] text-white'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
              data-testid={`platform-v5-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1">
        <Suspense fallback={<LoadingSpinner />}>
          <Active />
        </Suspense>
      </div>
    </div>
  );
}

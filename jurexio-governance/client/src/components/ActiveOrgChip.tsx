/**
 * ActiveOrgChip — Topbar chip showing the currently active organisation
 * with a dropdown to switch between orgs the operator has access to.
 *
 * SDK v5.0.0 polish-sprint D3 (gap F1).
 */
import React, { useState, useRef, useEffect } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useOrg } from '@/contexts/OrgContext';
import { cn } from '@/lib/utils';

export function ActiveOrgChip({ className }: { className?: string }) {
  const { organizations, activeOrg, activeOrgId, setActiveOrgId, isLoading } = useOrg();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isLoading) {
    return (
      <div className={cn('hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-500', className)}>
        <Building2 className="w-3.5 h-3.5" />
        <span>Loading orgs…</span>
      </div>
    );
  }

  if (organizations.length === 0) {
    return null;
  }

  const single = organizations.length === 1;

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => !single && setOpen(o => !o)}
        disabled={single}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors',
          'bg-slate-900 border border-slate-800',
          single
            ? 'text-slate-400 cursor-default'
            : 'text-slate-300 hover:text-white hover:border-slate-700 cursor-pointer',
        )}
        aria-label={single ? `Active organisation: ${activeOrg?.name ?? 'unknown'}` : 'Switch active organisation'}
        aria-haspopup={single ? undefined : 'listbox'}
        aria-expanded={single ? undefined : open}
      >
        <Building2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C7B15B' }} />
        <span className="font-medium truncate max-w-[180px]">
          {activeOrg?.name ?? 'Select org'}
        </span>
        {!single && <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" />}
      </button>

      {!single && open && (
        <div
          role="listbox"
          aria-label="Organisations"
          className="absolute right-0 top-10 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden max-h-96 overflow-y-auto"
        >
          <div className="px-3 py-2 border-b border-slate-700/60 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
            Switch Organisation ({organizations.length})
          </div>
          <div className="py-1">
            {organizations.map(org => {
              const isActive = String(org.id) === String(activeOrgId);
              return (
                <button
                  key={org.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setActiveOrgId(org.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors',
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                  )}
                >
                  <Building2 className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{org.name}</div>
                    {org.plan && (
                      <div className="text-[10px] text-slate-500 truncate uppercase">
                        {org.plan} plan
                      </div>
                    )}
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C7B15B' }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ActiveOrgChip;

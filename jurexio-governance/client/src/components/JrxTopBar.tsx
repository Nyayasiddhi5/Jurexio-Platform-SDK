/**
 * JrxTopBar — Jurexio Enterprise Global Top Bar
 * Jurexio branded header with logo, global search, notifications, and user menu.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { ActiveOrgChip } from './ActiveOrgChip';
import {
  Search, Bell, ChevronDown, LogOut, User, Settings,
  Shield, Key, Building2, X, Command, Zap, Scale,
  FileText, Bot, BarChart3, Home,
} from 'lucide-react';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  type: 'page' | 'agent' | 'case' | 'api';
  label: string;
  path: string;
  icon: React.ElementType;
  description?: string;
}

// ─── Static search index (augmented with live results) ────────────────────────

const SEARCH_INDEX: SearchResult[] = [
  { type: 'page', label: 'Intelligence Dashboard',      path: '/intelligence/dashboard',  icon: BarChart3, description: 'E1 · Firm morning briefing' },
  { type: 'page', label: 'Organisation Management',     path: '/superadmin/organisations',icon: Building2, description: 'Super Admin · All orgs' },
  { type: 'page', label: 'Platform Registry',           path: '/superadmin/platforms',    icon: Scale, description: 'Super Admin · Platform AI config' },
  { type: 'page', label: 'Agent Matrix',                path: '/superadmin/agents',       icon: Bot, description: 'ROMA L5 agents × 6 jurisdictions' },
  { type: 'page', label: 'LLM Budget Control',          path: '/superadmin/llm-budget',   icon: BarChart3, description: 'Super Admin · LLM cost caps' },
  { type: 'page', label: 'ISO 42001 Compliance',        path: '/superadmin/compliance',   icon: Shield, description: 'AI governance posture' },
  { type: 'page', label: 'SDK API Tester',              path: '/sdk-hub?tab=tester',      icon: Zap, description: 'Postman-style API testing' },
  { type: 'page', label: 'SDK Onboarding',              path: '/sdk-hub?tab=onboarding',  icon: Zap, description: 'Platform onboarding wizard' },
  { type: 'page', label: 'SDK Key Management',          path: '/sdk-hub?tab=keys',        icon: Key, description: 'Generate, rotate, revoke keys' },
  { type: 'page', label: 'Operations Hub',              path: '/operations?tab=overview', icon: BarChart3, description: 'Live ops overview + token metrics' },
  { type: 'page', label: 'RBAC Console',                path: '/rbac-console',            icon: Shield, description: 'Role-based access control' },
  { type: 'page', label: 'Hash Chain Audit',            path: '/audit-chain',             icon: Shield, description: 'Tamper-proof audit log' },
  { type: 'page', label: 'User Profile & 2FA',          path: '/user/profile',            icon: User, description: 'Security settings, sessions' },
  { type: 'page', label: 'Org Admin Dashboard',         path: '/org-admin',               icon: Building2, description: 'Organisation overview' },
  { type: 'page', label: 'NyayaMitra Chat',             path: '/jurexio-citizen',              icon: Bot, description: 'Citizen legal access — 47 languages' },
  { type: 'api',  label: `POST ${NV_BASE}completions`,    path: '/sdk-hub?tab=tester',      icon: Zap, description: 'Core LLM completion endpoint' },
  { type: 'api',  label: `GET ${NV_BASE}agents`,          path: '/sdk-hub?tab=tester',      icon: Bot, description: 'List all ROMA L5 agents' },
  { type: 'api',  label: `POST ${NV_BASE}sdk/provision`,  path: '/sdk-hub?tab=tester',      icon: Key, description: 'SDK platform provisioning' },
];

const ROLE_DISPLAY: Record<string, { label: string; color: string }> = {
  super_admin:      { label: 'Super Admin',       color: 'bg-red-500/20 text-red-300 border border-red-500/30' },
  enterprise_admin: { label: 'Enterprise Admin',  color: 'bg-purple-500/20 text-purple-300 border border-purple-500/30' },
  org_admin:        { label: 'Org Admin',         color: 'bg-amber-500/20 text-amber-300 border border-amber-500/30' },
  manager:          { label: 'Manager',           color: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  senior_analyst:   { label: 'Sr. Analyst',       color: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' },
  analyst:          { label: 'Analyst',           color: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' },
  developer:        { label: 'Developer',         color: 'bg-green-500/20 text-green-300 border border-green-500/30' },
  operator:         { label: 'Operator',          color: 'bg-slate-500/20 text-slate-300 border border-slate-500/30' },
  user:             { label: 'User',              color: 'bg-slate-500/20 text-slate-300 border border-slate-500/30' },
};

// ─── SearchPalette ────────────────────────────────────────────────────────────

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = query.trim().length < 1
    ? SEARCH_INDEX.slice(0, 8)
    : SEARCH_INDEX.filter(r =>
        r.label.toLowerCase().includes(query.toLowerCase()) ||
        (r.description ?? '').toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10);

  const handleSelect = useCallback((path: string) => {
    navigate(path);
    onClose();
  }, [navigate, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const typeColors: Record<string, string> = {
    page:  'bg-blue-500/20 text-blue-300',
    agent: 'bg-purple-500/20 text-purple-300',
    case:  'bg-amber-500/20 text-amber-300',
    api:   'bg-green-500/20 text-green-300',
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Global search"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/60">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, agents, APIs, cases…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
            aria-label="Search"
          />
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded" aria-label="Close search">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="py-1 max-h-96 overflow-y-auto" role="listbox">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-500 text-sm">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((r, i) => {
              const Icon = r.icon;
              return (
                <button
                  key={i}
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSelect(r.path)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 transition-colors text-left group"
                >
                  <div className="w-7 h-7 rounded-md bg-slate-800 group-hover:bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">{r.label}</div>
                    {r.description && <div className="text-xs text-slate-500 truncate">{r.description}</div>}
                  </div>
                  <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0', typeColors[r.type] ?? 'bg-slate-700 text-slate-400')}>
                    {r.type}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-700/60 flex items-center gap-4 text-[10px] text-slate-600">
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 px-1 rounded">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 px-1 rounded">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="bg-slate-800 px-1 rounded">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// ─── NotificationsBell ────────────────────────────────────────────────────────

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = 3;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const notifications = [
    { id: 1, type: 'HIGH',   title: 'High-risk case detected',          body: 'Matter #2024-CR-1891 requires immediate review', time: '5m ago' },
    { id: 2, type: 'MEDIUM', title: 'LLM budget at 78%',                body: 'Monthly token cap approaching for NyayaMitra platform', time: '12m ago' },
    { id: 3, type: 'LOW',    title: 'SDK key rotation reminder',         body: 'nyv_live_sk_… expires in 7 days', time: '1h ago' },
  ];

  const typeStyle: Record<string, string> = {
    HIGH:   'bg-red-500/20 text-red-300 border-red-500/30',
    MEDIUM: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    LOW:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
        aria-label={`${count} notifications`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#C7B15B] rounded-full" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden" role="menu">
          <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <span className="text-xs text-slate-500">{count} unread</span>
          </div>
          <div className="divide-y divide-slate-800">
            {notifications.map(n => (
              <div key={n.id} className="px-4 py-3 hover:bg-slate-800/50 cursor-pointer transition-colors">
                <div className="flex items-start gap-2.5">
                  <span className={cn('mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0', typeStyle[n.type])}>{n.type}</span>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{n.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</div>
                    <div className="text-[10px] text-slate-600 mt-1">{n.time}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-slate-700/60">
            <button className="text-xs text-[#C7B15B] hover:text-[#E4B027] transition-colors">View all notifications →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────

function UserMenu() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const u = user as { name?: string; email?: string; role?: string; avatar?: string } | null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const roleInfo = ROLE_DISPLAY[u?.role ?? 'user'] ?? ROLE_DISPLAY['user'];
  const initials = (u?.name ?? u?.email ?? 'U').substring(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors group"
        aria-label="User menu"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#152448] to-[#1a4a9a] flex items-center justify-center text-xs font-bold text-[#C7B15B] flex-shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block text-left min-w-0">
          <div className="text-xs font-medium text-white truncate max-w-24">{u?.name ?? u?.email ?? 'User'}</div>
          <div className="text-[10px] text-slate-500 truncate">{u?.email ?? ''}</div>
        </div>
        <ChevronDown className="w-3 h-3 text-slate-500 group-hover:text-slate-300 transition-colors flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden" role="menu">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-700/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#152448] to-[#1a4a9a] flex items-center justify-center text-sm font-bold text-[#C7B15B]">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{u?.name ?? u?.email}</div>
                <div className="text-xs text-slate-500 truncate">{u?.email}</div>
              </div>
            </div>
            <div className="mt-2.5">
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', roleInfo.color)}>
                {roleInfo.label}
              </span>
            </div>
          </div>
          {/* Menu items */}
          <div className="py-1">
            {[
              { icon: User,     label: 'Profile & Security', path: '/user/profile' },
              { icon: Settings, label: 'Preferences',        path: '/user/preferences' },
              { icon: Key,      label: 'API Keys',           path: '/sdk-hub?tab=keys' },
              { icon: Shield,   label: 'Two-Factor Auth',    path: '/user/profile' },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.path + item.label}
                  role="menuitem"
                  onClick={() => { navigate(item.path); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-left"
                >
                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="border-t border-slate-700/60 py-1">
            <button
              role="menuitem"
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── JrxTopBar ────────────────────────────────────────────────────────────────

export interface JrxTopBarProps {
  className?: string;
}

export function JrxTopBar({ className }: JrxTopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <header
        className={cn(
          'h-12 flex-shrink-0 flex items-center px-4 gap-3',
          'bg-slate-950 border-b border-slate-800/60',
          'sticky top-0 z-40',
          className,
        )}
        role="banner"
        aria-label="Jurexio top navigation"
      >
        {/* Logo — clickable, returns to dashboard home */}
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2.5 flex-shrink-0 hover:opacity-80 transition-opacity rounded outline-none focus-visible:ring-2 focus-visible:ring-[#C7B15B]"
          aria-label="Back to dashboard home"
          data-testid="topbar-home-logo"
        >
          <img
            src="/nyayasiddhi-logo.png"
            alt="Jurexio"
            className="h-6 w-auto object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="hidden lg:flex flex-col text-left">
            <span className="text-[11px] font-bold tracking-widest text-white leading-tight">NYAYAVIGYA</span>
            <span className="text-[8px] text-slate-500 tracking-wider leading-tight">ENTERPRISE SDK {__NV_VERSION__}</span>
          </div>
        </button>

        {/* Home button — explicit, redundant nav */}
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition-colors flex-shrink-0"
          aria-label="Home"
          title="Home (Dashboard)"
          data-testid="topbar-home-button"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* Separator */}
        <div className="hidden lg:block w-px h-5 bg-slate-800/80 flex-shrink-0" aria-hidden="true" />

        {/* Global Search */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex-1 max-w-md flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 text-xs hover:border-slate-700 hover:text-slate-400 transition-colors group"
          aria-label="Open global search (⌘K)"
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left hidden sm:block">Search pages, agents, APIs…</span>
          <span className="hidden sm:flex items-center gap-0.5 flex-shrink-0">
            <kbd className="bg-slate-800 text-slate-500 text-[9px] px-1 py-0.5 rounded font-mono">⌘</kbd>
            <kbd className="bg-slate-800 text-slate-500 text-[9px] px-1 py-0.5 rounded font-mono">K</kbd>
          </span>
        </button>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {/* Status pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            <span className="text-[10px] font-medium text-emerald-400">All systems operational</span>
          </div>

          <ActiveOrgChip />
          <NotificationsBell />
          <UserMenu />
        </div>
      </header>

      {/* Search Palette Overlay */}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </>
  );
}

export default JrxTopBar;

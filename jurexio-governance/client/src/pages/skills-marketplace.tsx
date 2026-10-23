import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { p } from '@/lib/jrx-api-paths';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

/** SkillShop™ — Legal Skills Marketplace (live catalogue from /api/jrx/skillshop). */
import {
  ShoppingBag, Search, Star, Download, Plus, Shield, FileText,
  BookOpen, Scale, Globe, Zap, Users, BarChart3, CheckCircle,
  Clock, ArrowRight, Filter, Heart, Share2, ExternalLink,
  Tag, Package, TrendingUp, Award, Loader2, Bot
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxPageShell } from '@/components/JrxPageShell';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type SkillCategory = 'Research' | 'Drafting' | 'Compliance' | 'Litigation' | 'Corporate' | 'Voice' | 'Analytics' | 'Jurisdiction' | 'Integration';
type SkillTier = 'free' | 'pro' | 'enterprise';

interface Skill {
  skillId: string;
  name: string;
  tagline: string;
  description: string;
  category: SkillCategory;
  version: string;
  tier: SkillTier;
  price?: number;
  publisher: { name: string; verified: boolean; badge?: string };
  rating: number;
  reviewCount: number;
  installCount: number;
  tags: string[];
  compatiblePatterns: string[];
  jurisdictions: string[];
  isInstalled?: boolean;
  isFeatured?: boolean;
  isNew?: boolean;
  lastUpdated: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

function mapSkillRow(raw: Record<string, unknown>): Skill {
  return {
    skillId: String(raw.skillId ?? raw.id ?? ''),
    name: String(raw.name ?? 'Skill'),
    tagline: String(raw.tagline ?? ''),
    description: String(raw.description ?? ''),
    category: (raw.category ?? 'Research') as SkillCategory,
    version: String(raw.version ?? '1.0.0'),
    tier: (raw.tier ?? 'free') as SkillTier,
    price: raw.price != null ? Number(raw.price) : undefined,
    publisher: {
      name: String((raw.publisher as { name?: string })?.name ?? 'Publisher'),
      verified: Boolean((raw.publisher as { verified?: boolean })?.verified),
      badge: (raw.publisher as { badge?: string })?.badge,
    },
    rating: Number(raw.rating ?? 0),
    reviewCount: Number(raw.reviewCount ?? 0),
    installCount: Number(raw.installCount ?? 0),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    compatiblePatterns: Array.isArray(raw.compatiblePatterns) ? raw.compatiblePatterns.map(String) : [],
    jurisdictions: Array.isArray(raw.jurisdictions) ? raw.jurisdictions.map(String) : [],
    isInstalled: Boolean(raw.isInstalled),
    isFeatured: Boolean(raw.isFeatured),
    isNew: Boolean(raw.isNew),
    lastUpdated: String(raw.lastUpdated ?? ''),
  };
}

async function fetchSkillCatalogue(): Promise<Skill[]> {
  const base = p('SKILLSHOP');
  const res = await apiRequest(`${base}/skills?limit=100`);
  const rows = (res as { skills?: unknown[] }).skills ?? [];
  return rows.map(r => mapSkillRow(r as Record<string, unknown>));
}

async function fetchInstalledSkillIds(): Promise<Set<string>> {
  const base = p('SKILLSHOP');
  const res = await apiRequest(`${base}/installed`);
  const rows = (res as { installed?: { skillId?: string }[] }).installed ?? [];
  return new Set(rows.map(i => String(i.skillId ?? '')).filter(Boolean));
}

const CATEGORY_ICONS: Record<SkillCategory, React.ReactNode> = {
  Research:     <BookOpen className="h-4 w-4" />,
  Drafting:     <FileText className="h-4 w-4" />,
  Compliance:   <Shield className="h-4 w-4" />,
  Litigation:   <Scale className="h-4 w-4" />,
  Corporate:    <Users className="h-4 w-4" />,
  Voice:        <Bot className="h-4 w-4" />,
  Analytics:    <BarChart3 className="h-4 w-4" />,
  Jurisdiction: <Globe className="h-4 w-4" />,
  Integration:  <Zap className="h-4 w-4" />,
};

const TIER_COLORS: Record<SkillTier, string> = {
  free:       'bg-green-50 text-green-700 border-green-200',
  pro:        'bg-blue-50 text-blue-700 border-blue-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
};

function renderStars(rating: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <Star key={i} className={`h-3 w-3 ${i < Math.floor(rating) ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'}`} />
  ));
}

export default function SkillsMarketplace() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<SkillCategory | 'All'>('All');
  const [tier, setTier] = useState<SkillTier | 'All'>('All');
  const [activeTab, setActiveTab] = useState('browse');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const { data: catalogue = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['skillshop-catalogue'],
    queryFn: fetchSkillCatalogue,
    staleTime: 60_000,
  });

  const { data: installedIds = new Set<string>() } = useQuery({
    queryKey: ['skillshop-installed'],
    queryFn: fetchInstalledSkillIds,
    staleTime: 30_000,
  });

  const skills = useMemo(
    () => catalogue.map(s => ({ ...s, isInstalled: installedIds.has(s.skillId) || s.isInstalled })),
    [catalogue, installedIds],
  );

  const filteredSkills = useMemo(() => {
    return skills.filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.tagline.toLowerCase().includes(search.toLowerCase()) && !s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))) return false;
      if (category !== 'All' && s.category !== category) return false;
      if (tier !== 'All' && s.tier !== tier) return false;
      return true;
    });
  }, [skills, search, category, tier]);

  const featured = skills.filter((s) => s.isFeatured);
  const installed = skills.filter((s) => installedIds.has(s.skillId) || s.isInstalled);

  const installSkill = async (skill: Skill) => {
    setInstallingId(skill.skillId);
    try {
      await apiRequest(`${p('SKILLSHOP')}/skills/${skill.skillId}/install`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['skillshop-installed'] });
      toast({ title: `${skill.name} installed`, description: `Version ${skill.version} is now active on your account.` });
    } catch (err: unknown) {
      toast({
        title: 'Install failed',
        description: err instanceof Error ? err.message : 'Could not install skill',
        variant: 'destructive',
      });
    } finally {
      setInstallingId(null);
    }
  };

  if (isLoading) {
    return (
      <JrxPageShell testId="page-skills-marketplace" title="SkillShop™">
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mr-2" /> Loading SkillShop catalogue…
        </div>
      </JrxPageShell>
    );
  }

  if (isError || !skills.length) {
    return (
      <JrxPageShell testId="page-skills-marketplace" title="SkillShop™">
        <JrxEmptyState
          title="SkillShop catalogue unavailable"
          description="Sign in and ensure /api/jrx/skillshop/skills is reachable."
        />
        <Button className="mt-4" variant="outline" onClick={() => refetch()}>Retry</Button>
      </JrxPageShell>
    );
  }

  const renderSkillCard = (skill: Skill, compact = false) => (
    <Card key={skill.skillId}
      className={`bg-card border-border hover:border-border/80 hover:shadow-sm transition-all cursor-pointer ${compact ? 'h-full' : ''}`}
      onClick={() => setSelectedSkill(skill)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
              {CATEGORY_ICONS[skill.category]}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-semibold leading-tight text-foreground">{skill.name}</p>
                {skill.isNew && <Badge className="text-xs bg-green-50 text-green-700 border-green-200 border h-4 px-1.5">New</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{skill.publisher.name}
                {skill.publisher.verified && <CheckCircle className="h-2.5 w-2.5 text-blue-600 inline ml-1" />}
              </p>
            </div>
          </div>
          <Badge className={`text-xs border ${TIER_COLORS[skill.tier]} shrink-0`}>
            {skill.tier === 'free' ? 'Free' : `₹${skill.price}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{skill.tagline}</p>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {skill.tags.slice(0, 3).map((t) => (
            <Badge key={t} variant="outline" className="text-xs border-border text-muted-foreground h-5 px-1.5" role="status">{t}</Badge>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {renderStars(skill.rating)}
            <span className="text-xs text-muted-foreground ml-1">{skill.rating} ({skill.reviewCount})</span>
          </div>
          {installedIds.has(skill.skillId) || skill.isInstalled ? (
            <Badge className="bg-green-50 text-green-700 border-green-200 border text-xs">
              <CheckCircle className="h-3 w-3 mr-1" />Installed
            </Badge>
          ) : (
            <Button size="sm" className="h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); installSkill(skill); }}
              disabled={installingId === skill.skillId}>
              {installingId === skill.skillId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
              Install
            </Button>
          )}
        </div>
        <div className="text-xs text-muted-foreground/70 mt-2 flex items-center gap-1">
          <Download className="h-3 w-3" />{skill.installCount.toLocaleString()} installs
          <span className="mx-1">·</span>
          {skill.jurisdictions.join(', ')}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <JrxPageShell
      testId="page-skills-marketplace"
      title="SkillShop™"
      description="Legal AI Skills Marketplace — Jurexio Enterprise Platform 312"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs" role="status">{skills.length} Skills</Badge>
          <Badge variant="outline" className="border-green-300 text-green-700 text-xs" role="status">{installed.length} Installed</Badge>
        </div>
      }
    >
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-4">
            <TabsList className="bg-muted border border-border p-1 h-9 gap-1" aria-label="Navigation tabs">
              {[
                { id: 'browse', label: 'Browse', icon: <Search className="h-3.5 w-3.5" /> },
                { id: 'installed', label: `Installed (${installed.length})`, icon: <CheckCircle className="h-3.5 w-3.5" /> },
                { id: 'featured', label: 'Featured', icon: <Award className="h-3.5 w-3.5" /> },
              ].map((t) => (
                <TabsTrigger key={t.id} value={t.id}
                  className="text-xs data-[state=active]:bg-background data-[state=active]:text-foreground text-muted-foreground flex items-center gap-1.5 px-3">
                  {t.icon}{t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* BROWSE */}
          <TabsContent value="browse" className="mt-0">
            {/* Filters */}
            <div className="flex items-center gap-3 mb-6">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search skills by name, tag, or keyword..."
                  className="pl-9" />
              </div>
              <Select value={category} onValueChange={(v) => setCategory(v as any)}>
                <SelectTrigger className="w-40 text-xs">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-xs">All Categories</SelectItem>
                  {(['Research', 'Drafting', 'Compliance', 'Litigation', 'Corporate', 'Voice', 'Analytics', 'Jurisdiction', 'Integration'] as SkillCategory[]).map((c) => (
                    <SelectItem key={c} value={c} className="text-xs flex items-center gap-2">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={tier} onValueChange={(v) => setTier(v as any)}>
                <SelectTrigger className="w-32 text-xs">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All" className="text-xs">All Tiers</SelectItem>
                  <SelectItem value="free" className="text-xs text-green-700">Free</SelectItem>
                  <SelectItem value="pro" className="text-xs text-blue-700">Pro</SelectItem>
                  <SelectItem value="enterprise" className="text-xs text-purple-700">Enterprise</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground shrink-0">{filteredSkills.length} results</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {filteredSkills.map((skill) => renderSkillCard(skill))}
              {filteredSkills.length === 0 && (
                <div className="col-span-3 py-16 text-center text-muted-foreground">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No skills match your search</p>
                </div>
              )}
            </div>
          </TabsContent>

          {/* INSTALLED */}
          <TabsContent value="installed" className="mt-0">
            {installed.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No skills installed yet — browse the marketplace</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {installed.map((skill) => renderSkillCard(skill))}
              </div>
            )}
          </TabsContent>

          {/* FEATURED */}
          <TabsContent value="featured" className="mt-0">
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Award className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-semibold text-amber-800">Editor's Picks — Platform 312 Launch</p>
              </div>
              <p className="text-xs text-muted-foreground">Hand-selected skills for the Jurexio September 2026 launch. Optimised for Indian, UK, and GCC legal practice.</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {featured.map((skill) => renderSkillCard(skill))}
            </div>
          </TabsContent>
        </Tabs>

      {/* Skill Detail Modal */}
      {selectedSkill && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setSelectedSkill(null)}>
          <Card className="bg-card border-border w-full max-w-xl max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {CATEGORY_ICONS[selectedSkill.category]}
                    <CardTitle className="text-foreground text-base">{selectedSkill.name}</CardTitle>
                    {selectedSkill.isFeatured && <Badge className="bg-amber-50 text-amber-700 border-amber-200 border text-xs">Featured</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedSkill.tagline}</p>
                </div>
                <Badge className={`text-xs border ${TIER_COLORS[selectedSkill.tier]} shrink-0`}>
                  {selectedSkill.tier === 'free' ? 'Free' : `₹${selectedSkill.price}/mo`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-foreground/80">{selectedSkill.description}</p>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Publisher</p>
                  <p className="font-medium text-foreground">{selectedSkill.publisher.name}
                    {selectedSkill.publisher.verified && <CheckCircle className="h-3 w-3 text-blue-600 inline ml-1" />}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Version</p>
                  <p className="font-mono text-foreground">{selectedSkill.version}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Compatible Patterns</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedSkill.compatiblePatterns.map((p) => (
                      <Badge key={p} variant="outline" className="text-xs border-purple-200 text-purple-700" role="status">{p}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Jurisdictions</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedSkill.jurisdictions.map((j) => (
                      <Badge key={j} variant="outline" className="text-xs border-blue-200 text-blue-700" role="status">{j}</Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSkill.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs border-border text-muted-foreground" role="status">{t}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                {installedIds.has(selectedSkill.skillId) || selectedSkill.isInstalled ? (
                  <Button disabled className="flex-1">
                    <CheckCircle className="h-4 w-4 mr-2" />Installed
                  </Button>
                ) : (
                  <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                    disabled={installingId === selectedSkill.skillId}
                    onClick={() => installSkill(selectedSkill)}>
                    {installingId === selectedSkill.skillId
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Installing...</>
                      : <><Download className="h-4 w-4 mr-2" />Install {selectedSkill.tier === 'free' ? 'Free' : `₹${selectedSkill.price}/mo`}</>}
                  </Button>
                )}
                <Button variant="outline"
                  onClick={() => setSelectedSkill(null)}>Close</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </JrxPageShell>
  );
}

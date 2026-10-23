import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Zap, Plus, Star, Globe, Search, RefreshCw, CheckCircle, BookOpen, Settings } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
const SKILL_CATEGORIES = ['research', 'drafting', 'compliance', 'litigation', 'advisory', 'analysis', 'translation'];
const JURISDICTIONS = ['IN', 'UK', 'GC', 'EU', 'US', 'SG'];

export default function SkillsLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [jurisdiction, setJurisdiction] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', category: 'research', jurisdiction: 'IN', systemPrompt: '', triggerWords: '' });
  const [activateCtx, setActivateCtx] = useState('');

  const { data: skills, isLoading, refetch } = useQuery({
    queryKey: [nv('skills'), search, category, jurisdiction],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category && category !== 'all') params.set('category', category);
      if (jurisdiction && jurisdiction !== 'all') params.set('jurisdiction', jurisdiction);
      return apiRequest('GET', `${NV_BASE}skills?${params}`);
    },
    refetchInterval: 60000,
  });

  const { data: health } = useQuery({
    queryKey: [nv('skills/health')],
    queryFn: () => apiRequest('GET', nv('skills/health')),
  });

  const createSkill = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('skills'), data),
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ name: '', description: '', category: 'research', jurisdiction: 'IN', systemPrompt: '', triggerWords: '' });
      qc.invalidateQueries({ queryKey: [nv('skills')] });
      toast({ title: 'Skill registered successfully' });
    },
    onError: () => toast({ title: 'Failed to register skill', variant: 'destructive' }),
  });

  const activateSkills = useMutation({
    mutationFn: (data: any) => apiRequest('POST', nv('skills/activate'), data),
    onSuccess: (data) => {
      setActivateOpen(false);
      toast({ title: `${data?.data?.activated?.length || 0} skills activated for context` });
    },
  });

  const handleCreate = () => {
    if (!form.name.trim() || !form.description.trim()) {
      toast({ title: 'Name and description are required', variant: 'destructive' }); return;
    }
    createSkill.mutate({
      ...form,
      triggerWords: form.triggerWords.split(',').map(t => t.trim()).filter(Boolean),
    });
  };

  const skillsArr = skills?.data?.skills || [];
  const coreSkills = skillsArr.filter((s: any) => s.isCore);
  const customSkills = skillsArr.filter((s: any) => !s.isCore);

  const getQualityBadge = (score: number) => {
    if (score >= 0.85) return 'bg-green-100 text-green-700';
    if (score >= 0.7) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Skills Library
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {health?.data?.coreSkills || 6} core skills + custom skill registry — composable, versioned, jurisdiction-aware
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={activateOpen} onOpenChange={setActivateOpen}>
            <DialogTrigger asChild aria-label="Open dialog">
              <Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-2" />Auto-Activate</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Auto-Activate Skills for Context</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div><Label>Task Context / Query</Label>
                  <Textarea value={activateCtx} onChange={e => setActivateCtx(e.target.value)}
                    placeholder="Describe the task — e.g., 'Draft a GDPR-compliant data processing agreement'" rows={4} className="mt-1" /></div>
                <Button onClick={() => activateSkills.mutate({ context: activateCtx, jurisdiction })} className="w-full" disabled={activateSkills.isPending}>
                  {activateSkills.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                  Activate Best Skills
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild aria-label="Open dialog">
              <Button size="sm"><Plus className="h-4 w-4 mr-2" />Register Skill</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Register Custom Skill</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <div><Label>Skill Name *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g., UAE Labour Law Specialist" className="mt-1" /></div>
                <div><Label>Description *</Label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={2} className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Category</Label>
                    <Select value={form.category} onValueChange={v => setForm(f => ({...f, category: v}))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SKILL_CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div><Label>Jurisdiction</Label>
                    <Select value={form.jurisdiction} onValueChange={v => setForm(f => ({...f, jurisdiction: v}))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{JURISDICTIONS.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div><Label>System Prompt</Label>
                  <Textarea value={form.systemPrompt} onChange={e => setForm(f => ({...f, systemPrompt: e.target.value}))} rows={3} placeholder="Skill-specific system prompt..." className="mt-1" /></div>
                <div><Label>Trigger Words (comma-separated)</Label>
                  <Input value={form.triggerWords} onChange={e => setForm(f => ({...f, triggerWords: e.target.value}))} placeholder="labour, employment, termination, UAE" className="mt-1" /></div>
                <Button onClick={handleCreate} className="w-full" disabled={createSkill.isPending}>
                  {createSkill.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  Register Skill
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search skills..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={category} onValueChange={setCategory} aria-label="Select option">
          <SelectTrigger className="w-36"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {SKILL_CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={jurisdiction} onValueChange={setJurisdiction} aria-label="Select option">
          <SelectTrigger className="w-28"><SelectValue placeholder="All regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {JURISDICTIONS.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <Tabs defaultValue="core">
        <TabsList aria-label="Navigation tabs">
          <TabsTrigger value="core" aria-label="core tab">
            <Star className="h-4 w-4 mr-1" />Core Skills ({coreSkills.length || 6})
          </TabsTrigger>
          <TabsTrigger value="custom" aria-label="custom tab">
            <BookOpen className="h-4 w-4 mr-1" />Custom ({customSkills.length})
          </TabsTrigger>
          <TabsTrigger value="all" aria-label="all tab">All ({skillsArr.length})</TabsTrigger>
        </TabsList>

        {['core', 'custom', 'all'].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {isLoading ? (
                <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="loading-skills">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
                </div>
              ) : (tab === 'core' ? coreSkills : tab === 'custom' ? customSkills : skillsArr).length === 0 ? (
                <div className="col-span-2">
                  <JrxEmptyState
                    icon={Zap}
                    title={tab === 'custom' ? 'No custom skills yet' : 'No skills found'}
                    description={tab === 'custom' ? 'Register your first skill above to get started.' : 'Try a different filter or register a custom skill.'}
                  />
                </div>
              ) : (
                (tab === 'core' ? coreSkills : tab === 'custom' ? customSkills : skillsArr).map((skill: any) => (
                  <Card key={skill.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm">{skill.name}</h3>
                            {skill.isCore && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs capitalize" role="status">{skill.category}</Badge>
                            {skill.jurisdiction && <Badge variant="outline" className="text-xs" role="status">{skill.jurisdiction}</Badge>}
                            <span className="text-xs text-muted-foreground">v{skill.version || '1.0'}</span>
                          </div>
                        </div>
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                      </div>
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{skill.description}</p>
                      {skill.performance && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>Quality Score</span>
                            <span className={`font-bold ${getQualityBadge(skill.performance.avgQualityScore || 0).split(' ')[1]}`}>
                              {Math.round((skill.performance.avgQualityScore || 0) * 100)}%
                            </span>
                          </div>
                          <Progress value={Math.round((skill.performance.avgQualityScore || 0) * 100)} className="h-1.5"  role="progressbar" aria-label="Progress"/>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{skill.performance.totalInvocations || 0} invocations</span>
                            <span>{skill.performance.successRate || '100'}% success</span>
                          </div>
                        </div>
                      )}
                      {skill.triggerWords && skill.triggerWords.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {skill.triggerWords.slice(0, 4).map((w: string) => (
                            <span key={w} className="text-xs bg-muted px-1.5 py-0.5 rounded">{w}</span>
                          ))}
                          {skill.triggerWords.length > 4 && <span className="text-xs text-muted-foreground">+{skill.triggerWords.length - 4}</span>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

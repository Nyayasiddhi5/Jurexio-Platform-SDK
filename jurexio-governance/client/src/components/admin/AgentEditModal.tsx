import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { X } from 'lucide-react';

import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE } from '@/lib/jrx-api-paths';
interface Agent {
  id: string;
  agentId: string;
  name: string;
  description: string;
  tier: 'L1' | 'L2' | 'L3' | 'L4';
  category: string;
  specialization: string;
  capabilities: string[];
  status: 'active' | 'inactive' | 'maintenance' | 'deprecated';
  isAvailable: boolean;
  version: string;
  skillsets: string[];
  policies: Record<string, any>;
  performanceMetrics: Record<string, any>;
}

interface AgentEditModalProps {
  agentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  mode: 'edit' | 'create';
}

const AGENT_TIERS = [
  { value: 'L1', label: 'L1 - Basic' },
  { value: 'L2', label: 'L2 - Intermediate' },
  { value: 'L3', label: 'L3 - Advanced' },
  { value: 'L4', label: 'L4 - Expert' }
];

const AGENT_CATEGORIES = [
  'development', 'content', 'analysis', 'automation', 'integration', 
  'monitoring', 'security', 'optimization', 'communication', 'creative'
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'deprecated', label: 'Deprecated' }
];

export default function AgentEditModal({ agentId, isOpen, onClose, mode }: AgentEditModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tier: 'L1' as const,
    category: '',
    specialization: '',
    capabilities: [] as string[],
    status: 'active' as const,
    version: '1.0.0',
    skillsets: [] as string[],
    policies: {} as Record<string, any>
  });
  const [newCapability, setNewCapability] = useState('');
  const [newSkillset, setNewSkillset] = useState('');

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch agent data for edit mode
  const { data: agentData } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      if (!agentId) return null;
      const token = getAuthToken();
      const response = await fetch(`${NV_BASE}agents/${encodeURIComponent(agentId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Failed to fetch agent (HTTP ${response.status})`);
      const json = await response.json();
      // Normalise to { agent } regardless of envelope shape
      return { agent: json?.data?.agent ?? json?.agent ?? json?.data ?? json };
    },
    enabled: mode === 'edit' && !!agentId,
  });

  useEffect(() => {
    if (mode === 'edit' && agentData?.agent) {
      const agent = agentData.agent;
      setFormData({
        name: agent.name || '',
        description: agent.description || '',
        tier: agent.tier || 'L1',
        category: agent.category || '',
        specialization: agent.specialization || '',
        capabilities: agent.capabilities || [],
        status: agent.status || 'active',
        version: agent.version || '1.0.0',
        skillsets: agent.skillsets || [],
        policies: agent.policies || {}
      });
    } else if (mode === 'create') {
      setFormData({
        name: '',
        description: '',
        tier: 'L1',
        category: '',
        specialization: '',
        capabilities: [],
        status: 'active',
        version: '1.0.0',
        skillsets: [],
        policies: {}
      });
    }
  }, [mode, agentData]);

  // Create/Update agent mutation — write endpoints not yet exposed under /api/jrx/*.
  // Fail fast with a clear toast instead of 404'ing against the dead /api/admin/agents.
  const saveAgentMutation = useMutation({
    mutationFn: async (_data: typeof formData) => {
      throw new Error(
        mode === 'create'
          ? 'Agent creation is read-only in this build (admin write endpoint pending).'
          : `Agent edit is read-only in this build (agent=${agentId}, admin write endpoint pending).`,
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      if (agentId) {
        queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      }
      toast({
        title: mode === 'create' ? 'Agent Created' : 'Agent Updated',
        description: data.message,
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: 'Read-only mode',
        description: error?.message || `Failed to ${mode} agent`,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveAgentMutation.mutate(formData);
  };

  const addCapability = () => {
    if (newCapability.trim() && !formData.capabilities.includes(newCapability.trim())) {
      setFormData(prev => ({
        ...prev,
        capabilities: [...prev.capabilities, newCapability.trim()]
      }));
      setNewCapability('');
    }
  };

  const removeCapability = (capability: string) => {
    setFormData(prev => ({
      ...prev,
      capabilities: prev.capabilities.filter(c => c !== capability)
    }));
  };

  const addSkillset = () => {
    if (newSkillset.trim() && !formData.skillsets.includes(newSkillset.trim())) {
      setFormData(prev => ({
        ...prev,
        skillsets: [...prev.skillsets, newSkillset.trim()]
      }));
      setNewSkillset('');
    }
  };

  const removeSkillset = (skillset: string) => {
    setFormData(prev => ({
      ...prev,
      skillsets: prev.skillsets.filter(s => s !== skillset)
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="modal-agent-edit">
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 mb-1" role="status">
          Agent registry is <strong>read-only</strong> — inspect only; admin write endpoints are not yet exposed under <code>/api/jrx/agents</code>.
        </div>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Create New Agent' : 'Edit Agent'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Agent Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter agent name"
                required
                data-testid="input-agent-name"
              />
            </div>
            <div>
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                value={formData.version}
                onChange={(e) => setFormData(prev => ({ ...prev, version: e.target.value }))}
                placeholder="1.0.0"
                required
                data-testid="input-agent-version"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe the agent's purpose and functionality"
              rows={3}
              data-testid="textarea-agent-description"
            />
          </div>

          {/* ROMA Tier and Category */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="tier">ROMA Tier</Label>
              <Select value={formData.tier} onValueChange={(value: any) => setFormData(prev => ({ ...prev, tier: value }))}>
                <SelectTrigger data-testid="select-agent-tier">
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TIERS.map(tier => (
                    <SelectItem key={tier.value} value={tier.value}>
                      {tier.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}>
                <SelectTrigger data-testid="select-agent-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_CATEGORIES.map(category => (
                    <SelectItem key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value: any) => setFormData(prev => ({ ...prev, status: value }))}>
                <SelectTrigger data-testid="select-agent-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="specialization">Specialization</Label>
            <Input
              id="specialization"
              value={formData.specialization}
              onChange={(e) => setFormData(prev => ({ ...prev, specialization: e.target.value }))}
              placeholder="e.g., Natural Language Processing, Code Generation"
              data-testid="input-agent-specialization"
            />
          </div>

          {/* Capabilities */}
          <div>
            <Label>Capabilities</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newCapability}
                onChange={(e) => setNewCapability(e.target.value)}
                placeholder="Add capability"
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addCapability())}
                data-testid="input-new-capability"
              />
              <Button type="button" onClick={addCapability} data-testid="button-add-capability">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.capabilities.map((capability, index) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1">
                  {capability}
                  <X 
                    className="w-3 h-3 cursor-pointer" 
                    onClick={() => removeCapability(capability)}
                    data-testid={`button-remove-capability-${index}`}
                  />
                </Badge>
              ))}
            </div>
          </div>

          {/* Skillsets */}
          <div>
            <Label>Skillsets</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newSkillset}
                onChange={(e) => setNewSkillset(e.target.value)}
                placeholder="Add skillset"
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSkillset())}
                data-testid="input-new-skillset"
              />
              <Button type="button" onClick={addSkillset} data-testid="button-add-skillset">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.skillsets.map((skillset, index) => (
                <Badge key={index} variant="outline" className="flex items-center gap-1">
                  {skillset}
                  <X 
                    className="w-3 h-3 cursor-pointer" 
                    onClick={() => removeSkillset(skillset)}
                    data-testid={`button-remove-skillset-${index}`}
                  />
                </Badge>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel">
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={saveAgentMutation.isPending}
              data-testid="button-save-agent"
            >
              {saveAgentMutation.isPending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              ) : null}
              {mode === 'create' ? 'Create Agent' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
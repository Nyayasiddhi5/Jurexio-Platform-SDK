import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Save, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { nv } from '@/lib/jrx-api-paths';
export default function OrgLlmBudgetAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [budget, setBudget] = useState<string>('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: [nv('admin/llm-budget')],
    queryFn: () => apiRequest('GET', nv('admin/llm-budget')),
  });

  useEffect(() => {
    const b = (data as any)?.budget_credits;
    if (typeof b === 'number') setBudget(String(b));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: any) => apiRequest('PATCH', nv('admin/llm-budget'), body),
    onSuccess: (resp: any) => {
      qc.invalidateQueries({ queryKey: [nv('admin/llm-budget')] });
      const warn = resp?.audit_warning;
      toast({
        title: warn ? 'Saved (audit warning)' : 'LLM budget updated',
        description: warn ? String(warn) : undefined,
        variant: warn ? 'destructive' : 'default',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to save',
        description: String(err?.message ?? 'Unknown error'),
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    const n = Number(budget);
    if (!Number.isInteger(n) || n < 0) {
      toast({ title: 'Enter a non-negative whole number of credits', variant: 'destructive' });
      return;
    }
    save.mutate({ budget_credits: n });
  };

  const d: any = data ?? {};
  const spend = Number(d.spend_credits ?? 0);
  const cap = Number(d.budget_credits ?? 0);
  const util = cap > 0 ? Math.min(100, Math.round((spend / cap) * 100)) : null;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Monthly LLM Budget
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Set a monthly cap (in credits) for LLM spend across this organization. Updates are
            audit-logged.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Reload
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current usage (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Spend</div>
              <div className="text-xl font-semibold">{spend.toLocaleString()} cr</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Budget</div>
              <div className="text-xl font-semibold">
                {cap > 0 ? `${cap.toLocaleString()} cr` : 'No cap'}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Calls</div>
              <div className="text-xl font-semibold">
                {Number(d.usage?.calls ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
          {util !== null && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Utilization</span>
                <span>{util}%</span>
              </div>
              <Progress value={util} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Set monthly cap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="budget_credits">Budget (credits / month)</Label>
            <Input
              id="budget_credits"
              type="number"
              min={0}
              step={1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 100000"
              className="mt-1 max-w-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Set to <code>0</code> to remove the cap. Spend is measured against{' '}
              <code>nv_ai_activity.credits_charged</code> over a rolling 30-day window.
            </p>
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Saves to <code>nv_organizations.settings.llm_budget_monthly</code> and appends an{' '}
              <code>admin.llm_budget.update</code> record to the tamper-evident audit chain.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save budget
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

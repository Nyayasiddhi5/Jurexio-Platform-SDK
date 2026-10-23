import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Palette, Save, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

import { nv } from '@/lib/jrx-api-paths';
type WhiteLabel = {
  enabled: boolean;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  domain: string | null;
  brand_name: string | null;
  favicon_url: string | null;
};

const EMPTY: WhiteLabel = {
  enabled: false,
  logo_url: '',
  primary_color: '#152448',
  accent_color: '#C7B15B',
  domain: '',
  brand_name: '',
  favicon_url: '',
};

export default function OrgWhiteLabelAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<WhiteLabel>(EMPTY);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [nv('admin/white-label')],
    queryFn: () => apiRequest('GET', nv('admin/white-label')),
  });

  useEffect(() => {
    const wl = (data as any)?.white_label;
    if (wl) {
      setForm({
        enabled: !!wl.enabled,
        logo_url: wl.logo_url ?? '',
        primary_color: wl.primary_color ?? '#152448',
        accent_color: wl.accent_color ?? '#C7B15B',
        domain: wl.domain ?? '',
        brand_name: wl.brand_name ?? '',
        favicon_url: wl.favicon_url ?? '',
      });
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (body: any) => apiRequest('PATCH', nv('admin/white-label'), body),
    onSuccess: (resp: any) => {
      qc.invalidateQueries({ queryKey: [nv('admin/white-label')] });
      const warn = resp?.audit_warning;
      toast({
        title: warn ? 'Saved (audit warning)' : 'White-label settings saved',
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
    const payload: any = {
      enabled: form.enabled,
      primary_color: form.primary_color,
      accent_color: form.accent_color,
      logo_url: form.logo_url || null,
      domain: form.domain || null,
      brand_name: form.brand_name || null,
      favicon_url: form.favicon_url || null,
    };
    save.mutate(payload);
  };

  const orgName = (data as any)?.org_name;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Palette className="h-6 w-6 text-primary" />
            Organization White-Label
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Brand the console for {orgName ? <strong>{orgName}</strong> : 'your organization'}.
            Changes are audit-logged.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Reload
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Enable white-label</Label>
              <p className="text-xs text-muted-foreground">
                When off, defaults to the Jurexio brand.
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>

          <div>
            <Label htmlFor="brand_name">Brand name</Label>
            <Input
              id="brand_name"
              value={form.brand_name ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, brand_name: e.target.value }))}
              placeholder="Acme Legal"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="primary_color">Primary color</Label>
              <div className="flex gap-2 mt-1">
                <input
                  type="color"
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="h-9 w-12 rounded border cursor-pointer"
                  aria-label="Primary color picker"
                />
                <Input
                  id="primary_color"
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="accent_color">Accent color</Label>
              <div className="flex gap-2 mt-1">
                <input
                  type="color"
                  value={form.accent_color}
                  onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))}
                  className="h-9 w-12 rounded border cursor-pointer"
                  aria-label="Accent color picker"
                />
                <Input
                  id="accent_color"
                  value={form.accent_color}
                  onChange={(e) => setForm((f) => ({ ...f, accent_color: e.target.value }))}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="logo_url">Logo URL</Label>
            <Input
              id="logo_url"
              value={form.logo_url ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
              placeholder="https://cdn.example.com/logo.svg"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="favicon_url">Favicon URL</Label>
            <Input
              id="favicon_url"
              value={form.favicon_url ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, favicon_url: e.target.value }))}
              placeholder="https://cdn.example.com/favicon.ico"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="domain">Custom domain</Label>
            <Input
              id="domain"
              value={form.domain ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
              placeholder="console.acme-legal.com"
              className="mt-1"
            />
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              Colors must be in <code>#RRGGBB</code> format. Updates write to{' '}
              <code>nv_organizations.settings.whiteLabel</code> and append a record to the
              tamper-evident audit chain.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

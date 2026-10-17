import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Play, Copy, TerminalSquare, Braces } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`.replace(/\/\/+/g, "/");

// ---------------------------------------------------------------------------
// OpenAPI schema model
// ---------------------------------------------------------------------------

interface RawSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  properties?: Record<string, RawSchema>;
  required?: string[];
  items?: RawSchema;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  example?: unknown;
}

interface RawParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: RawSchema;
}

interface RawOperation {
  summary?: string;
  parameters?: RawParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: RawSchema }>;
  };
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, RawOperation | RawParameter[]>>;
  components?: { schemas?: Record<string, RawSchema> };
}

/** A flattened, ref-resolved input field derived from the spec. */
interface Field {
  name: string;
  location: "path" | "query" | "body";
  required: boolean;
  type: string; // string | number | integer | boolean | enum | json
  enumValues: string[] | null;
  description: string;
  defaultValue: string;
  min?: number;
  max?: number;
}

interface SpecOperation {
  key: string;
  method: string;
  path: string;
  summary: string;
  fields: Field[];
  bodyRequired: boolean;
}

function resolveRef(schema: RawSchema | undefined, spec: OpenApiSpec, depth = 0): RawSchema {
  if (!schema || depth > 6) return schema ?? {};
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop() ?? "";
    return resolveRef(spec.components?.schemas?.[name], spec, depth + 1);
  }
  return schema;
}

function schemaToFieldType(s: RawSchema): { type: string; enumValues: string[] | null } {
  if (s.enum && s.enum.length > 0) {
    return { type: "enum", enumValues: s.enum.map((v) => String(v)) };
  }
  const t = s.type ?? "string";
  if (t === "object" || t === "array") return { type: "json", enumValues: null };
  return { type: t, enumValues: null };
}

function defaultFor(s: RawSchema, type: string): string {
  if (s.default !== undefined) {
    return type === "json" ? JSON.stringify(s.default, null, 2) : String(s.default);
  }
  if (s.example !== undefined) {
    return type === "json" ? JSON.stringify(s.example, null, 2) : String(s.example);
  }
  if (type === "json") return s.type === "array" ? "[]" : "{}";
  return "";
}

function buildOperations(spec: OpenApiSpec): SpecOperation[] {
  const ops: SpecOperation[] = [];
  for (const [p, methods] of Object.entries(spec.paths ?? {})) {
    const sharedParams = Array.isArray(methods.parameters)
      ? (methods.parameters as RawParameter[])
      : [];
    for (const [m, opRaw] of Object.entries(methods)) {
      if (!["get", "post", "patch", "delete"].includes(m) || Array.isArray(opRaw)) continue;
      const op = opRaw as RawOperation;
      const method = m.toUpperCase();
      const fields: Field[] = [];
      const params = [...sharedParams, ...((op.parameters ?? []) as RawParameter[])];
      for (const param of params) {
        if (param.in !== "path" && param.in !== "query") continue;
        const s = resolveRef(param.schema, spec);
        const { type, enumValues } = schemaToFieldType(s);
        fields.push({
          name: param.name,
          location: param.in,
          required: param.in === "path" ? true : !!param.required,
          type,
          enumValues,
          description: param.description ?? s.description ?? "",
          defaultValue: defaultFor(s, type),
          min: s.minimum,
          max: s.maximum,
        });
      }
      let bodyRequired = false;
      const bodySchemaRaw = op.requestBody?.content?.["application/json"]?.schema;
      if (bodySchemaRaw) {
        bodyRequired = op.requestBody?.required ?? false;
        const bodySchema = resolveRef(bodySchemaRaw, spec);
        const requiredSet = new Set(bodySchema.required ?? []);
        for (const [name, propRaw] of Object.entries(bodySchema.properties ?? {})) {
          const s = resolveRef(propRaw, spec);
          const { type, enumValues } = schemaToFieldType(s);
          fields.push({
            name,
            location: "body",
            required: requiredSet.has(name),
            type,
            enumValues,
            description: s.description ?? "",
            defaultValue: defaultFor(s, type),
            min: s.minimum,
            max: s.maximum,
          });
        }
      }
      ops.push({
        key: `${method} ${p}`,
        method,
        path: p,
        summary: op.summary ?? "",
        fields,
        bodyRequired,
      });
    }
  }
  ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return ops;
}

// ---------------------------------------------------------------------------
// Value coercion + validation
// ---------------------------------------------------------------------------

interface BuildResult {
  url: string;
  body: string | null;
  errors: string[];
}

function buildRequest(op: SpecOperation, values: Record<string, string>): BuildResult {
  const errors: string[] = [];
  let path = op.path;
  const query = new URLSearchParams();
  const bodyObj: Record<string, unknown> = {};
  let hasBodyValue = false;

  for (const f of op.fields) {
    const raw = (values[`${f.location}:${f.name}`] ?? "").trim();
    if (!raw) {
      if (f.required) errors.push(`${f.name} is required`);
      continue;
    }
    let coerced: unknown = raw;
    if (f.type === "number" || f.type === "integer") {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        errors.push(`${f.name} must be a number`);
        continue;
      }
      if (f.type === "integer" && !Number.isInteger(n)) {
        errors.push(`${f.name} must be an integer`);
        continue;
      }
      if (f.min !== undefined && n < f.min) errors.push(`${f.name} must be ≥ ${f.min}`);
      if (f.max !== undefined && n > f.max) errors.push(`${f.name} must be ≤ ${f.max}`);
      coerced = n;
    } else if (f.type === "boolean") {
      coerced = raw === "true";
    } else if (f.type === "json") {
      try {
        coerced = JSON.parse(raw);
      } catch {
        errors.push(`${f.name} must be valid JSON`);
        continue;
      }
    } else if (f.enumValues && !f.enumValues.includes(raw)) {
      errors.push(`${f.name} must be one of: ${f.enumValues.join(", ")}`);
      continue;
    }
    if (f.location === "path") {
      path = path.replace(`{${f.name}}`, encodeURIComponent(raw));
    } else if (f.location === "query") {
      query.set(f.name, String(coerced));
    } else {
      bodyObj[f.name] = coerced;
      hasBodyValue = true;
    }
  }

  const unresolved = path.match(/\{([^}]+)\}/);
  if (unresolved) errors.push(`Path parameter ${unresolved[1]} is required`);

  const qs = query.toString();
  return {
    url: `${path}${qs ? `?${qs}` : ""}`,
    body: hasBodyValue || op.bodyRequired ? JSON.stringify(bodyObj, null, 2) : null,
    errors,
  };
}

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-200",
  POST: "bg-blue-100 text-blue-800 border-blue-200",
  PATCH: "bg-amber-100 text-amber-800 border-amber-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

const LOCATION_LABEL: Record<Field["location"], string> = {
  path: "path",
  query: "query",
  body: "body",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ApiTester() {
  const { toast } = useToast();
  const [operations, setOperations] = useState<SpecOperation[]>([]);
  const [specError, setSpecError] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rawMode, setRawMode] = useState(false);
  const [rawBody, setRawBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [response, setResponse] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/openapi.json`)
      .then((r) => r.json())
      .then((spec: OpenApiSpec) => setOperations(buildOperations(spec)))
      .catch(() => setSpecError(true));
  }, []);

  const op = useMemo(
    () => operations.find((o) => o.key === selected) ?? null,
    [operations, selected],
  );

  const selectOperation = (key: string) => {
    setSelected(key);
    const next = operations.find((o) => o.key === key);
    const init: Record<string, string> = {};
    for (const f of next?.fields ?? []) {
      if (f.defaultValue) init[`${f.location}:${f.name}`] = f.defaultValue;
    }
    setValues(init);
    setRawMode(false);
    setRawBody("");
    setStatus(null);
    setResponse("");
    setElapsed(null);
  };

  const built = useMemo(
    () => (op ? buildRequest(op, values) : null),
    [op, values],
  );

  const bodyFields = op?.fields.filter((f) => f.location === "body") ?? [];
  const paramFields = op?.fields.filter((f) => f.location !== "body") ?? [];
  const usesBody = op ? ["POST", "PATCH"].includes(op.method) : false;

  const effectiveBody = usesBody ? (rawMode ? rawBody.trim() || null : built?.body ?? null) : null;

  const send = async () => {
    if (!op || !built) return;
    if (!rawMode && built.errors.length > 0) {
      toast({
        title: "Fix request inputs",
        description: built.errors.join("; "),
        variant: "destructive",
      });
      return;
    }
    if (rawMode && rawBody.trim()) {
      try {
        JSON.parse(rawBody);
      } catch {
        toast({ title: "Body is not valid JSON", variant: "destructive" });
        return;
      }
    }
    setSending(true);
    setStatus(null);
    setResponse("");
    setElapsed(null);
    const started = performance.now();
    try {
      const init: RequestInit = { method: op.method };
      if (effectiveBody) {
        init.headers = { "Content-Type": "application/json" };
        init.body = effectiveBody;
      }
      const res = await fetch(`${API_BASE}${built.url}`, init);
      setElapsed(Math.round(performance.now() - started));
      setStatus(res.status);
      const text = await res.text();
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (err) {
      setElapsed(Math.round(performance.now() - started));
      setResponse(err instanceof Error ? err.message : "Request failed");
      setStatus(0);
    } finally {
      setSending(false);
    }
  };

  const curl = useMemo(() => {
    if (!op || !built) return "";
    const base = `curl -X ${op.method} '${window.location.origin}${API_BASE}${built.url}'`;
    if (effectiveBody) {
      return `${base} \\\n  -H 'Content-Type: application/json' \\\n  -d '${effectiveBody.replace(/\n\s*/g, " ")}'`;
    }
    return base;
  }, [op, built, effectiveBody]);

  const setField = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const renderField = (f: Field) => {
    const key = `${f.location}:${f.name}`;
    const value = values[key] ?? "";
    const missing = f.required && !value.trim();
    return (
      <div key={key}>
        <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <span className="font-mono normal-case text-foreground">{f.name}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
            {LOCATION_LABEL[f.location]}
          </Badge>
          {f.required && (
            <span className={cn("normal-case", missing ? "text-destructive" : "text-muted-foreground")}>
              required
            </span>
          )}
        </label>
        {f.type === "enum" && f.enumValues ? (
          <Select value={value} onValueChange={(v) => setField(key, v)}>
            <SelectTrigger className={cn(missing && "border-destructive")}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {f.enumValues.map((v) => (
                <SelectItem key={v} value={v}>
                  <span className="font-mono text-xs">{v}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : f.type === "boolean" ? (
          <Select value={value} onValueChange={(v) => setField(key, v)}>
            <SelectTrigger className={cn(missing && "border-destructive")}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        ) : f.type === "json" ? (
          <Textarea
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            className={cn("font-mono text-sm min-h-[80px]", missing && "border-destructive")}
            placeholder={f.description || "JSON value"}
          />
        ) : (
          <Input
            value={value}
            onChange={(e) => setField(key, e.target.value)}
            type={f.type === "number" || f.type === "integer" ? "number" : "text"}
            className={cn("font-mono text-sm", missing && "border-destructive")}
            placeholder={f.description || (f.type === "string" ? "text" : f.type)}
          />
        )}
        {f.description && (
          <p className="text-xs text-muted-foreground mt-1">{f.description}</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-serif font-bold text-foreground mb-2">API Tester</h1>
        <p className="text-muted-foreground">
          Explore and exercise the platform API interactively. Endpoints, parameters, and
          request bodies are derived live from the OpenAPI spec.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-serif flex items-center gap-2">
              <TerminalSquare className="w-5 h-5" /> Request
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
                Endpoint{" "}
                {specError && (
                  <span className="text-destructive normal-case">
                    (spec unavailable — reload the page)
                  </span>
                )}
              </label>
              <Select value={selected} onValueChange={selectOperation}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick an endpoint from the spec…" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {operations.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      <span className="font-mono text-xs">
                        <span className="font-semibold">{o.method}</span> {o.path}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {op?.summary && (
                <p className="text-xs text-muted-foreground mt-1.5">{op.summary}</p>
              )}
            </div>

            {op && (
              <div className="flex items-center gap-2 font-mono text-sm bg-muted/50 border rounded-md px-3 py-2 overflow-x-auto">
                <Badge variant="outline" className={cn("border font-mono shrink-0", METHOD_COLORS[op.method])}>
                  {op.method}
                </Badge>
                <span className="text-muted-foreground truncate">
                  {API_BASE}
                  {built?.url ?? op.path}
                </span>
              </div>
            )}

            {paramFields.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Parameters
                </p>
                {paramFields.map(renderField)}
              </div>
            )}

            {op && usesBody && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Body{op.bodyRequired ? " (required)" : ""}
                  </p>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Braces className="w-3.5 h-3.5" /> Raw JSON
                    <Switch
                      checked={rawMode}
                      onCheckedChange={(checked) => {
                        setRawMode(checked);
                        if (checked) setRawBody(built?.body ?? "{\n  \n}");
                      }}
                    />
                  </label>
                </div>
                {rawMode ? (
                  <Textarea
                    value={rawBody}
                    onChange={(e) => setRawBody(e.target.value)}
                    className="font-mono text-sm min-h-[160px]"
                    placeholder='{ "key": "value" }'
                  />
                ) : bodyFields.length > 0 ? (
                  bodyFields.map(renderField)
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No body schema defined — switch to Raw JSON to send a custom payload.
                  </p>
                )}
              </div>
            )}

            {op && !rawMode && built && built.errors.length > 0 && (
              <ul className="text-xs text-destructive space-y-0.5 list-disc pl-4">
                {built.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <Button
                onClick={send}
                disabled={sending || !op || (!rawMode && (built?.errors.length ?? 0) > 0)}
                className="gap-2"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Send
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={!op}
                onClick={() => {
                  navigator.clipboard.writeText(curl);
                  toast({ title: "cURL copied" });
                }}
              >
                <Copy className="w-3.5 h-3.5" /> Copy as cURL
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-serif">Response</CardTitle>
              <div className="flex items-center gap-2">
                {elapsed !== null && (
                  <Badge variant="outline" className="font-mono">{elapsed} ms</Badge>
                )}
                {status !== null && (
                  <Badge
                    className={cn(
                      "font-mono border",
                      status >= 200 && status < 300
                        ? METHOD_COLORS.GET
                        : status === 0 || status >= 500
                          ? METHOD_COLORS.DELETE
                          : METHOD_COLORS.PATCH,
                    )}
                    variant="outline"
                  >
                    {status === 0 ? "ERR" : status}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {response ? (
              <pre className="overflow-auto max-h-[520px] whitespace-pre-wrap text-xs bg-muted/50 border rounded-md p-4 font-mono leading-relaxed">
                {response}
              </pre>
            ) : (
              <div className="py-16 text-center text-muted-foreground text-sm">
                {sending ? "Waiting for response…" : "Send a request to see the response here."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

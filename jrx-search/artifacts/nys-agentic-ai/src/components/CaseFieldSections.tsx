import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fieldDisplayValue } from "@/lib/cnrApi";
import { CNR_FIELD_GROUPS } from "@/lib/cnrFieldGroups";
import type { CnrFieldManifest, CnrFieldValue, CnrResolveData } from "@/lib/cnrTypes";

function formatStructuredValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    return value
      .map((row) => {
        if (row && typeof row === "object") {
          return Object.entries(row as Record<string, unknown>)
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(" · ");
        }
        return String(row);
      })
      .join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n");
  }
  return String(value);
}

function manifestHint(
  key: string,
  manifest?: CnrFieldManifest,
): "complete" | "partial" | "missing" | "manual" | null {
  if (!manifest) return null;
  if (manifest.complete?.includes(key)) return "complete";
  if (manifest.partial?.includes(key)) return "partial";
  if (manifest.manualRequired?.includes(key) || manifest.manualRecommended?.includes(key)) {
    return "manual";
  }
  if (manifest.missing?.includes(key) || manifest.corpusUnavailable?.includes(key)) {
    return "missing";
  }
  return null;
}

function FieldRow({
  label,
  fieldKey,
  field,
  availability,
  manifest,
  forceShow,
}: {
  label: string;
  fieldKey: string;
  field?: CnrFieldValue | null;
  availability?: Record<string, string>;
  manifest?: CnrFieldManifest;
  forceShow?: boolean;
}) {
  const display = field ? formatStructuredValue(field.value) : "";
  const hasValue = Boolean(display);
  const mHint = manifestHint(fieldKey, manifest);
  const avail = availability?.[fieldKey];

  if (!hasValue && !forceShow && !avail && !field?.note && mHint !== "manual") {
    return null;
  }

  if (!field && !forceShow) {
    return null;
  }

  const emptyLabel =
    avail ||
    field?.note ||
    (mHint === "manual"
      ? "Manual capture recommended"
      : mHint === "missing"
        ? "Not in judgment corpus"
        : "Not published for this row");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2 border-b border-border/60 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="sm:col-span-2 text-sm whitespace-pre-wrap break-words">
        {hasValue ? (
          display
        ) : (
          <span className="text-muted-foreground italic">{emptyLabel}</span>
        )}
        {field?.source && hasValue && (
          <Badge variant="outline" className="ml-2 text-[10px] font-normal align-middle">
            {field.source}
          </Badge>
        )}
        {mHint === "complete" && hasValue && (
          <Badge variant="secondary" className="ml-1 text-[10px] font-normal">
            complete
          </Badge>
        )}
      </dd>
    </div>
  );
}

export function CaseFieldSections({ data }: { data: CnrResolveData }) {
  const fields = data.fields ?? {};
  const manifest = data.caseCreate?.fieldManifest;
  const availability = data.meta?.fieldAvailability;

  return (
    <div className="space-y-6">
      {CNR_FIELD_GROUPS.map((group) => {
        const rows = group.fields.map((f) => (
          <FieldRow
            key={f.key}
            fieldKey={f.key}
            label={f.label}
            field={fields[f.key] as CnrFieldValue | undefined}
            availability={availability}
            manifest={manifest}
            forceShow
          />
        ));

        return (
          <Card key={group.id}>
            <CardHeader>
              <CardTitle className="text-base font-serif">{group.title}</CardTitle>
              {group.description && (
                <CardDescription className="text-xs">{group.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <dl>{rows}</dl>
            </CardContent>
          </Card>
        );
      })}

      {manifest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-serif">Field manifest</CardTitle>
            <CardDescription className="text-xs">
              From NYV resolve — drives partial autofill (same contract as NSP BFF).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs space-y-2 font-mono">
            {(["complete", "partial", "missing", "manualRecommended", "corpusUnavailable", "manualRequired"] as const).map(
              (bucket) => {
                const list = manifest[bucket];
                if (!list?.length) return null;
                return (
                  <p key={bucket}>
                    <span className="text-muted-foreground">{bucket}:</span> {list.join(", ")}
                  </p>
                );
              },
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Legacy single-field helper for headers. */
export { fieldDisplayValue };

import type { CnrCandidate } from "@/lib/cnrTypes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CnrCandidatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: CnrCandidate[];
  onSelect: (cnr: string) => void;
}

export function CnrCandidatePicker({
  open,
  onOpenChange,
  candidates,
  onSelect,
}: CnrCandidatePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif">Multiple matches found</DialogTitle>
          <DialogDescription>
            Pick the case that best matches your search. We will open the full case file.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {candidates.map((c, i) => (
            <li key={c.cnr ?? `c-${i}`}>
              <Button
                type="button"
                variant="outline"
                className="w-full h-auto py-3 px-4 justify-start text-left flex-col items-start gap-1"
                disabled={!c.cnr}
                onClick={() => {
                  if (c.cnr) {
                    onSelect(c.cnr);
                    onOpenChange(false);
                  }
                }}
              >
                <span className="font-medium">{c.title || "Untitled case"}</span>
                <span className="text-xs text-muted-foreground flex flex-wrap gap-2">
                  {c.cnr && <span>CNR {c.cnr}</span>}
                  {c.courtName && <span>{c.courtName}</span>}
                  {c.decisionDate && <span>{c.decisionDate}</span>}
                  <Badge variant="secondary" className="text-[10px]">
                    {Math.round(c.confidence * 100)}% · {c.source}
                  </Badge>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

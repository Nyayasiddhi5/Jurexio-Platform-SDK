import { Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface FollowUpSuggestionsProps {
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
}

export function FollowUpSuggestions({ suggestions, onSuggestionClick }: FollowUpSuggestionsProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Card className="bg-purple-500/10 border-purple-500/30 p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-5 h-5 text-purple-400" />
        <h3 className="font-semibold text-purple-100">Suggested Follow-ups</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {suggestions.map((suggestion, index) => (
          <Button
            key={index}
            variant="outline"
            onClick={() => onSuggestionClick(suggestion)}
            className="justify-start text-left h-auto py-3 px-4 bg-[hsl(222,47%,11%)] border-purple-500/20 hover:border-purple-500/50 hover:bg-purple-500/10 text-purple-100 hover:text-purple-50"
            data-testid={`button-followup-${index}`}
          >
            <span className="text-sm line-clamp-2">{suggestion}</span>
          </Button>
        ))}
      </div>
    </Card>
  );
}

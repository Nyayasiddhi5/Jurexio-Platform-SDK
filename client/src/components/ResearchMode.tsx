import { useState } from 'react';
import { Search, BookOpen, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Source {
  title: string;
  url: string;
  snippet: string;
  relevance: number;
}

interface ResearchModeProps {
  query: string;
  sources: Source[];
  isSearching: boolean;
}

export function ResearchMode({ query, sources, isSearching }: ResearchModeProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!isSearching && sources.length === 0) {
    return null;
  }

  return (
    <Card className="bg-blue-500/10 border-blue-500/30 p-4 mb-4">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-blue-400" />
            <h3 className="font-semibold text-blue-100">Deep Research Mode</h3>
            {isSearching && (
              <Badge variant="outline" className="text-blue-300 border-blue-400">
                Searching...
              </Badge>
            )}
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-blue-300 hover:text-blue-100">
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          {isSearching ? (
            <div className="flex items-center gap-2 text-sm text-blue-300">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span>Searching across multiple sources for "{query}"...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-blue-200">
                Found {sources.length} relevant sources:
              </p>
              <div className="space-y-2">
                {sources.map((source, index) => (
                  <div
                    key={index}
                    className="bg-[hsl(222,47%,11%)] rounded-lg p-3 border border-blue-500/20"
                    data-testid={`source-${index}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <h4 className="text-sm font-medium text-blue-100 line-clamp-1">
                          {source.title}
                        </h4>
                      </div>
                      <Badge variant="outline" className="text-xs text-blue-300 border-blue-400">
                        {Math.round(source.relevance * 100)}%
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 mb-2 line-clamp-2">
                      {source.snippet}
                    </p>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      data-testid={`link-source-${index}`}
                    >
                      View source
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

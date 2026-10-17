/**
 * Natural Language Database Tool Component
 * 
 * Allows users to query the database using natural language
 * Phase 3 Track B: NL Database Tool UI
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Database, 
  Play, 
  Check, 
  X, 
  AlertTriangle, 
  Info, 
  Sparkles,
  Table as TableIcon,
  Eye,
  Code2,
  Lightbulb
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface QueryResult {
  success: boolean;
  operation: string;
  sql: string;
  rows?: any[];
  rowCount?: number;
  error?: string;
  warning?: string;
  executionTime: number;
  safetyChecks: {
    passed: boolean;
    warnings: string[];
    blocked?: string;
  };
}

interface DatabaseSchema {
  tables: Array<{
    name: string;
    columns: string[];
    rowCount?: number;
  }>;
}

export function NLDatabaseTool() {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('query');
  const [lastResult, setLastResult] = useState<QueryResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch database schema
  const { data: schemaData, isLoading: schemaLoading } = useQuery<{ success: boolean; tables: DatabaseSchema['tables'] }>({
    queryKey: ['/api/nl-database/schema']
  });

  // Fetch query suggestions
  const { data: suggestionsData } = useQuery<{ success: boolean; suggestions: string[] }>({
    queryKey: ['/api/nl-database/suggestions']
  });

  // Execute query mutation
  const executeMutation = useMutation({
    mutationFn: async (params: { query: string; dryRun?: boolean }) => {
      const response = await fetch('/api/nl-database/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: params.query,
          safetyLevel: 'read-only', // Always use read-only for safety
          maxRows: 100,
          dryRun: params.dryRun || false
        })
      });

      if (!response.ok) {
        throw new Error('Query execution failed');
      }

      return response.json();
    },
    onSuccess: (data: QueryResult) => {
      setLastResult(data);
      
      if (data.success) {
        toast({
          title: data.warning ? '⚠️ Query Validated' : '✅ Query Executed',
          description: data.warning || `Returned ${data.rowCount || 0} rows in ${data.executionTime}ms`
        });
      } else {
        toast({
          title: '❌ Query Failed',
          description: data.error || 'Unknown error',
          variant: 'destructive'
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: '❌ Error',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Execute query
  const handleExecute = (dryRun = false) => {
    if (!query.trim()) {
      toast({
        title: '⚠️ Empty Query',
        description: 'Please enter a query',
        variant: 'destructive'
      });
      return;
    }

    executeMutation.mutate({ query, dryRun });
  };

  // Use a suggestion
  const useSuggestion = (suggestion: string) => {
    setQuery(suggestion);
    setActiveTab('query');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-lg bg-blue-500/10">
          <Database className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Natural Language Database Query</h2>
          <p className="text-sm text-gray-400">
            Query your database using plain English - powered by Jurexio Legal SDK
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-[hsl(222,35%,20%)]">
          <TabsTrigger value="query" data-testid="tab-query">
            <Sparkles className="w-4 h-4 mr-2" />
            Query
          </TabsTrigger>
          <TabsTrigger value="schema" data-testid="tab-schema">
            <TableIcon className="w-4 h-4 mr-2" />
            Schema
          </TabsTrigger>
          <TabsTrigger value="suggestions" data-testid="tab-suggestions">
            <Lightbulb className="w-4 h-4 mr-2" />
            Examples
          </TabsTrigger>
        </TabsList>

        {/* Query Tab */}
        <TabsContent value="query" className="space-y-4">
          <Card className="bg-[hsl(222,35%,18%)] border-[hsl(222,35%,25%)]">
            <CardHeader>
              <CardTitle className="text-white">Enter Your Query</CardTitle>
              <CardDescription className="text-gray-400">
                Ask questions in natural language - AI will convert to SQL
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nl-query" className="text-gray-300">
                  Natural Language Query
                </Label>
                <Input
                  id="nl-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="e.g., Show me all users created this week"
                  className="bg-[hsl(222,35%,22%)] border-[hsl(222,35%,30%)] text-white"
                  data-testid="input-nl-query"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleExecute(false);
                    }
                  }}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => handleExecute(false)}
                  disabled={executeMutation.isPending || !query.trim()}
                  className="bg-blue-500 hover:bg-blue-600"
                  data-testid="button-execute-query"
                >
                  {executeMutation.isPending ? (
                    <>Processing...</>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Execute
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => handleExecute(true)}
                  disabled={executeMutation.isPending || !query.trim()}
                  variant="outline"
                  className="border-gray-600 text-gray-300"
                  data-testid="button-preview-sql"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview SQL
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Query Results */}
          {lastResult && (
            <Card className="bg-[hsl(222,35%,18%)] border-[hsl(222,35%,25%)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  {lastResult.success ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <X className="w-5 h-5 text-red-500" />
                  )}
                  Query Result
                  <Badge variant={lastResult.success ? 'default' : 'destructive'}>
                    {lastResult.operation}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Execution time: {lastResult.executionTime}ms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* SQL Display */}
                <div className="space-y-2">
                  <Label className="text-gray-300 flex items-center gap-2">
                    <Code2 className="w-4 h-4" />
                    Generated SQL
                  </Label>
                  <div className="bg-[hsl(222,35%,12%)] p-4 rounded-md border border-[hsl(222,35%,25%)]">
                    <code className="text-sm text-blue-300">{lastResult.sql}</code>
                  </div>
                </div>

                {/* Safety Checks */}
                {!lastResult.safetyChecks.passed && (
                  <Alert variant="destructive" className="border-red-500/50">
                    <X className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Query Blocked:</strong> {lastResult.safetyChecks.blocked || 'Failed safety checks'}
                      {lastResult.safetyChecks.warnings.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {lastResult.safetyChecks.warnings.map((warning, idx) => (
                            <li key={idx}>• {warning}</li>
                          ))}
                        </ul>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                
                {lastResult.safetyChecks.passed && lastResult.safetyChecks.warnings.length > 0 && (
                  <Alert className="bg-yellow-500/10 border-yellow-500/30">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <AlertDescription className="text-yellow-200">
                      <strong>Warnings:</strong>
                      <ul className="mt-2 space-y-1">
                        {lastResult.safetyChecks.warnings.map((warning, idx) => (
                          <li key={idx}>• {warning}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Error Display */}
                {lastResult.error && (
                  <Alert variant="destructive">
                    <X className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Error:</strong> {lastResult.error}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Warning Display */}
                {lastResult.warning && (
                  <Alert className="bg-blue-500/10 border-blue-500/30">
                    <Info className="w-4 h-4 text-blue-400" />
                    <AlertDescription className="text-blue-200">
                      {lastResult.warning}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Results Table */}
                {lastResult.success && lastResult.rows && lastResult.rows.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-gray-300">
                      Results ({lastResult.rowCount} rows)
                    </Label>
                    <ScrollArea className="h-[400px] w-full rounded-md border border-[hsl(222,35%,25%)]">
                      <div className="p-4">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[hsl(222,35%,25%)]">
                                {Object.keys(lastResult.rows[0]).map((key) => (
                                  <th
                                    key={key}
                                    className="px-4 py-2 text-left text-gray-300 font-medium"
                                  >
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {lastResult.rows.map((row, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-[hsl(222,35%,22%)] hover:bg-[hsl(222,35%,20%)]"
                                >
                                  {Object.values(row).map((value: any, cellIdx) => (
                                    <td
                                      key={cellIdx}
                                      className="px-4 py-2 text-gray-400"
                                      data-testid={`cell-${idx}-${cellIdx}`}
                                    >
                                      {value !== null && value !== undefined
                                        ? String(value)
                                        : <span className="text-gray-600 italic">null</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {lastResult.success && lastResult.rowCount === 0 && (
                  <Alert className="bg-gray-500/10 border-gray-500/30">
                    <Info className="w-4 h-4 text-gray-400" />
                    <AlertDescription className="text-gray-300">
                      Query executed successfully but returned no rows.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Schema Tab */}
        <TabsContent value="schema">
          <Card className="bg-[hsl(222,35%,18%)] border-[hsl(222,35%,25%)]">
            <CardHeader>
              <CardTitle className="text-white">Database Schema</CardTitle>
              <CardDescription className="text-gray-400">
                Available tables and columns
              </CardDescription>
            </CardHeader>
            <CardContent>
              {schemaLoading ? (
                <p className="text-gray-400">Loading schema...</p>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {schemaData?.tables.map((table) => (
                      <div
                        key={table.name}
                        className="p-4 rounded-lg bg-[hsl(222,35%,15%)] border border-[hsl(222,35%,25%)]"
                        data-testid={`table-${table.name}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-white font-medium flex items-center gap-2">
                            <TableIcon className="w-4 h-4 text-blue-400" />
                            {table.name}
                          </h4>
                          {table.rowCount !== undefined && (
                            <Badge variant="outline" className="text-gray-400">
                              {table.rowCount} rows
                            </Badge>
                          )}
                        </div>
                        <Separator className="my-2 bg-[hsl(222,35%,30%)]" />
                        <div className="grid grid-cols-2 gap-2">
                          {table.columns.map((column) => (
                            <div
                              key={column}
                              className="text-sm text-gray-400 flex items-center gap-2"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                              {column}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions">
          <Card className="bg-[hsl(222,35%,18%)] border-[hsl(222,35%,25%)]">
            <CardHeader>
              <CardTitle className="text-white">Query Examples</CardTitle>
              <CardDescription className="text-gray-400">
                Click to use these example queries
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {suggestionsData?.suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => useSuggestion(suggestion)}
                    className="p-4 text-left rounded-lg bg-[hsl(222,35%,15%)] border border-[hsl(222,35%,25%)] hover:border-blue-500 hover:bg-[hsl(222,35%,18%)] transition-colors"
                    data-testid={`suggestion-${idx}`}
                  >
                    <p className="text-gray-300">{suggestion}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

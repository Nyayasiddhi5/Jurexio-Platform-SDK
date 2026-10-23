import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Loader2, Play, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

export default function MultiLanguageSandbox() {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<'python' | 'go' | 'java' | 'auto'>('auto');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const executeCode = async () => {
    if (!code.trim()) {
      toast({ title: 'Validation Error', description: 'Code is required', variant: 'destructive' });
      return;
    }

    setIsExecuting(true);
    setResult(null);

    try {
      const response = await apiRequest<any>('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language, timeout: 10000 })
      });

      setResult(response);
      toast({
        title: response.success ? 'Execution Complete' : 'Execution Failed',
        description: response.success ? `Executed in ${response.executionTime}ms` : response.error
      });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to execute code', variant: 'destructive' });
    } finally {
      setIsExecuting(false);
    }
  };

  const examples = {
    python: `def greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("World"))`,
    go: `package main\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}`,
    java: `public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}`
  };

  return (
    <Card data-testid="card-multi-language-sandbox">
      <CardHeader>
        <CardTitle data-testid="text-title">Multi-Language Code Sandbox</CardTitle>
        <CardDescription data-testid="text-description">
          Execute Python, Go, and Java code with automatic language detection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="language" data-testid="label-language">Language</Label>
          <Select value={language} onValueChange={(v: any) => setLanguage(v)}>
            <SelectTrigger data-testid="select-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" data-testid="option-auto">Auto Detect</SelectItem>
              <SelectItem value="python" data-testid="option-python">Python</SelectItem>
              <SelectItem value="go" data-testid="option-go">Go</SelectItem>
              <SelectItem value="java" data-testid="option-java">Java</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="code" data-testid="label-code">Code</Label>
          <textarea
            id="code"
            data-testid="textarea-code"
            className="w-full h-64 p-3 font-mono text-sm border rounded-md"
            placeholder="Enter your code here..."
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={executeCode} disabled={isExecuting} data-testid="button-execute">
            {isExecuting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Code
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setCode(examples.python)}
            data-testid="button-example-python"
          >
            Python Example
          </Button>
          <Button
            variant="outline"
            onClick={() => setCode(examples.go)}
            data-testid="button-example-go"
          >
            Go Example
          </Button>
          <Button
            variant="outline"
            onClick={() => setCode(examples.java)}
            data-testid="button-example-java"
          >
            Java Example
          </Button>
        </div>

        {result && (
          <Alert
            variant={result.success ? 'default' : 'destructive'}
            data-testid={`alert-result-${result.success ? 'success' : 'error'}`}
          >
            {result.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <AlertTitle data-testid="text-result-title">
              {result.success ? 'Execution Successful' : 'Execution Failed'}
            </AlertTitle>
            <AlertDescription data-testid="text-result-description">
              <div className="space-y-2">
                <div>
                  <strong>Language:</strong> {result.language}
                  {result.detectedLanguage && ` (auto-detected)`}
                </div>
                <div>
                  <strong>Execution Time:</strong> {result.executionTime}ms
                </div>
                {result.output && (
                  <div>
                    <strong>Output:</strong>
                    <pre className="mt-2 text-xs bg-muted p-3 rounded overflow-x-auto" data-testid="pre-output">
                      {result.output}
                    </pre>
                  </div>
                )}
                {result.error && (
                  <div>
                    <strong>Error:</strong>
                    <pre className="mt-2 text-xs bg-destructive/10 p-3 rounded overflow-x-auto" data-testid="pre-error">
                      {result.error}
                    </pre>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

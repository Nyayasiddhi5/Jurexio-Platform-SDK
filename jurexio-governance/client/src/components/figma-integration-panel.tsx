import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { 
  Upload, 
  Link2, 
  FileImage, 
  Palette, 
  Code2, 
  Download,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Eye,
  Wand2
} from 'lucide-react';

interface FigmaIntegrationPanelProps {
  onDesignAnalysisComplete: (analysis: any) => void;
  onCodeGenerated: (code: any) => void;
}

interface FigmaAnalysis {
  components: any[];
  layout: any;
  colorPalette: string[];
  typography: any;
  interactions: any[];
  generatedCode: any;
}

export default function FigmaIntegrationPanel({ 
  onDesignAnalysisComplete, 
  onCodeGenerated 
}: FigmaIntegrationPanelProps) {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [analysisMode, setAnalysisMode] = useState<'url' | 'upload'>('url');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysis, setAnalysis] = useState<FigmaAnalysis | null>(null);
  const [generatedCode, setGeneratedCode] = useState<any>(null);
  const [selectedFramework, setSelectedFramework] = useState('react');
  const { toast } = useToast();

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ['image/png', 'image/jpg', 'image/jpeg', 'image/svg+xml', '.fig'];
      const isValidType = validTypes.some(type => 
        file.type === type || file.name.toLowerCase().endsWith('.fig')
      );
      
      if (!isValidType) {
        toast({
          title: "Invalid File Type",
          description: "Please upload a PNG, JPG, SVG, or .fig file",
          variant: "destructive"
        });
        return;
      }

      setUploadedFile(file);
      setAnalysisMode('upload');
      toast({
        title: "File Uploaded",
        description: `${file.name} ready for analysis`
      });
    }
  }, [toast]);

  const validateFigmaUrl = (url: string): boolean => {
    const figmaUrlPattern = /^https:\/\/(www\.)?figma\.com\/(file|proto)\/[a-zA-Z0-9]+\/.*$/;
    return figmaUrlPattern.test(url);
  };

  const analyzeFigmaDesign = async () => {
    if (analysisMode === 'url' && !validateFigmaUrl(figmaUrl)) {
      toast({
        title: "Invalid Figma URL",
        description: "Please enter a valid Figma file or prototype URL",
        variant: "destructive"
      });
      return;
    }

    if (analysisMode === 'upload' && !uploadedFile) {
      toast({
        title: "No File Selected",
        description: "Please upload a design file first",
        variant: "destructive"
      });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setAnalysisProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + Math.random() * 15;
        });
      }, 500);

      const formData = new FormData();
      if (analysisMode === 'url') {
        formData.append('figmaUrl', figmaUrl);
      } else {
        formData.append('designFile', uploadedFile!);
      }
      formData.append('analysisType', 'comprehensive');
      formData.append('framework', selectedFramework);

      const response = await fetch('/api/figma/analyze', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      clearInterval(progressInterval);
      setAnalysisProgress(100);

      if (result.success) {
        setAnalysis(result.data);
        onDesignAnalysisComplete(result.data);
        
        toast({
          title: "Analysis Complete",
          description: `Found ${result.data.components?.length || 0} components and generated design system`
        });
      } else {
        throw new Error(result.error || 'Analysis failed');
      }
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : 'Failed to analyze design',
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateCode = async () => {
    if (!analysis) {
      toast({
        title: "No Analysis Available",
        description: "Please analyze a design first",
        variant: "destructive"
      });
      return;
    }

    try {
      const response = await fetch('/api/figma/generate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis,
          framework: selectedFramework,
          outputType: 'production-ready'
        }),
      });

      const result = await response.json();

      if (result.success) {
        setGeneratedCode(result.data);
        onCodeGenerated(result.data);
        
        toast({
          title: "Code Generated",
          description: `Generated ${selectedFramework} components successfully`
        });
      } else {
        throw new Error(result.error || 'Code generation failed');
      }
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : 'Failed to generate code',
        variant: "destructive"
      });
    }
  };

  const downloadCode = () => {
    if (!generatedCode) return;

    const zip = new Blob([JSON.stringify(generatedCode, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(zip);
    const a = document.createElement('a');
    a.href = url;
    a.download = `figma-generated-${selectedFramework}-code.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Input Methods */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Figma Design Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode Selection */}
          <div className="flex items-center gap-4">
            <Label>Input Method:</Label>
            <Button
              variant={analysisMode === 'url' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAnalysisMode('url')}
            >
              <Link2 className="h-4 w-4 mr-2" />
              Figma URL
            </Button>
            <Button
              variant={analysisMode === 'upload' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAnalysisMode('upload')}
            >
              <Upload className="h-4 w-4 mr-2" />
              File Upload
            </Button>
          </div>

          {/* URL Input */}
          {analysisMode === 'url' && (
            <div className="space-y-2">
              <Label htmlFor="figma-url">Figma File URL</Label>
              <Input
                id="figma-url"
                placeholder="https://www.figma.com/file/your-file-id/Your-Design-Name"
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                Paste your Figma file or prototype URL. Make sure it's set to public or you have access.
              </p>
            </div>
          )}

          {/* File Upload */}
          {analysisMode === 'upload' && (
            <div className="space-y-2">
              <Label htmlFor="design-file">Design File</Label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <input
                  id="design-file"
                  type="file"
                  accept=".fig,.png,.jpg,.jpeg,.svg"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <label htmlFor="design-file" className="cursor-pointer">
                  <FileImage className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-sm text-gray-600">
                    {uploadedFile ? uploadedFile.name : 'Click to upload or drag and drop'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Supports .fig, PNG, JPG, SVG files
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Framework Selection */}
          <div className="space-y-2">
            <Label>Target Framework</Label>
            <select
              value={selectedFramework}
              onChange={(e) => setSelectedFramework(e.target.value)}
              className="w-full p-2 border rounded-md bg-background"
            >
              <option value="react">React + TypeScript</option>
              <option value="vue">Vue.js 3 + TypeScript</option>
              <option value="angular">Angular</option>
              <option value="svelte">Svelte</option>
              <option value="html">HTML + CSS</option>
              <option value="tailwind">Tailwind CSS</option>
            </select>
          </div>

          {/* Analyze Button */}
          <Button 
            onClick={analyzeFigmaDesign}
            disabled={isAnalyzing || (analysisMode === 'url' && !figmaUrl) || (analysisMode === 'upload' && !uploadedFile)}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Analyzing Design...
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Analyze Design
              </>
            )}
          </Button>

          {/* Progress */}
          {isAnalyzing && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Analysis Progress</span>
                <span>{Math.round(analysisProgress)}%</span>
              </div>
              <Progress value={analysisProgress} className="w-full" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Design Analysis Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{analysis.components?.length || 0}</div>
                <div className="text-sm text-gray-600">Components</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{analysis.colorPalette?.length || 0}</div>
                <div className="text-sm text-gray-600">Colors</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{analysis.typography?.fontFamilies?.length || 0}</div>
                <div className="text-sm text-gray-600">Fonts</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{analysis.interactions?.length || 0}</div>
                <div className="text-sm text-gray-600">Interactions</div>
              </div>
            </div>

            {/* Color Palette Preview */}
            {analysis.colorPalette && analysis.colorPalette.length > 0 && (
              <div className="space-y-2">
                <Label>Color Palette</Label>
                <div className="flex flex-wrap gap-2">
                  {analysis.colorPalette.map((color, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <div 
                        className="w-6 h-6 rounded border"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-mono">{color}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Generate Code Button */}
            <Button onClick={generateCode} className="w-full" variant="secondary">
              <Code2 className="h-4 w-4 mr-2" />
              Generate {selectedFramework} Code
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Generated Code */}
      {generatedCode && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-green-500" />
                Generated Code
              </div>
              <Button onClick={downloadCode} size="sm" variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedFramework}</Badge>
                <Badge variant="outline">{generatedCode.components?.length || 0} Components</Badge>
                <Badge variant="outline">Production Ready</Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div className="text-center">
                  <div className="font-semibold text-blue-600">Components</div>
                  <div>{generatedCode.components?.length || 0} files</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-600">Styles</div>
                  <div>{generatedCode.styles ? 'CSS + Tailwind' : 'CSS'}</div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-purple-600">Assets</div>
                  <div>{generatedCode.assets?.length || 0} files</div>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Code Preview:</p>
                <pre className="text-xs overflow-x-auto">
                  {generatedCode.preview || '// Generated code will appear here...'}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
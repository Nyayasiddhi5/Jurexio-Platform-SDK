import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, Upload, Download, FileCode, Users, Activity } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface MonacoFile {
  id: string;
  name: string;
  path: string;
  content: string;
  language: string;
  modified: boolean;
}

interface CollaborationCursor {
  userId: string;
  userName: string;
  color: string;
  line: number;
  column: number;
}

interface MonacoCodeEditorProps {
  files: MonacoFile[];
  activeFile: MonacoFile | null;
  onFileChange: (file: MonacoFile) => void;
  onFileSelect: (file: MonacoFile) => void;
  onFileSave: (file: MonacoFile) => void;
  realTimeCollaboration?: boolean;
  projectId?: string;
  // Use shared collaboration instead of creating separate WebSocket
  collaborationHook?: {
    isConnected: boolean;
    collaborationUsers: any[];
    sendFileChange: (fileId: string, content: string) => void;
    sendCursorUpdate: (fileId: string, line: number, column: number) => void;
  };
}

export default function MonacoCodeEditor({
  files,
  activeFile,
  onFileChange,
  onFileSelect,
  onFileSave,
  realTimeCollaboration = false,
  projectId,
  collaborationHook
}: MonacoCodeEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  // Use shared collaboration hook instead of creating separate WebSocket
  const isConnected = collaborationHook?.isConnected || false;
  const collaborationUsers = collaborationHook?.collaborationUsers || [];

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'cursor_update':
        setCollaborationCursors(prevCursors => {
          const filtered = prevCursors.filter(c => c.userId !== data.userId);
          return [...filtered, {
            userId: data.userId,
            userName: data.userName,
            color: data.color,
            line: data.line,
            column: data.column
          }];
        });
        break;
        
      case 'file_change':
        if (data.fileId === activeFile?.id && editorRef.current) {
          const currentContent = editorRef.current.getValue();
          if (currentContent !== data.content) {
            editorRef.current.setValue(data.content);
          }
        }
        break;
        
      case 'user_disconnected':
        setCollaborationCursors(prevCursors => 
          prevCursors.filter(c => c.userId !== data.userId)
        );
        break;
    }
  };

  const sendWebSocketMessage = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  };

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure Monaco editor options
    editor.updateOptions({
      fontSize: 14,
      fontFamily: 'Fira Code, Monaco, Menlo, monospace',
      lineNumbers: 'on',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      formatOnType: true,
      formatOnPaste: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true
      },
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      parameterHints: { enabled: true },
      folding: true,
      foldingStrategy: 'indentation'
    });

    // Add cursor position change listener for collaboration
    if (realTimeCollaboration) {
      editor.onDidChangeCursorPosition((event: any) => {
        sendWebSocketMessage({
          type: 'cursor_update',
          fileId: activeFile?.id,
          line: event.position.lineNumber,
          column: event.position.column,
          projectId
        });
      });

      // Add content change listener for collaboration
      editor.onDidChangeModelContent((event: any) => {
        if (activeFile) {
          const newContent = editor.getValue();
          const updatedFile = { ...activeFile, content: newContent, modified: true };
          onFileChange(updatedFile);

          // Send to other collaborators
          sendWebSocketMessage({
            type: 'file_change',
            fileId: activeFile.id,
            content: newContent,
            projectId
          });
        }
      });
    } else {
      // Standard content change listener
      editor.onDidChangeModelContent(() => {
        if (activeFile) {
          const newContent = editor.getValue();
          const updatedFile = { ...activeFile, content: newContent, modified: true };
          onFileChange(updatedFile);
        }
      });
    }

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile) {
        handleSaveFile(activeFile);
      }
    });

    // Configure language features
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true
    });
  };

  const handleSaveFile = async (file: MonacoFile) => {
    if (!file || isSaving) return;

    setIsSaving(true);
    try {
      const response = await apiRequest(`/api/projects/${projectId}/files/${file.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          content: file.content,
          fileName: file.name,
          filePath: file.path
        })
      });

      if (response.success) {
        const savedFile = { ...file, modified: false };
        onFileSave(savedFile);
        
        toast({
          title: 'File Saved',
          description: `${file.name} has been saved successfully`
        });
      }
    } catch (error) {
      toast({
        title: 'Save Failed',
        description: 'Failed to save file. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadFile = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.js,.ts,.jsx,.tsx,.json,.css,.scss,.html,.md,.py,.java,.php,.rb,.go,.rs,.cpp,.c,.h,.vue,.svelte';
    
    input.onchange = async (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      
      for (const file of files) {
        try {
          const content = await file.text();
          const language = getLanguageFromFilename(file.name);
          
          const response = await apiRequest(`/api/projects/${projectId}/files`, {
            method: 'POST',
            body: JSON.stringify({
              fileName: file.name,
              filePath: file.name,
              content,
              fileType: 'source',
              mimeType: file.type || 'text/plain'
            })
          });

          if (response.success) {
            toast({
              title: 'File Uploaded',
              description: `${file.name} uploaded successfully`
            });
          }
        } catch (error) {
          toast({
            title: 'Upload Failed',
            description: `Failed to upload ${file.name}`,
            variant: 'destructive'
          });
        }
      }
    };
    
    input.click();
  };

  const handleDownloadFile = () => {
    if (!activeFile) return;
    
    const blob = new Blob([activeFile.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLanguageFromFilename = (filename: string): string => {
    const extension = filename.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'json': 'json',
      'css': 'css',
      'scss': 'scss',
      'html': 'html',
      'md': 'markdown',
      'py': 'python',
      'java': 'java',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'vue': 'vue',
      'svelte': 'svelte'
    };
    return languageMap[extension || ''] || 'plaintext';
  };

  return (
    <Card className="h-full" data-testid="monaco-code-editor">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-blue-600" />
              Monaco Code Editor
            </CardTitle>
            {realTimeCollaboration && (
              <div className="flex items-center gap-2">
                <Badge variant={isConnected ? 'default' : 'secondary'} className="text-xs">
                  <Activity className="h-3 w-3 mr-1" />
                  {isConnected ? 'Connected' : 'Disconnected'}
                </Badge>
                {collaborationCursors.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    <Users className="h-3 w-3 mr-1" />
                    {collaborationCursors.length} online
                  </Badge>
                )}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => activeFile && handleSaveFile(activeFile)}
              disabled={!activeFile?.modified || isSaving}
              data-testid="button-save-monaco"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUploadFile}
              data-testid="button-upload-monaco"
            >
              <Upload className="h-4 w-4" />
              Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadFile}
              disabled={!activeFile}
              data-testid="button-download-monaco"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0 h-[600px]">
        {activeFile ? (
          <div className="h-full relative">
            <Editor
              height="100%"
              language={activeFile.language}
              value={activeFile.content}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: 'Fira Code, Monaco, Menlo, monospace',
                lineNumbers: 'on',
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
            />
            
            {/* Collaboration cursors overlay */}
            {realTimeCollaboration && collaborationCursors.length > 0 && (
              <div className="absolute top-2 right-2 flex flex-col gap-1">
                {collaborationCursors.map((cursor) => (
                  <div
                    key={cursor.userId}
                    className="flex items-center gap-1 bg-black bg-opacity-70 text-white px-2 py-1 rounded text-xs"
                    style={{ borderLeft: `3px solid ${cursor.color}` }}
                  >
                    <Users className="h-3 w-3" />
                    {cursor.userName}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No file selected</p>
              <p className="text-sm">Select a file from the file explorer to start editing</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
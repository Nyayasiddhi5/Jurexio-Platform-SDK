import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface ProjectUploadProps {
  onProjectCreated?: (project: any) => void;
  className?: string;
}

interface UploadedFile {
  file: File;
  type: 'prd' | 'brd' | 'figma' | 'image' | 'code' | 'other';
  preview?: string;
}

export function ProjectUpload({ onProjectCreated, className = "" }: ProjectUploadProps) {
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();

  // Create project mutation
  const createProjectMutation = useMutation({
    mutationFn: async (projectData: any) => {
      return apiRequest('/api/projects', {
        method: 'POST',
        body: JSON.stringify(projectData)
      });
    },
    onSuccess: (project) => {
      toast({
        title: "Project Created",
        description: `Project "${project.name}" has been created successfully.`,
      });
      onProjectCreated?.(project);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project",
        variant: "destructive"
      });
    }
  });

  // Upload files mutation
  const uploadFilesMutation = useMutation({
    mutationFn: async ({ projectId, files }: { projectId: number; files: File[] }) => {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });

      return apiRequest(`/api/projects/${projectId}/upload`, {
        method: 'POST',
        body: formData
      });
    },
    onSuccess: (result) => {
      toast({
        title: "Files Uploaded",
        description: `${result.files.length} files uploaded and analyzed successfully.`,
      });
      setUploadedFiles([]);
      setProjectName('');
      setProjectDescription('');
      setUploadProgress(0);
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive"
      });
    }
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    const newFiles = files.map(file => ({
      file,
      type: determineFileType(file),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    }));
    
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const determineFileType = (file: File): UploadedFile['type'] => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    const name = file.name.toLowerCase();
    
    if (file.type.startsWith('image/')) return 'image';
    if (extension === 'fig' || name.includes('figma')) return 'figma';
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go'].includes(extension || '')) return 'code';
    if (name.includes('prd') || name.includes('product') || name.includes('requirement')) return 'prd';
    if (name.includes('brd') || name.includes('business') || name.includes('brief')) return 'brd';
    
    return 'other';
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: UploadedFile['type']) => {
    const icons = {
      prd: '📋',
      brd: '📊', 
      figma: '🎨',
      image: '🖼️',
      code: '💻',
      other: '📄'
    };
    return icons[type];
  };

  const getFileColor = (type: UploadedFile['type']) => {
    const colors = {
      prd: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      brd: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      figma: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      image: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      code: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      other: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
    };
    return colors[type];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!projectName.trim()) {
      toast({
        title: "Error",
        description: "Project name is required",
        variant: "destructive"
      });
      return;
    }

    try {
      // First create the project
      const project = await createProjectMutation.mutateAsync({
        name: projectName,
        description: projectDescription,
        userId: 1 // Demo user ID
      });

      // Then upload files if any
      if (uploadedFiles.length > 0) {
        setUploadProgress(50);
        await uploadFilesMutation.mutateAsync({
          projectId: project.id,
          files: uploadedFiles.map(uf => uf.file)
        });
        setUploadProgress(100);
      }
    } catch (error) {
      console.error('Project creation/upload failed:', error);
    }
  };

  return (
    <Card className={`bg-gray-800 border-gray-700 ${className}`}>
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center text-white">
          Transform Ideas into Production-Ready Software
        </CardTitle>
        <p className="text-center text-gray-400">
          Upload your PRD, BRD, Figma designs, or screenshots. Let our AI agents orchestrate the complete development lifecycle.
        </p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project Details */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="projectName" className="text-white">Project Name</Label>
              <Input
                id="projectName"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Enter your project name"
                className="bg-gray-700 border-gray-600 text-white"
                required
              />
            </div>
            
            <div>
              <Label htmlFor="projectDescription" className="text-white">Description (Optional)</Label>
              <Textarea
                id="projectDescription"
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Describe your project goals and requirements"
                className="bg-gray-700 border-gray-600 text-white"
                rows={3}
              />
            </div>
          </div>

          {/* File Upload Zone */}
          <div className="space-y-4">
            <Label className="text-white">Project Documents</Label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <div className="space-y-4">
                <div className="text-4xl text-gray-400">
                  <i className="fas fa-cloud-upload-alt"></i>
                </div>
                <div>
                  <h4 className="text-lg font-medium text-white mb-2">
                    Drop your project documents here
                  </h4>
                  <p className="text-sm text-gray-400 mb-4">
                    PRD, BRD, Figma files, screenshots, or describe your project
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => document.getElementById('fileInput')?.click()}
                    className="bg-transparent border-gray-600 text-white hover:bg-gray-700"
                  >
                    Choose Files
                  </Button>
                  <input
                    id="fileInput"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md,.fig,.png,.jpg,.jpeg,.gif,.js,.ts,.jsx,.tsx,.py,.java,.go"
                    onChange={handleFileInput}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            {/* Quick Start Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer">
                <div className="text-2xl mb-2 text-blue-400">📋</div>
                <h4 className="font-semibold text-white">Upload PRD/BRD</h4>
                <p className="text-sm text-gray-400">Start with requirements</p>
              </div>
              <div className="p-4 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer">
                <div className="text-2xl mb-2 text-purple-400">🎨</div>
                <h4 className="font-semibold text-white">Import Figma</h4>
                <p className="text-sm text-gray-400">Design to code</p>
              </div>
              <div className="p-4 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors cursor-pointer">
                <div className="text-2xl mb-2 text-green-400">🖼️</div>
                <h4 className="font-semibold text-white">Screenshot Analysis</h4>
                <p className="text-sm text-gray-400">Reverse engineer</p>
              </div>
            </div>
          </div>

          {/* Uploaded Files */}
          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              <Label className="text-white">Uploaded Files ({uploadedFiles.length})</Label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {uploadedFiles.map((uploadedFile, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-700 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <span className="text-xl">{getFileIcon(uploadedFile.type)}</span>
                      <div>
                        <p className="text-sm font-medium text-white">{uploadedFile.file.name}</p>
                        <div className="flex items-center space-x-2">
                          <Badge className={getFileColor(uploadedFile.type)}>
                            {uploadedFile.type.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-gray-400">
                            {(uploadedFile.file.size / 1024 / 1024).toFixed(2)} MB
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      className="text-gray-400 hover:text-red-400"
                    >
                      <i className="fas fa-times"></i>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Upload Progress</span>
                <span className="text-blue-400">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            disabled={createProjectMutation.isPending || uploadFilesMutation.isPending}
          >
            {createProjectMutation.isPending || uploadFilesMutation.isPending ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Creating Project...</span>
              </div>
            ) : (
              'Create Project & Start Development'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

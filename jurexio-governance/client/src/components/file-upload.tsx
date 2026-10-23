import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { 
  Upload, 
  FileText, 
  Image, 
  Code2, 
  File,
  X,
  CheckCircle,
  AlertCircle
} from "lucide-react";

interface FileUploadProps {
  onFilesSelected: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxSize?: number; // in MB
  className?: string;
  isLoading?: boolean;
}

export default function FileUpload({
  onFilesSelected,
  accept = "*/*",
  multiple = true,
  maxFiles = 10,
  maxSize = 50,
  className,
  isLoading = false
}: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (file: File) => {
    const type = file.type;
    const name = file.name.toLowerCase();
    
    if (type.startsWith('image/') || name.includes('figma') || name.includes('sketch')) {
      return <Image className="h-4 w-4" />;
    }
    if (type.includes('text') || type.includes('document') || name.endsWith('.pdf')) {
      return <FileText className="h-4 w-4" />;
    }
    if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.json')) {
      return <Code2 className="h-4 w-4" />;
    }
    return <File className="h-4 w-4" />;
  };

  const validateFiles = (files: File[]): string[] => {
    const newErrors: string[] = [];
    
    if (files.length > maxFiles) {
      newErrors.push(`Maximum ${maxFiles} files allowed`);
    }
    
    files.forEach(file => {
      if (file.size > maxSize * 1024 * 1024) {
        newErrors.push(`${file.name} exceeds ${maxSize}MB limit`);
      }
    });
    
    return newErrors;
  };

  const handleFiles = useCallback((files: FileList) => {
    const fileArray = Array.from(files);
    const validationErrors = validateFiles(fileArray);
    
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setErrors([]);
    setSelectedFiles(prev => [...prev, ...fileArray]);
    
    // Simulate upload progress
    fileArray.forEach(file => {
      const fileId = `${file.name}-${file.size}`;
      setUploadProgress(prev => ({ ...prev, [fileId]: 0 }));
      
      const interval = setInterval(() => {
        setUploadProgress(prev => {
          const currentProgress = prev[fileId] || 0;
          if (currentProgress >= 100) {
            clearInterval(interval);
            return prev;
          }
          return { ...prev, [fileId]: currentProgress + 10 };
        });
      }, 100);
    });
    
    onFilesSelected(files);
  }, [maxFiles, maxSize, onFilesSelected]);

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
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const openFileSelector = () => {
    inputRef.current?.click();
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <div
        className={cn(
          "file-upload-zone relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer",
          dragActive ? "dragover border-primary bg-primary/10" : "border-muted-foreground/30 hover:border-primary/50",
          isLoading && "pointer-events-none opacity-50",
          className
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFileSelector}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleChange}
          className="hidden"
        />
        
        <div className="space-y-4">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">
              {dragActive ? "Drop files here" : "Drop files or click to upload"}
            </h3>
            <p className="text-muted-foreground">
              Support for PRD, BRD, Figma files, images, and documents
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Max {maxFiles} files, {maxSize}MB each
            </p>
          </div>
          
          <Button 
            type="button"
            variant="outline" 
            className="border-primary/30 text-primary hover:bg-primary/10"
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : "Choose Files"}
          </Button>
        </div>
        
        {isLoading && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-sm text-muted-foreground">Processing files...</p>
            </div>
          </div>
        )}
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((error, index) => (
            <div key={index} className="flex items-center space-x-2 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium text-white">Selected Files ({selectedFiles.length})</h4>
          <div className="space-y-2">
            {selectedFiles.map((file, index) => {
              const fileId = `${file.name}-${file.size}`;
              const progress = uploadProgress[fileId] || 0;
              const isComplete = progress >= 100;
              
              return (
                <div key={index} className="flex items-center space-x-3 p-3 bg-muted/30 rounded-lg border border-border">
                  <div className="text-primary">
                    {getFileIcon(file)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-white truncate">{file.name}</p>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(file.size)}
                        </span>
                        {isComplete ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(index);
                            }}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    
                    {!isComplete && (
                      <div className="space-y-1">
                        <Progress value={progress} className="h-1" />
                        <p className="text-xs text-muted-foreground">{progress}% uploaded</p>
                      </div>
                    )}
                    
                    {isComplete && (
                      <p className="text-xs text-emerald-400">Upload complete</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Supported File Types */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
          <FileText className="h-3 w-3 text-blue-400" />
          <span className="text-muted-foreground">PRD/BRD</span>
        </div>
        <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
          <Image className="h-3 w-3 text-purple-400" />
          <span className="text-muted-foreground">Designs</span>
        </div>
        <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
          <Code2 className="h-3 w-3 text-green-400" />
          <span className="text-muted-foreground">Code</span>
        </div>
        <div className="flex items-center space-x-2 p-2 bg-muted/30 rounded-lg">
          <File className="h-3 w-3 text-orange-400" />
          <span className="text-muted-foreground">Documents</span>
        </div>
      </div>
    </div>
  );
}

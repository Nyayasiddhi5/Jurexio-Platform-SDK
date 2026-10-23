import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SplitText } from "@/components/react-bits/split-text";
import { Hyperspeed } from "@/components/react-bits/hyperspeed";

interface HeroSectionProps {
  onFileUpload: (files: FileList) => void;
}

export function HeroSection({ onFileUpload }: HeroSectionProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setIsUploading(true);
      try {
        await onFileUpload(files);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setIsUploading(true);
      try {
        await onFileUpload(files);
      } finally {
        setIsUploading(false);
      }
    }
  };

  const handleChooseFiles = () => {
    fileInputRef.current?.click();
  };

  return (
    <section className="relative">
      <div className="gradient-bg rounded-2xl p-8 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20 rounded-2xl"></div>
        <div className="relative z-10 max-w-4xl mx-auto">
          <SplitText
            text="Transform Ideas into Production-Ready Software"
            className="text-4xl font-bold mb-4"
            delay={0.1}
          />
          
          <SplitText
            text="Upload your PRD, BRD, Figma designs, or screenshots. Let our 28 specialized AI agents orchestrate the complete development lifecycle."
            className="text-xl text-white/80 mb-8"
            delay={0.05}
          />
          
          {/* Upload Zone */}
          <Card className={`glass-effect rounded-xl p-6 mb-6 transition-all duration-300 ${
            isDragOver ? 'border-white/50 bg-white/10' : 'border-white/30'
          }`}>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-300 cursor-pointer ${
                isDragOver ? 'border-white/50 bg-white/5' : 'border-white/30'
              } ${isUploading ? 'opacity-50 pointer-events-none' : 'hover:border-white/50'}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleChooseFiles}
            >
              {isUploading ? (
                <Hyperspeed className="mx-auto mb-4" />
              ) : (
                <i className="fas fa-cloud-upload-alt text-4xl mb-4 text-white/60"></i>
              )}
              
              <p className="text-lg font-medium mb-2">
                {isUploading ? 'Processing files...' : 'Drop your project documents here'}
              </p>
              <p className="text-sm text-white/60 mb-4">
                PRD, BRD, Figma files, screenshots, or describe your project
              </p>
              
              <Button
                onClick={handleChooseFiles}
                disabled={isUploading}
                className="bg-white text-primary-600 hover:bg-white/90 transition-colors"
              >
                {isUploading ? 'Processing...' : 'Choose Files'}
              </Button>
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.svg,.json,.zip,.js,.ts,.html,.css"
              onChange={handleFileSelect}
              className="hidden"
            />
          </Card>

          {/* Quick Start Options */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                icon: "fas fa-file-alt",
                title: "Upload PRD/BRD",
                description: "Start with requirements",
                color: "blue"
              },
              {
                icon: "fab fa-figma",
                title: "Import Figma",
                description: "Design to code",
                color: "purple"
              },
              {
                icon: "fas fa-image",
                title: "Screenshot Analysis",
                description: "Reverse engineer",
                color: "green"
              }
            ].map((option, index) => (
              <Button
                key={index}
                variant="ghost"
                className="glass-effect rounded-lg p-4 text-left hover:bg-white/10 transition-colors h-auto flex-col items-start"
              >
                <i className={`${option.icon} text-2xl mb-2 text-${option.color}-300`}></i>
                <h4 className="font-semibold text-white">{option.title}</h4>
                <p className="text-sm text-white/70">{option.description}</p>
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Phase 2 - Visual Design Tools Enhancement
// Principal Engineer & Release Captain Implementation
// Enhanced Canvas Editor with Mobile-First Integration

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { 
  Undo, 
  Redo, 
  ZoomIn, 
  ZoomOut, 
  Save, 
  Download, 
  Share2,
  Layers,
  Grid,
  MousePointer,
  Square,
  Circle,
  Type,
  Image,
  Smartphone,
  Monitor,
  Tablet
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VoiceCommandInterface } from '../mobile/VoiceCommandInterface';
import { TouchGestureHandler } from '../mobile/TouchGestureHandler';

interface CanvasElement {
  id: string;
  type: 'text' | 'shape' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  properties: Record<string, any>;
  layer: number;
}

interface CanvasState {
  elements: CanvasElement[];
  zoom: number;
  pan: { x: number; y: number };
  selectedElements: string[];
  history: CanvasElement[][];
  historyIndex: number;
}

interface EnhancedCanvasEditorProps {
  initialCanvas?: CanvasState;
  onSave?: (canvas: CanvasState) => void;
  className?: string;
  mobileOptimized?: boolean;
}

export const EnhancedCanvasEditor: React.FC<EnhancedCanvasEditorProps> = ({
  initialCanvas,
  onSave,
  className,
  mobileOptimized = false
}) => {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<CanvasState>({
    elements: [],
    zoom: 1,
    pan: { x: 0, y: 0 },
    selectedElements: [],
    history: [[]],
    historyIndex: 0,
    ...initialCanvas
  });
  
  const [tool, setTool] = useState<'select' | 'text' | 'rectangle' | 'circle' | 'image'>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [viewport, setViewport] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');

  // Voice command handler
  const handleVoiceCommand = useCallback((command: string, confidence: number) => {
    if (confidence < 0.7) return;
    
    const lowerCommand = command.toLowerCase();
    
    if (lowerCommand.includes('add text')) {
      setTool('text');
      toast({ title: 'Voice Command', description: 'Text tool activated' });
    } else if (lowerCommand.includes('add shape') || lowerCommand.includes('rectangle')) {
      setTool('rectangle');
      toast({ title: 'Voice Command', description: 'Rectangle tool activated' });
    } else if (lowerCommand.includes('circle')) {
      setTool('circle');
      toast({ title: 'Voice Command', description: 'Circle tool activated' });
    } else if (lowerCommand.includes('undo')) {
      handleUndo();
    } else if (lowerCommand.includes('redo')) {
      handleRedo();
    } else if (lowerCommand.includes('save')) {
      handleSave();
    } else if (lowerCommand.includes('zoom in')) {
      handleZoom(0.1);
    } else if (lowerCommand.includes('zoom out')) {
      handleZoom(-0.1);
    } else if (lowerCommand.includes('mobile view')) {
      setViewport('mobile');
      toast({ title: 'Voice Command', description: 'Switched to mobile view' });
    } else if (lowerCommand.includes('desktop view')) {
      setViewport('desktop');
      toast({ title: 'Voice Command', description: 'Switched to desktop view' });
    }
  }, []);

  // Touch gesture handlers
  const handleSwipeLeft = useCallback(() => {
    if (mobileOptimized) {
      // Next tool
      const tools = ['select', 'text', 'rectangle', 'circle', 'image'] as const;
      const currentIndex = tools.indexOf(tool);
      const nextTool = tools[(currentIndex + 1) % tools.length];
      setTool(nextTool);
      toast({ title: 'Gesture', description: `Switched to ${nextTool} tool` });
    }
  }, [tool, mobileOptimized]);

  const handleSwipeRight = useCallback(() => {
    if (mobileOptimized) {
      // Previous tool
      const tools = ['select', 'text', 'rectangle', 'circle', 'image'] as const;
      const currentIndex = tools.indexOf(tool);
      const prevTool = tools[(currentIndex - 1 + tools.length) % tools.length];
      setTool(prevTool);
      toast({ title: 'Gesture', description: `Switched to ${prevTool} tool` });
    }
  }, [tool, mobileOptimized]);

  const handlePinchZoom = useCallback((scale: number) => {
    setCanvas(prev => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(5, prev.zoom * scale))
    }));
  }, []);

  const handleLongPress = useCallback(() => {
    if (canvas.selectedElements.length > 0) {
      // Show context menu or properties panel
      toast({ title: 'Long Press', description: 'Element properties available' });
    }
  }, [canvas.selectedElements]);

  // Canvas operations
  const addToHistory = useCallback((newElements: CanvasElement[]) => {
    setCanvas(prev => {
      const newHistory = prev.history.slice(0, prev.historyIndex + 1);
      newHistory.push([...newElements]);
      
      return {
        ...prev,
        elements: [...newElements],
        history: newHistory,
        historyIndex: newHistory.length - 1
      };
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (canvas.historyIndex > 0) {
      const newIndex = canvas.historyIndex - 1;
      setCanvas(prev => ({
        ...prev,
        elements: [...prev.history[newIndex]],
        historyIndex: newIndex
      }));
      toast({ title: 'Undo', description: 'Last action undone' });
    }
  }, [canvas.historyIndex, canvas.history]);

  const handleRedo = useCallback(() => {
    if (canvas.historyIndex < canvas.history.length - 1) {
      const newIndex = canvas.historyIndex + 1;
      setCanvas(prev => ({
        ...prev,
        elements: [...prev.history[newIndex]],
        historyIndex: newIndex
      }));
      toast({ title: 'Redo', description: 'Action redone' });
    }
  }, [canvas.historyIndex, canvas.history]);

  const handleZoom = useCallback((delta: number) => {
    setCanvas(prev => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(5, prev.zoom + delta))
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave?.(canvas);
    toast({ title: 'Saved', description: 'Canvas saved successfully' });
  }, [canvas, onSave]);

  // Canvas drawing logic
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'select') return;
    
    setIsDrawing(true);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = (e.clientX - rect.left - canvas.pan.x) / canvas.zoom;
    const y = (e.clientY - rect.top - canvas.pan.y) / canvas.zoom;

    const newElement: CanvasElement = {
      id: `element-${Date.now()}`,
      type: tool === 'text' ? 'text' : 'shape',
      x,
      y,
      width: tool === 'text' ? 100 : 0,
      height: tool === 'text' ? 30 : 0,
      rotation: 0,
      layer: canvas.elements.length,
      properties: {
        ...(tool === 'text' && { text: 'New Text', fontSize: 16, color: '#000000' }),
        ...(tool === 'rectangle' && { fill: '#3B82F6', stroke: '#1E40AF', strokeWidth: 1 }),
        ...(tool === 'circle' && { fill: '#EF4444', stroke: '#DC2626', strokeWidth: 1, shape: 'circle' })
      }
    };

    const newElements = [...canvas.elements, newElement];
    addToHistory(newElements);
  }, [tool, canvas, addToHistory]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || tool === 'select' || tool === 'text') return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const currentX = (e.clientX - rect.left - canvas.pan.x) / canvas.zoom;
    const currentY = (e.clientY - rect.top - canvas.pan.y) / canvas.zoom;

    setCanvas(prev => {
      const newElements = [...prev.elements];
      const lastElement = newElements[newElements.length - 1];
      
      if (lastElement) {
        lastElement.width = Math.abs(currentX - lastElement.x);
        lastElement.height = Math.abs(currentY - lastElement.y);
      }
      
      return { ...prev, elements: newElements };
    });
  }, [isDrawing, tool, canvas.pan, canvas.zoom]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // Get viewport dimensions for responsive design
  const getViewportDimensions = () => {
    switch (viewport) {
      case 'mobile': return { width: 375, height: 667 };
      case 'tablet': return { width: 768, height: 1024 };
      case 'desktop': return { width: 1200, height: 800 };
    }
  };

  const viewportDims = getViewportDimensions();

  return (
    <TouchGestureHandler
      enabled={mobileOptimized}
      onSwipeLeft={handleSwipeLeft}
      onSwipeRight={handleSwipeRight}
      onPinch={handlePinchZoom}
      onLongPress={handleLongPress}
      className={cn('w-full h-full', className)}
    >
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between p-2 bg-white dark:bg-gray-900 border-b">
          <div className="flex items-center space-x-2">
            {/* Tools */}
            <Button
              variant={tool === 'select' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('select')}
            >
              <MousePointer className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'text' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('text')}
            >
              <Type className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'rectangle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('rectangle')}
            >
              <Square className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'circle' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('circle')}
            >
              <Circle className="w-4 h-4" />
            </Button>
            <Button
              variant={tool === 'image' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTool('image')}
            >
              <Image className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center space-x-2">
            {/* History */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={canvas.historyIndex <= 0}
            >
              <Undo className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRedo}
              disabled={canvas.historyIndex >= canvas.history.length - 1}
            >
              <Redo className="w-4 h-4" />
            </Button>

            {/* Zoom */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleZoom(-0.1)}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
            <span className="text-sm px-2">{Math.round(canvas.zoom * 100)}%</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleZoom(0.1)}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>

            {/* Viewport */}
            <Button
              variant={viewport === 'mobile' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewport('mobile')}
            >
              <Smartphone className="w-4 h-4" />
            </Button>
            <Button
              variant={viewport === 'tablet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewport('tablet')}
            >
              <Tablet className="w-4 h-4" />
            </Button>
            <Button
              variant={viewport === 'desktop' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewport('desktop')}
            >
              <Monitor className="w-4 h-4" />
            </Button>

            {/* Actions */}
            <Button variant="outline" size="sm" onClick={handleSave}>
              <Save className="w-4 h-4" />
            </Button>

            {/* Voice toggle */}
            {mobileOptimized && (
              <Button
                variant={voiceEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setVoiceEnabled(!voiceEnabled)}
              >
                Voice
              </Button>
            )}
          </div>
        </div>

        {/* Voice Interface */}
        {voiceEnabled && mobileOptimized && (
          <VoiceCommandInterface
            isActive={voiceEnabled}
            onToggle={setVoiceEnabled}
            onVoiceCommand={handleVoiceCommand}
            className="border-b"
          />
        )}

        {/* Canvas Area */}
        <div className="flex-1 overflow-hidden bg-gray-100 dark:bg-gray-800 relative">
          <div 
            className="absolute inset-0"
            style={{
              transform: `translate(${canvas.pan.x}px, ${canvas.pan.y}px) scale(${canvas.zoom})`
            }}
          >
            <canvas
              ref={canvasRef}
              width={viewportDims.width}
              height={viewportDims.height}
              className="bg-white dark:bg-gray-900 shadow-lg mx-auto mt-8 border"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
          </div>

          {/* Status bar */}
          <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-900 px-3 py-1 rounded shadow text-sm">
            {canvas.elements.length} elements • {viewport} view • {Math.round(canvas.zoom * 100)}%
          </div>
        </div>
      </div>
    </TouchGestureHandler>
  );
};

export default EnhancedCanvasEditor;
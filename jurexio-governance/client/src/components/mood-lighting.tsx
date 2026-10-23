/**
 * Creative Project Mood Lighting Interface
 * Atmospheric lighting controls for enhanced creative workflow experience
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Lightbulb, 
  Palette, 
  Zap, 
  Moon, 
  Sun, 
  Sunset, 
  Eye,
  Play,
  Pause,
  RotateCcw,
  Settings,
  Sparkles,
  Focus,
  Brain,
  Coffee,
  Music
} from 'lucide-react';

interface MoodPreset {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  brightness: number;
  saturation: number;
  warmth: number;
  animation: 'static' | 'pulse' | 'breathe' | 'wave' | 'sparkle';
  animationSpeed: number;
}

interface MoodLightingProps {
  isVisible: boolean;
  onToggle: () => void;
  currentProject?: string;
}

const moodPresets: MoodPreset[] = [
  {
    id: 'focus',
    name: 'Deep Focus',
    description: 'Blue-white light for concentration',
    icon: <Focus className="w-4 h-4" />,
    colors: {
      primary: '#3b82f6',
      secondary: '#1e40af',
      accent: '#60a5fa',
      background: '#1e3a8a'
    },
    brightness: 85,
    saturation: 70,
    warmth: 20,
    animation: 'pulse',
    animationSpeed: 3
  },
  {
    id: 'creative',
    name: 'Creative Flow',
    description: 'Dynamic rainbow for inspiration',
    icon: <Sparkles className="w-4 h-4" />,
    colors: {
      primary: '#8b5cf6',
      secondary: '#ec4899',
      accent: '#06d6a0',
      background: '#7c3aed'
    },
    brightness: 90,
    saturation: 95,
    warmth: 50,
    animation: 'wave',
    animationSpeed: 2
  },
  {
    id: 'calm',
    name: 'Zen Mode',
    description: 'Soft green for relaxation',
    icon: <Moon className="w-4 h-4" />,
    colors: {
      primary: '#10b981',
      secondary: '#059669',
      accent: '#34d399',
      background: '#064e3b'
    },
    brightness: 60,
    saturation: 60,
    warmth: 40,
    animation: 'breathe',
    animationSpeed: 4
  },
  {
    id: 'energetic',
    name: 'High Energy',
    description: 'Warm orange for motivation',
    icon: <Zap className="w-4 h-4" />,
    colors: {
      primary: '#f59e0b',
      secondary: '#d97706',
      accent: '#fbbf24',
      background: '#92400e'
    },
    brightness: 95,
    saturation: 85,
    warmth: 80,
    animation: 'sparkle',
    animationSpeed: 1.5
  },
  {
    id: 'coding',
    name: 'Code Zone',
    description: 'Cool purple for development',
    icon: <Brain className="w-4 h-4" />,
    colors: {
      primary: '#6366f1',
      secondary: '#4f46e5',
      accent: '#818cf8',
      background: '#312e81'
    },
    brightness: 75,
    saturation: 80,
    warmth: 30,
    animation: 'pulse',
    animationSpeed: 2.5
  },
  {
    id: 'sunset',
    name: 'Golden Hour',
    description: 'Warm sunset tones',
    icon: <Sunset className="w-4 h-4" />,
    colors: {
      primary: '#f97316',
      secondary: '#ea580c',
      accent: '#fb923c',
      background: '#9a3412'
    },
    brightness: 80,
    saturation: 75,
    warmth: 90,
    animation: 'wave',
    animationSpeed: 3
  }
];

export default function MoodLighting({ isVisible, onToggle, currentProject }: MoodLightingProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<MoodPreset>(moodPresets[0]);
  const [customBrightness, setCustomBrightness] = useState(80);
  const [customSaturation, setCustomSaturation] = useState(70);
  const [customWarmth, setCustomWarmth] = useState(50);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adaptiveMode, setAdaptiveMode] = useState(false);

  // Apply mood lighting to the interface
  useEffect(() => {
    if (isEnabled && isVisible) {
      const root = document.documentElement;
      const preset = selectedPreset;
      
      // Apply CSS custom properties for mood lighting
      root.style.setProperty('--mood-primary', preset.colors.primary);
      root.style.setProperty('--mood-secondary', preset.colors.secondary);
      root.style.setProperty('--mood-accent', preset.colors.accent);
      root.style.setProperty('--mood-background', preset.colors.background);
      root.style.setProperty('--mood-brightness', `${customBrightness}%`);
      root.style.setProperty('--mood-saturation', `${customSaturation}%`);
      root.style.setProperty('--mood-warmth', `${customWarmth}%`);
      
      // Add mood lighting class to body
      document.body.classList.add('mood-lighting-active');
      
      // Apply animation if playing
      if (isPlaying) {
        document.body.classList.add(`mood-animation-${preset.animation}`);
      } else {
        document.body.classList.remove(`mood-animation-${preset.animation}`);
      }
    } else {
      // Remove mood lighting
      document.body.classList.remove('mood-lighting-active');
      moodPresets.forEach(preset => {
        document.body.classList.remove(`mood-animation-${preset.animation}`);
      });
    }

    return () => {
      document.body.classList.remove('mood-lighting-active');
      moodPresets.forEach(preset => {
        document.body.classList.remove(`mood-animation-${preset.animation}`);
      });
    };
  }, [isEnabled, isVisible, selectedPreset, customBrightness, customSaturation, customWarmth, isPlaying]);

  // Adaptive mood based on time of day
  useEffect(() => {
    if (adaptiveMode) {
      const hour = new Date().getHours();
      let adaptivePreset;
      
      if (hour >= 6 && hour < 12) {
        adaptivePreset = moodPresets.find(p => p.id === 'energetic') || moodPresets[0];
      } else if (hour >= 12 && hour < 17) {
        adaptivePreset = moodPresets.find(p => p.id === 'focus') || moodPresets[0];
      } else if (hour >= 17 && hour < 21) {
        adaptivePreset = moodPresets.find(p => p.id === 'sunset') || moodPresets[0];
      } else {
        adaptivePreset = moodPresets.find(p => p.id === 'calm') || moodPresets[0];
      }
      
      setSelectedPreset(adaptivePreset);
    }
  }, [adaptiveMode]);

  const handlePresetSelect = (preset: MoodPreset) => {
    setSelectedPreset(preset);
    setCustomBrightness(preset.brightness);
    setCustomSaturation(preset.saturation);
    setCustomWarmth(preset.warmth);
  };

  const resetToDefaults = () => {
    setSelectedPreset(moodPresets[0]);
    setCustomBrightness(80);
    setCustomSaturation(70);
    setCustomWarmth(50);
    setIsPlaying(false);
  };

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed top-4 right-4 z-50 w-80"
    >
      <Card className="border-2 shadow-2xl backdrop-blur-md bg-white/95 dark:bg-gray-900/95">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Lightbulb className={`w-5 h-5 ${isEnabled ? 'text-yellow-500' : 'text-gray-400'}`} />
              <CardTitle className="text-lg">Mood Lighting</CardTitle>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggle}
                className="w-8 h-8 p-0"
              >
                <Eye className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {currentProject && (
            <Badge variant="secondary" className="w-fit text-xs">
              Project: {currentProject}
            </Badge>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Adaptive Mode Toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center space-x-2">
              <Sun className="w-4 h-4" />
              <span>Adaptive Mode</span>
            </Label>
            <Switch
              checked={adaptiveMode}
              onCheckedChange={setAdaptiveMode}
              disabled={!isEnabled}
            />
          </div>

          {/* Mood Presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mood Presets</Label>
            <div className="grid grid-cols-2 gap-2">
              {moodPresets.map((preset) => (
                <motion.button
                  key={preset.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handlePresetSelect(preset)}
                  disabled={!isEnabled || adaptiveMode}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    selectedPreset.id === preset.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  } ${(!isEnabled || adaptiveMode) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center space-x-2 mb-1">
                    {preset.icon}
                    <span className="font-medium text-sm">{preset.name}</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {preset.description}
                  </p>
                  <div className="flex space-x-1 mt-2">
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: preset.colors.primary }}
                    />
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: preset.colors.secondary }}
                    />
                    <div 
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: preset.colors.accent }}
                    />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>

          {/* Animation Controls */}
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center space-x-2">
              <Music className="w-4 h-4" />
              <span>Animation</span>
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={!isEnabled}
              className="w-20"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3 h-3 mr-1" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 mr-1" />
                  Play
                </>
              )}
            </Button>
          </div>

          {/* Advanced Controls */}
          <div className="space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={!isEnabled}
              className="w-full justify-start"
            >
              <Settings className="w-4 h-4 mr-2" />
              Advanced Controls
            </Button>

            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3"
                >
                  {/* Brightness Control */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm">Brightness</Label>
                      <span className="text-sm text-gray-500">{customBrightness}%</span>
                    </div>
                    <Slider
                      value={[customBrightness]}
                      onValueChange={(value) => setCustomBrightness(value[0])}
                      max={100}
                      step={5}
                      disabled={!isEnabled || adaptiveMode}
                      className="w-full"
                    />
                  </div>

                  {/* Saturation Control */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm">Saturation</Label>
                      <span className="text-sm text-gray-500">{customSaturation}%</span>
                    </div>
                    <Slider
                      value={[customSaturation]}
                      onValueChange={(value) => setCustomSaturation(value[0])}
                      max={100}
                      step={5}
                      disabled={!isEnabled || adaptiveMode}
                      className="w-full"
                    />
                  </div>

                  {/* Warmth Control */}
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label className="text-sm">Warmth</Label>
                      <span className="text-sm text-gray-500">{customWarmth}%</span>
                    </div>
                    <Slider
                      value={[customWarmth]}
                      onValueChange={(value) => setCustomWarmth(value[0])}
                      max={100}
                      step={5}
                      disabled={!isEnabled || adaptiveMode}
                      className="w-full"
                    />
                  </div>

                  {/* Reset Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetToDefaults}
                    disabled={!isEnabled}
                    className="w-full"
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reset to Defaults
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
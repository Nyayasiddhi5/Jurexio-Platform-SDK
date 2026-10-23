import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  Mic, Volume2, Play, Pause, Download, Upload, Settings, 
  Waves, Music, Globe, Languages, Clock, Zap, 
  FileAudio, Copy, RotateCcw, Save, Share2
} from 'lucide-react';

interface VoiceConfig {
  provider: 'elevenlabs' | 'azure' | 'google' | 'openai' | 'local';
  voiceId: string;
  language: string;
  accent: string;
  speed: number;
  pitch: number;
  emotion: string;
  stability: number;
  clarity: number;
  style: string;
}

interface VoiceSample {
  id: string;
  text: string;
  audioUrl: string;
  config: VoiceConfig;
  duration: number;
  createdAt: string;
  language: string;
}

interface VoiceSynthesisPanelProps {
  onVoiceGenerated?: (sample: VoiceSample) => void;
  initialText?: string;
  mode?: 'full' | 'compact';
}

export default function VoiceSynthesisPanel({ onVoiceGenerated, initialText = '', mode = 'full' }: VoiceSynthesisPanelProps) {
  const { toast } = useToast();
  const [text, setText] = useState(initialText);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [voiceSamples, setVoiceSamples] = useState<VoiceSample[]>([]);
  const [activeTab, setActiveTab] = useState('generate');
  const audioContextRef = useRef<AudioContext | null>(null);

  const [config, setConfig] = useState<VoiceConfig>({
    provider: 'elevenlabs',
    voiceId: 'bella',
    language: 'en-US',
    accent: 'american',
    speed: 1.0,
    pitch: 1.0,
    emotion: 'neutral',
    stability: 0.8,
    clarity: 0.9,
    style: 'conversational'
  });

  // Voice providers and their available voices
  const voiceProviders = {
    elevenlabs: {
      name: 'ElevenLabs',
      description: 'Premium AI voice synthesis',
      voices: [
        { id: 'bella', name: 'Bella', description: 'Young American female', accent: 'american' },
        { id: 'adam', name: 'Adam', description: 'Deep American male', accent: 'american' },
        { id: 'charlie', name: 'Charlie', description: 'Australian male', accent: 'australian' },
        { id: 'emily', name: 'Emily', description: 'British female', accent: 'british' },
        { id: 'george', name: 'George', description: 'Professional British male', accent: 'british' }
      ]
    },
    azure: {
      name: 'Azure Speech',
      description: 'Microsoft Azure TTS',
      voices: [
        { id: 'en-US-JennyNeural', name: 'Jenny', description: 'US English female', accent: 'american' },
        { id: 'en-US-GuyNeural', name: 'Guy', description: 'US English male', accent: 'american' },
        { id: 'en-GB-SoniaNeural', name: 'Sonia', description: 'British English female', accent: 'british' },
        { id: 'hi-IN-SwaraNeural', name: 'Swara', description: 'Hindi female', accent: 'indian' }
      ]
    },
    google: {
      name: 'Google TTS',
      description: 'Google Text-to-Speech',
      voices: [
        { id: 'en-US-Standard-A', name: 'Standard A', description: 'US English female', accent: 'american' },
        { id: 'en-US-Standard-B', name: 'Standard B', description: 'US English male', accent: 'american' },
        { id: 'en-GB-Standard-A', name: 'UK Standard A', description: 'British English female', accent: 'british' }
      ]
    },
    openai: {
      name: 'OpenAI TTS',
      description: 'OpenAI Text-to-Speech',
      voices: [
        { id: 'alloy', name: 'Alloy', description: 'Balanced voice', accent: 'neutral' },
        { id: 'echo', name: 'Echo', description: 'Clear male voice', accent: 'american' },
        { id: 'fable', name: 'Fable', description: 'Expressive female', accent: 'british' },
        { id: 'onyx', name: 'Onyx', description: 'Deep male voice', accent: 'american' },
        { id: 'nova', name: 'Nova', description: 'Young female voice', accent: 'american' },
        { id: 'shimmer', name: 'Shimmer', description: 'Soft female voice', accent: 'american' }
      ]
    },
    local: {
      name: 'Local TTS',
      description: 'Local Text-to-Speech',
      voices: [
        { id: 'default', name: 'Default', description: 'System default voice', accent: 'neutral' },
        { id: 'male', name: 'Male', description: 'Local male voice', accent: 'neutral' },
        { id: 'female', name: 'Female', description: 'Local female voice', accent: 'neutral' }
      ]
    }
  };

  const languages = [
    { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
    { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
    { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
    { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
    { code: 'de-DE', name: 'German', flag: '🇩🇪' },
    { code: 'it-IT', name: 'Italian', flag: '🇮🇹' },
    { code: 'pt-BR', name: 'Portuguese', flag: '🇧🇷' },
    { code: 'hi-IN', name: 'Hindi', flag: '🇮🇳' },
    { code: 'zh-CN', name: 'Chinese', flag: '🇨🇳' },
    { code: 'ja-JP', name: 'Japanese', flag: '🇯🇵' },
    { code: 'ko-KR', name: 'Korean', flag: '🇰🇷' },
    { code: 'ar-SA', name: 'Arabic', flag: '🇸🇦' }
  ];

  const emotions = [
    'neutral', 'happy', 'sad', 'angry', 'excited', 'calm', 'professional', 'friendly'
  ];

  const styles = [
    'conversational', 'newscaster', 'customerservice', 'assistant', 'chat', 'cheerful', 'empathetic'
  ];

  const updateConfig = (field: keyof VoiceConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const generateVoice = async () => {
    if (!text.trim()) {
      toast({
        title: "Text Required",
        description: "Please enter text to synthesize",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setGenerationProgress(prev => {
          if (prev >= 95) {
            clearInterval(progressInterval);
            return 95;
          }
          return prev + Math.random() * 20;
        });
      }, 200);

      const response = await apiRequest('/api/voice-synthesis/generate', {
        method: 'POST',
        body: JSON.stringify({
          text: text,
          config: config,
          format: 'mp3',
          quality: 'high'
        })
      });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      if (response.success) {
        const newSample: VoiceSample = {
          id: Date.now().toString(),
          text: text,
          audioUrl: response.data.audioUrl,
          config: config,
          duration: response.data.duration || 0,
          createdAt: new Date().toISOString(),
          language: config.language
        };

        setVoiceSamples(prev => [newSample, ...prev]);
        
        toast({
          title: "Voice Generated Successfully",
          description: `Generated ${response.data.duration}s of audio`
        });

        if (onVoiceGenerated) {
          onVoiceGenerated(newSample);
        }

        // Auto-play the generated audio
        playAudio(newSample.audioUrl);
      }
    } catch (error: any) {
      toast({
        title: "Voice Generation Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
    }
  };

  const playAudio = (audioUrl: string) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }

    const audio = new Audio(audioUrl);
    audio.onloadstart = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => {
      setIsPlaying(false);
      toast({
        title: "Playback Error",
        description: "Failed to play audio",
        variant: "destructive"
      });
    };

    setCurrentAudio(audio);
    audio.play();
  };

  const stopAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setIsPlaying(false);
    }
  };

  const downloadAudio = async (audioUrl: string, filename: string) => {
    try {
      const response = await fetch(audioUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Download Started",
        description: "Audio file is being downloaded"
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download audio file",
        variant: "destructive"
      });
    }
  };

  const currentProvider = voiceProviders[config.provider];
  const selectedLanguage = languages.find(lang => lang.code === config.language);

  if (mode === 'compact') {
    return (
      <Card className="w-full">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-purple-600" />
            <span className="font-medium">Voice Synthesis</span>
            <Badge variant="secondary">{currentProvider.name}</Badge>
          </div>
          
          <Textarea
            placeholder="Enter text to synthesize..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />

          <div className="flex gap-2">
            <Button 
              onClick={generateVoice} 
              disabled={isGenerating || !text.trim()}
              className="flex-1"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>

            {isPlaying ? (
              <Button variant="outline" onClick={stopAudio}>
                <Pause className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="outline" disabled={voiceSamples.length === 0}>
                <Play className="h-4 w-4" />
              </Button>
            )}
          </div>

          {isGenerating && (
            <Progress value={generationProgress} className="w-full" />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Voice Synthesis Engine
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Generate high-quality voice samples with advanced AI
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-2">
            <Languages className="h-4 w-4" />
            17+ Languages
          </Badge>
          <Badge variant="secondary" className="gap-2">
            <Zap className="h-4 w-4" />
            5 Providers
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Text Input */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileAudio className="h-5 w-5" />
                    Text to Synthesize
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    placeholder="Enter the text you want to convert to speech..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={8}
                    className="resize-none"
                  />
                  <div className="flex items-center justify-between mt-2 text-sm text-gray-500">
                    <span>{text.length} characters</span>
                    <span>~{Math.ceil(text.length * 0.1)}s estimated duration</span>
                  </div>
                </CardContent>
              </Card>

              {/* Generation Controls */}
              <Card>
                <CardContent className="p-4">
                  {isGenerating && (
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span>Generating voice...</span>
                        <span>{Math.round(generationProgress)}%</span>
                      </div>
                      <Progress value={generationProgress} className="w-full" />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button 
                      onClick={generateVoice} 
                      disabled={isGenerating || !text.trim()}
                      className="flex-1"
                      size="lg"
                    >
                      {isGenerating ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Mic className="h-4 w-4 mr-2" />
                          Generate Voice
                        </>
                      )}
                    </Button>

                    {voiceSamples.length > 0 && (
                      <>
                        {isPlaying ? (
                          <Button variant="outline" onClick={stopAudio}>
                            <Pause className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button 
                            variant="outline" 
                            onClick={() => playAudio(voiceSamples[0].audioUrl)}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        )}

                        <Button 
                          variant="outline"
                          onClick={() => downloadAudio(voiceSamples[0].audioUrl, 'voice-sample.mp3')}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Voice Configuration */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Voice Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Provider</Label>
                    <Select value={config.provider} onValueChange={(value: any) => updateConfig('provider', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(voiceProviders).map(([key, provider]) => (
                          <SelectItem key={key} value={key}>
                            {provider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Language {selectedLanguage?.flag}</Label>
                    <Select value={config.language} onValueChange={(value) => updateConfig('language', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {languages.map(lang => (
                          <SelectItem key={lang.code} value={lang.code}>
                            {lang.flag} {lang.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Voice</Label>
                    <Select value={config.voiceId} onValueChange={(value) => updateConfig('voiceId', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {currentProvider.voices.map((voice: { id: string; name: string; description: string; accent: string }) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            {voice.name} - {voice.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Speed: {config.speed}x</Label>
                    <Slider
                      value={[config.speed]}
                      onValueChange={([value]) => updateConfig('speed', value)}
                      max={2.0}
                      min={0.5}
                      step={0.1}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label>Stability: {config.stability}</Label>
                    <Slider
                      value={[config.stability]}
                      onValueChange={([value]) => updateConfig('stability', value)}
                      max={1.0}
                      min={0.0}
                      step={0.1}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label>Emotion</Label>
                    <Select value={config.emotion} onValueChange={(value) => updateConfig('emotion', value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {emotions.map(emotion => (
                          <SelectItem key={emotion} value={emotion}>
                            {emotion.charAt(0).toUpperCase() + emotion.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold">Voice Samples Library</h4>
            <Badge variant="outline">{voiceSamples.length} samples</Badge>
          </div>

          {voiceSamples.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Music className="h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500 text-center">No voice samples yet</p>
                <p className="text-sm text-gray-400 text-center">Generate your first voice sample to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {voiceSamples.map((sample) => (
                <Card key={sample.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium line-clamp-2 mb-2">{sample.text}</p>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Badge variant="outline" className="text-xs">
                            {sample.config.provider}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {sample.language}
                          </Badge>
                          <span>•</span>
                          <Clock className="h-3 w-3" />
                          <span>{sample.duration}s</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => playAudio(sample.audioUrl)}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadAudio(sample.audioUrl, `voice-${sample.id}.mp3`)}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
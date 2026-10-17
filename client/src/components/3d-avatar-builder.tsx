import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { 
  User, Camera, Mic, Play, Pause, Download, Upload, Settings, 
  Eye, Palette, Sparkles, Zap, Globe, Volume2, Gamepad2,
  Monitor, Smartphone, Headphones, Layers, Box, Wand2
} from 'lucide-react';

interface Avatar3DConfig {
  appearance: {
    gender: 'male' | 'female' | 'non-binary';
    ethnicity: string;
    age: number;
    hairStyle: string;
    hairColor: string;
    eyeColor: string;
    skinTone: string;
    bodyType: string;
    height: number;
    clothing: string;
    accessories: string[];
  };
  personality: {
    tone: string;
    energy: number;
    formality: number;
    expressiveness: number;
    gestures: boolean;
    facialExpressions: boolean;
  };
  voice: {
    provider: 'elevenlabs' | 'azure' | 'google' | 'openai';
    voiceId: string;
    language: string;
    accent: string;
    speed: number;
    pitch: number;
    stability: number;
    clarity: number;
  };
  immersive: {
    platform: 'web3d' | 'vr' | 'ar' | 'mobile';
    quality: 'low' | 'medium' | 'high' | 'ultra';
    interactivity: boolean;
    spatialAudio: boolean;
    handTracking: boolean;
    eyeTracking: boolean;
  };
  cultural: {
    region: string;
    language: string;
    customGreetings: string[];
    culturalGestures: boolean;
    localKnowledge: boolean;
  };
}

interface Avatar3DBuilderProps {
  onAvatarCreated?: (avatar: any) => void;
  initialConfig?: Partial<Avatar3DConfig>;
}

export default function Avatar3DBuilder({ onAvatarCreated, initialConfig }: Avatar3DBuilderProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('appearance');
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState(0);
  const [previewMode, setPreviewMode] = useState<'3d' | 'ar' | 'vr'>('3d');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<Avatar3DConfig>({
    appearance: {
      gender: 'female',
      ethnicity: 'mixed',
      age: 25,
      hairStyle: 'long-wavy',
      hairColor: 'brown',
      eyeColor: 'brown',
      skinTone: 'medium',
      bodyType: 'average',
      height: 165,
      clothing: 'business-casual',
      accessories: []
    },
    personality: {
      tone: 'friendly',
      energy: 70,
      formality: 50,
      expressiveness: 80,
      gestures: true,
      facialExpressions: true
    },
    voice: {
      provider: 'elevenlabs',
      voiceId: 'bella',
      language: 'en-US',
      accent: 'american',
      speed: 1.0,
      pitch: 1.0,
      stability: 0.8,
      clarity: 0.9
    },
    immersive: {
      platform: 'web3d',
      quality: 'high',
      interactivity: true,
      spatialAudio: true,
      handTracking: false,
      eyeTracking: false
    },
    cultural: {
      region: 'north-america',
      language: 'english',
      customGreetings: ['Hello!', 'Hi there!', 'Welcome!'],
      culturalGestures: true,
      localKnowledge: true
    },
    ...initialConfig
  });

  const handleConfigUpdate = (section: keyof Avatar3DConfig, field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }));
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Process uploaded image for avatar generation
      const formData = new FormData();
      formData.append('image', file);
      
      toast({
        title: "Processing Image",
        description: "Analyzing your photo to generate avatar features..."
      });

      // Call API to process image and extract features
      apiRequest('/api/3d-avatar/analyze-photo', {
        method: 'POST',
        body: formData
      }).then(response => {
        if (response.success) {
          // Update config with extracted features
          setConfig(prev => ({
            ...prev,
            appearance: {
              ...prev.appearance,
              ...response.data.features
            }
          }));
          
          toast({
            title: "Photo Analyzed",
            description: "Avatar features updated based on your photo!"
          });
        }
      }).catch(error => {
        toast({
          title: "Analysis Failed",
          description: error.message,
          variant: "destructive"
        });
      });
    }
  };

  const generateVoiceSample = async () => {
    try {
      const response = await apiRequest('/api/3d-avatar/voice-sample', {
        method: 'POST',
        body: JSON.stringify({
          text: "Hello! I'm your AI assistant. How can I help you today?",
          voiceConfig: config.voice
        })
      });

      if (response.success && response.data.audioUrl) {
        const audio = new Audio(response.data.audioUrl);
        audio.play();
        
        toast({
          title: "Voice Sample Generated",
          description: "Playing your avatar's voice preview"
        });
      }
    } catch (error: any) {
      toast({
        title: "Voice Generation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const buildAvatar = async () => {
    setIsBuilding(true);
    setBuildProgress(0);

    try {
      // Start avatar building process
      const response = await apiRequest('/api/3d-avatar/build', {
        method: 'POST',
        body: JSON.stringify(config)
      });

      if (response.success) {
        // Simulate progress updates
        const progressInterval = setInterval(() => {
          setBuildProgress(prev => {
            if (prev >= 100) {
              clearInterval(progressInterval);
              setIsBuilding(false);
              
              toast({
                title: "Avatar Created Successfully!",
                description: "Your 3D avatar is ready for deployment"
              });

              if (onAvatarCreated) {
                onAvatarCreated(response.data);
              }
              
              return 100;
            }
            return prev + Math.random() * 15;
          });
        }, 1000);
      }
    } catch (error: any) {
      setIsBuilding(false);
      setBuildProgress(0);
      
      toast({
        title: "Avatar Creation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const ethnicities = [
    'african', 'asian', 'caucasian', 'hispanic', 'indian', 'middle-eastern', 'mixed', 'pacific-islander'
  ];

  const hairStyles = [
    'short', 'medium', 'long-straight', 'long-wavy', 'curly', 'braided', 'pixie', 'bob'
  ];

  const colors = [
    'black', 'brown', 'blonde', 'red', 'gray', 'white', 'blue', 'green'
  ];

  const regions = [
    'north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania', 'middle-east'
  ];

  const languages = [
    'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'chinese', 'japanese', 
    'korean', 'arabic', 'hindi', 'bengali', 'marathi', 'tamil', 'gujarati'
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            3D Avatar Builder
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Create immersive AI assistants with advanced 3D avatars
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-2">
            <Layers className="h-4 w-4" />
            ChatDollKit + EchoMimic
          </Badge>
          <Badge variant="secondary" className="gap-2">
            <Globe className="h-4 w-4" />
            17+ Languages
          </Badge>
        </div>
      </div>

      {/* Main Builder Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
              <TabsTrigger value="personality">Personality</TabsTrigger>
              <TabsTrigger value="voice">Voice</TabsTrigger>
              <TabsTrigger value="immersive">Immersive</TabsTrigger>
              <TabsTrigger value="cultural">Cultural</TabsTrigger>
            </TabsList>

            {/* Appearance Tab */}
            <TabsContent value="appearance" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Physical Appearance
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Gender</Label>
                      <Select 
                        value={config.appearance.gender} 
                        onValueChange={(value: any) => handleConfigUpdate('appearance', 'gender', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                          <SelectItem value="non-binary">Non-binary</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Ethnicity</Label>
                      <Select 
                        value={config.appearance.ethnicity} 
                        onValueChange={(value) => handleConfigUpdate('appearance', 'ethnicity', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ethnicities.map(ethnicity => (
                            <SelectItem key={ethnicity} value={ethnicity}>
                              {ethnicity.charAt(0).toUpperCase() + ethnicity.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Age: {config.appearance.age}</Label>
                    <Slider
                      value={[config.appearance.age]}
                      onValueChange={([value]) => handleConfigUpdate('appearance', 'age', value)}
                      max={80}
                      min={18}
                      step={1}
                      className="mt-2"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Hair Style</Label>
                      <Select 
                        value={config.appearance.hairStyle} 
                        onValueChange={(value) => handleConfigUpdate('appearance', 'hairStyle', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {hairStyles.map(style => (
                            <SelectItem key={style} value={style}>
                              {style.charAt(0).toUpperCase() + style.slice(1).replace('-', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Hair Color</Label>
                      <Select 
                        value={config.appearance.hairColor} 
                        onValueChange={(value) => handleConfigUpdate('appearance', 'hairColor', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {colors.map(color => (
                            <SelectItem key={color} value={color}>
                              {color.charAt(0).toUpperCase() + color.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Upload Photo for Auto-Generation</Label>
                    <div className="mt-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <Button 
                        variant="outline" 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Your Photo
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Voice Tab */}
            <TabsContent value="voice" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mic className="h-5 w-5" />
                    Voice Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Voice Provider</Label>
                      <Select 
                        value={config.voice.provider} 
                        onValueChange={(value: any) => handleConfigUpdate('voice', 'provider', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="elevenlabs">ElevenLabs (Premium)</SelectItem>
                          <SelectItem value="azure">Azure Speech</SelectItem>
                          <SelectItem value="google">Google TTS</SelectItem>
                          <SelectItem value="openai">OpenAI TTS</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Language</Label>
                      <Select 
                        value={config.voice.language} 
                        onValueChange={(value) => handleConfigUpdate('voice', 'language', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {languages.map(lang => (
                            <SelectItem key={lang} value={lang}>
                              {lang.charAt(0).toUpperCase() + lang.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <Label>Voice Speed: {config.voice.speed}</Label>
                      <Slider
                        value={[config.voice.speed]}
                        onValueChange={([value]) => handleConfigUpdate('voice', 'speed', value)}
                        max={2.0}
                        min={0.5}
                        step={0.1}
                        className="mt-2"
                      />
                    </div>

                    <div>
                      <Label>Voice Stability: {config.voice.stability}</Label>
                      <Slider
                        value={[config.voice.stability]}
                        onValueChange={([value]) => handleConfigUpdate('voice', 'stability', value)}
                        max={1.0}
                        min={0.0}
                        step={0.1}
                        className="mt-2"
                      />
                    </div>
                  </div>

                  <Button onClick={generateVoiceSample} className="w-full">
                    <Volume2 className="h-4 w-4 mr-2" />
                    Generate Voice Sample
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cultural Tab */}
            <TabsContent value="cultural" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Cultural Customization
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Region</Label>
                      <Select 
                        value={config.cultural.region} 
                        onValueChange={(value) => handleConfigUpdate('cultural', 'region', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {regions.map(region => (
                            <SelectItem key={region} value={region}>
                              {region.charAt(0).toUpperCase() + region.slice(1).replace('-', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Primary Language</Label>
                      <Select 
                        value={config.cultural.language} 
                        onValueChange={(value) => handleConfigUpdate('cultural', 'language', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {languages.map(lang => (
                            <SelectItem key={lang} value={lang}>
                              {lang.charAt(0).toUpperCase() + lang.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Cultural Gestures</Label>
                      <Switch
                        checked={config.cultural.culturalGestures}
                        onCheckedChange={(checked) => handleConfigUpdate('cultural', 'culturalGestures', checked)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label>Local Knowledge Base</Label>
                      <Switch
                        checked={config.cultural.localKnowledge}
                        onCheckedChange={(checked) => handleConfigUpdate('cultural', 'localKnowledge', checked)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Preview & Build Panel */}
        <div className="space-y-6">
          {/* 3D Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Live Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-square bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900 dark:to-pink-900 rounded-lg flex items-center justify-center mb-4">
                <div className="text-center">
                  <Box className="h-16 w-16 text-purple-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 dark:text-gray-400">3D Avatar Preview</p>
                  <p className="text-xs text-gray-500">Updates in real-time</p>
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <Button 
                  size="sm" 
                  variant={previewMode === '3d' ? 'default' : 'outline'}
                  onClick={() => setPreviewMode('3d')}
                >
                  <Monitor className="h-4 w-4 mr-1" />
                  Web
                </Button>
                <Button 
                  size="sm" 
                  variant={previewMode === 'ar' ? 'default' : 'outline'}
                  onClick={() => setPreviewMode('ar')}
                >
                  <Smartphone className="h-4 w-4 mr-1" />
                  AR
                </Button>
                <Button 
                  size="sm" 
                  variant={previewMode === 'vr' ? 'default' : 'outline'}
                  onClick={() => setPreviewMode('vr')}
                >
                  <Headphones className="h-4 w-4 mr-1" />
                  VR
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Build Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5" />
                Build Avatar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isBuilding && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Building avatar...</span>
                    <span>{Math.round(buildProgress)}%</span>
                  </div>
                  <Progress value={buildProgress} className="w-full" />
                  <p className="text-xs text-gray-500 text-center">
                    {buildProgress < 30 && "Generating 3D model..."}
                    {buildProgress >= 30 && buildProgress < 60 && "Processing voice..."}
                    {buildProgress >= 60 && buildProgress < 90 && "Adding animations..."}
                    {buildProgress >= 90 && "Finalizing build..."}
                  </p>
                </div>
              )}

              <Button 
                onClick={buildAvatar} 
                disabled={isBuilding}
                className="w-full"
                size="lg"
              >
                {isBuilding ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Building...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Create 3D Avatar
                  </>
                )}
              </Button>

              <div className="text-xs text-gray-500 space-y-1">
                <p>• Advanced motion capture with ChatdollKit</p>
                <p>• Realistic lip-sync with EchoMimic V2</p>
                <p>• Multi-platform deployment ready</p>
                <p>• Cultural gesture recognition</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
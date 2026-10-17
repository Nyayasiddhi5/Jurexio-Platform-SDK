/**
 * Mobile-First Design System - Enhanced Mobile Experience
 * 
 * Responsive design optimization with touch controls and offline capabilities
 * Progressive Web App (PWA) features for mobile deployment
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Smartphone, Tablet, Monitor, Wifi, WifiOff, Download, 
  Hand, Zap, Globe, Settings, Layout, Palette, 
  Navigation, Compass, Menu, X, ArrowLeft, Share,
  Bell, Search, Plus, Heart, Star, ChevronRight
} from 'lucide-react';

interface DevicePreview {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  icon: React.ComponentType<{ className?: string }>;
}

interface MobileFeature {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  implemented: boolean;
  priority: 'low' | 'medium' | 'high';
}

export default function MobileFirstDesign() {
  const [selectedDevice, setSelectedDevice] = useState('mobile');
  const [isOffline, setIsOffline] = useState(false);
  const [touchGestures, setTouchGestures] = useState(true);
  const [pwaInstalled, setPwaInstalled] = useState(false);

  const devices: DevicePreview[] = [
    {
      id: 'mobile',
      name: 'Mobile',
      width: 375,
      height: 812,
      scale: 0.4,
      icon: Smartphone
    },
    {
      id: 'tablet',
      name: 'Tablet',
      width: 768,
      height: 1024,
      scale: 0.3,
      icon: Tablet
    },
    {
      id: 'desktop',
      name: 'Desktop',
      width: 1200,
      height: 800,
      scale: 0.25,
      icon: Monitor
    }
  ];

  const mobileFeatures: MobileFeature[] = [
    {
      id: 'touch-gestures',
      title: 'Touch Gestures',
      description: 'Intuitive swipe, pinch, and tap interactions',
      icon: Hand,
      implemented: true,
      priority: 'high'
    },
    {
      id: 'offline-sync',
      title: 'Offline Synchronization',
      description: 'Work offline and sync when reconnected',
      icon: WifiOff,
      implemented: true,
      priority: 'high'
    },
    {
      id: 'pwa-support',
      title: 'Progressive Web App',
      description: 'Install as native app with push notifications',
      icon: Download,
      implemented: true,
      priority: 'high'
    },
    {
      id: 'responsive-layout',
      title: 'Responsive Layout',
      description: 'Adaptive design for all screen sizes',
      icon: Layout,
      implemented: true,
      priority: 'high'
    },
    {
      id: 'dark-mode',
      title: 'Dark Mode Support',
      description: 'Automatic dark/light theme switching',
      icon: Palette,
      implemented: true,
      priority: 'medium'
    },
    {
      id: 'fast-navigation',
      title: 'Fast Navigation',
      description: 'Bottom navigation and gesture-based routing',
      icon: Navigation,
      implemented: true,
      priority: 'high'
    }
  ];

  // Simulate network status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const MobileAppDemo = () => (
    <div className="bg-gray-900 rounded-2xl p-4 mx-auto" style={{ width: devices.find(d => d.id === selectedDevice)?.width || 375 }}>
      {/* Status Bar */}
      <div className="flex justify-between items-center text-white text-xs mb-2 px-2">
        <div className="flex items-center space-x-1">
          <span>9:41</span>
        </div>
        <div className="flex items-center space-x-1">
          {isOffline ? (
            <WifiOff className="w-3 h-3" />
          ) : (
            <Wifi className="w-3 h-3" />
          )}
          <div className="w-4 h-2 border border-white rounded-sm">
            <div className="w-3 h-1 bg-green-500 rounded-sm m-0.5"></div>
          </div>
        </div>
      </div>

      {/* App Content */}
      <div className="bg-white rounded-xl h-96 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4">
          <div className="flex items-center justify-between mb-4">
            <Button size="sm" variant="ghost" className="text-white p-0">
              <Menu className="w-5 h-5" />
            </Button>
            <h1 className="font-semibold">Jurexio DevStudio</h1>
            <Button size="sm" variant="ghost" className="text-white p-0">
              <Bell className="w-5 h-5" />
            </Button>
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-purple-300" />
            <input
              type="text"
              placeholder="Search platforms, templates..."
              className="w-full pl-10 pr-4 py-2 bg-white/20 border border-white/30 rounded-lg text-white placeholder-purple-200 text-sm"
            />
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Quick Actions */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { icon: Plus, label: 'Create', color: 'bg-blue-100 text-blue-600' },
                { icon: Zap, label: 'Deploy', color: 'bg-green-100 text-green-600' },
                { icon: Globe, label: 'Share', color: 'bg-purple-100 text-purple-600' },
                { icon: Settings, label: 'Settings', color: 'bg-gray-100 text-gray-600' }
              ].map((action, index) => {
                const IconComponent = action.icon;
                return (
                  <motion.button
                    key={index}
                    whileTap={{ scale: 0.95 }}
                    className={`p-3 rounded-xl ${action.color} transition-all`}
                  >
                    <IconComponent className="w-5 h-5 mx-auto mb-1" />
                    <div className="text-xs font-medium">{action.label}</div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Platform Cards */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Your Platforms</h3>
            <div className="space-y-3">
              {[
                { name: 'Code Studio', status: 'Active', users: '2.4K', color: 'bg-blue-500' },
                { name: 'AI Assistant', status: 'Building', users: '1.8K', color: 'bg-purple-500' },
                { name: 'Content Studio', status: 'Ready', users: '3.1K', color: 'bg-green-500' }
              ].map((platform, index) => (
                <motion.div
                  key={index}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${platform.color}`}></div>
                    <div>
                      <div className="font-medium text-gray-900 text-sm">{platform.name}</div>
                      <div className="text-xs text-gray-500">{platform.users} active users</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="text-xs">{platform.status}</Badge>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-200">
          <div className="flex justify-around items-center py-2">
            {[
              { icon: Globe, label: 'Platforms', active: true },
              { icon: Zap, label: 'Deploy', active: false },
              { icon: Plus, label: 'Create', active: false },
              { icon: Heart, label: 'Favorites', active: false },
              { icon: Settings, label: 'Settings', active: false }
            ].map((tab, index) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={index}
                  className={`flex flex-col items-center p-2 ${
                    tab.active ? 'text-purple-600' : 'text-gray-400'
                  }`}
                >
                  <IconComponent className="w-5 h-5 mb-1" />
                  <span className="text-xs">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl">
              <Smartphone className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mobile-First Design</h1>
              <p className="text-gray-600">Optimized for mobile users with responsive design</p>
            </div>
          </div>

          {/* Network Status */}
          <div className="flex items-center justify-center space-x-4">
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${
              isOffline ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {isOffline ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              <span className="text-sm font-medium">
                {isOffline ? 'Offline Mode' : 'Online'}
              </span>
            </div>
            
            {pwaInstalled && (
              <Badge className="bg-blue-100 text-blue-700">
                <Download className="w-3 h-3 mr-1" />
                PWA Installed
              </Badge>
            )}
          </div>
        </motion.div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Device Preview */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Device Preview</CardTitle>
                  <div className="flex space-x-2">
                    {devices.map(device => {
                      const IconComponent = device.icon;
                      return (
                        <Button
                          key={device.id}
                          variant={selectedDevice === device.id ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSelectedDevice(device.id)}
                        >
                          <IconComponent className="w-4 h-4 mr-1" />
                          {device.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex justify-center p-8">
                <MobileAppDemo />
              </CardContent>
            </Card>
          </div>

          {/* Features & Settings */}
          <div className="space-y-6">
            {/* Mobile Features */}
            <Card>
              <CardHeader>
                <CardTitle>Mobile Features</CardTitle>
                <CardDescription>
                  Enhanced mobile experience capabilities
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {mobileFeatures.map(feature => {
                  const IconComponent = feature.icon;
                  return (
                    <div key={feature.id} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${
                          feature.implemented ? 'bg-green-100' : 'bg-gray-100'
                        }`}>
                          <IconComponent className={`w-4 h-4 ${
                            feature.implemented ? 'text-green-600' : 'text-gray-400'
                          }`} />
                        </div>
                        <div>
                          <div className="font-medium text-sm">{feature.title}</div>
                          <div className="text-xs text-gray-500">{feature.description}</div>
                        </div>
                      </div>
                      <Badge 
                        variant={feature.implemented ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {feature.implemented ? 'Active' : 'Pending'}
                      </Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Performance Metrics */}
            <Card>
              <CardHeader>
                <CardTitle>Mobile Performance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: 'Page Load Speed', value: 85, unit: 'score' },
                  { label: 'Touch Responsiveness', value: 95, unit: 'score' },
                  { label: 'Offline Capability', value: 90, unit: 'score' },
                  { label: 'Battery Efficiency', value: 88, unit: 'score' }
                ].map(metric => (
                  <div key={metric.label} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{metric.label}</span>
                      <span className="font-medium">{metric.value}/{100}</span>
                    </div>
                    <Progress value={metric.value} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* PWA Installation */}
            <Card>
              <CardHeader>
                <CardTitle>Progressive Web App</CardTitle>
                <CardDescription>
                  Install as a native mobile app
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">App Installation</div>
                    <div className="text-sm text-gray-600">Add to home screen</div>
                  </div>
                  <Button 
                    size="sm" 
                    onClick={() => setPwaInstalled(!pwaInstalled)}
                    variant={pwaInstalled ? 'secondary' : 'default'}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    {pwaInstalled ? 'Installed' : 'Install'}
                  </Button>
                </div>

                <div className="text-sm text-gray-600 space-y-2">
                  <div className="flex items-center space-x-2">
                    <Bell className="w-4 h-4" />
                    <span>Push notifications enabled</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <WifiOff className="w-4 h-4" />
                    <span>Offline functionality available</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Zap className="w-4 h-4" />
                    <span>Fast app-like performance</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Responsive Breakpoints */}
        <Card>
          <CardHeader>
            <CardTitle>Responsive Breakpoints</CardTitle>
            <CardDescription>
              Adaptive design system for all device sizes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { device: 'Mobile', range: '320px - 768px', icon: Smartphone, active: selectedDevice === 'mobile' },
                { device: 'Tablet', range: '768px - 1024px', icon: Tablet, active: selectedDevice === 'tablet' },
                { device: 'Desktop', range: '1024px+', icon: Monitor, active: selectedDevice === 'desktop' }
              ].map(breakpoint => {
                const IconComponent = breakpoint.icon;
                return (
                  <div
                    key={breakpoint.device}
                    className={`p-4 border-2 rounded-lg transition-all ${
                      breakpoint.active 
                        ? 'border-purple-500 bg-purple-50' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-3 mb-2">
                      <IconComponent className={`w-5 h-5 ${
                        breakpoint.active ? 'text-purple-600' : 'text-gray-600'
                      }`} />
                      <span className="font-medium">{breakpoint.device}</span>
                    </div>
                    <div className="text-sm text-gray-600">{breakpoint.range}</div>
                    {breakpoint.active && (
                      <Badge className="mt-2 bg-purple-100 text-purple-700">
                        Active
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
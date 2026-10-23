/**
 * Unified Global Search - AI-Powered Platform Search
 * 
 * Smart search across all platforms with AI-powered suggestions
 * Real Jurexio orchestration for intelligent search results
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Search, Command, Sparkles, ArrowRight, Clock, Star,
  Code, Bot, FileText, Gamepad2, Building, Zap, BookOpen,
  User, Settings, Folder, File, Hash
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface SearchResult {
  id: string;
  title: string;
  description: string;
  type: 'platform' | 'feature' | 'project' | 'template' | 'documentation' | 'command';
  platform: string;
  icon: React.ComponentType<{ className?: string }>;
  url: string;
  relevanceScore: number;
  tags: string[];
  lastUsed?: string;
}

interface SearchSuggestion {
  id: string;
  text: string;
  type: 'quick-action' | 'popular' | 'recent' | 'ai-suggested';
  icon: React.ComponentType<{ className?: string }>;
}

interface UnifiedSearchProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

export default function UnifiedSearch({ isOpen, onClose, onNavigate }: UnifiedSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Initialize suggestions and search history
  useEffect(() => {
    if (isOpen) {
      loadSuggestions();
      loadSearchHistory();
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Perform search with AI enhancement
  useEffect(() => {
    if (query.length > 0) {
      const searchTimeout = setTimeout(performSearch, 300);
      return () => clearTimeout(searchTimeout);
    } else {
      setResults([]);
      loadSuggestions();
    }
  }, [query]);

  const loadSuggestions = async () => {
    try {
      // Quick actions and popular searches
      const quickSuggestions: SearchSuggestion[] = [
        {
          id: 'create-project',
          text: 'Create new project',
          type: 'quick-action',
          icon: Zap
        },
        {
          id: 'ai-assistant',
          text: 'Build AI assistant',
          type: 'popular',
          icon: Bot
        },
        {
          id: 'deploy-app',
          text: 'Deploy application',
          type: 'quick-action',
          icon: ArrowRight
        },
        {
          id: 'content-generation',
          text: 'Generate content',
          type: 'popular',
          icon: FileText
        },
        {
          id: 'game-development',
          text: 'Create game',
          type: 'popular',
          icon: Gamepad2
        }
      ];

      setSuggestions(quickSuggestions);

      // Get AI-powered suggestions based on user behavior
      try {
        const response = await apiRequest('/api/search/suggestions', {
          method: 'GET'
        });

        if (response.success) {
          setSuggestions(prev => [...prev, ...response.data]);
        }
      } catch (error) {
        // Use quick suggestions as fallback
      }
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };

  const loadSearchHistory = () => {
    const history = localStorage.getItem('jurexio-search-history');
    if (history) {
      setSearchHistory(JSON.parse(history).slice(0, 5));
    }
  };

  const performSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      // Use Jurexio orchestration for intelligent search
      const response = await apiRequest('/api/search/unified', {
        method: 'POST',
        body: JSON.stringify({
          query,
          includeAISuggestions: true,
          userContext: {
            platform: 'unified',
            searchType: 'global'
          }
        })
      });

      if (response.success) {
        const searchResults = response.data.results.map((result: any, index: number) => ({
          ...result,
          icon: getIconForType(result.type, result.platform)
        }));

        setResults(searchResults);
        setSelectedIndex(0);

        // Save to search history
        const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
        setSearchHistory(newHistory);
        localStorage.setItem('jurexio-search-history', JSON.stringify(newHistory));
      }
    } catch (error) {
      // Fallback to local search
      const fallbackResults = performLocalSearch(query);
      setResults(fallbackResults);
    } finally {
      setIsSearching(false);
    }
  };

  const performLocalSearch = (searchQuery: string): SearchResult[] => {
    const localResults: SearchResult[] = [
      {
        id: 'code-studio',
        title: 'Code Studio',
        description: 'AI-powered software development platform',
        type: 'platform',
        platform: 'code-studio',
        icon: Code,
        url: '/platforms/code-studio',
        relevanceScore: 0.9,
        tags: ['development', 'ai', 'coding']
      },
      {
        id: 'ai-assistant-builder',
        title: 'AI Assistant Builder',
        description: 'Create sophisticated AI assistants with 3D avatars',
        type: 'platform',
        platform: 'ai-assistant-builder',
        icon: Bot,
        url: '/platforms/ai-assistant-builder',
        relevanceScore: 0.85,
        tags: ['ai', 'assistant', 'chatbot']
      },
      {
        id: 'content-studio',
        title: 'Content Studio',
        description: 'Enterprise content creation and management',
        type: 'platform',
        platform: 'content-studio',
        icon: FileText,
        url: '/platforms/content-studio',
        relevanceScore: 0.8,
        tags: ['content', 'writing', 'marketing']
      }
    ];

    return localResults.filter(result => 
      result.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      result.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      result.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  };

  const getIconForType = (type: string, platform: string) => {
    const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
      'code-studio': Code,
      'ai-assistant-builder': Bot,
      'content-studio': FileText,
      'game-builder': Gamepad2,
      'business-studio': Building,
      'platform': Folder,
      'feature': Star,
      'project': File,
      'template': BookOpen,
      'documentation': BookOpen,
      'command': Hash
    };

    return iconMap[platform] || iconMap[type] || Search;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, (results.length || suggestions.length) - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const items = results.length > 0 ? results : suggestions;
      if (items[selectedIndex]) {
        handleItemSelect(items[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleItemSelect = (item: SearchResult | SearchSuggestion) => {
    if ('url' in item) {
      onNavigate(item.url);
    } else {
      // Handle suggestion actions
      if (item.id === 'create-project') {
        onNavigate('/platforms/code-studio');
      } else if (item.id === 'ai-assistant') {
        onNavigate('/platforms/ai-assistant-builder');
      } else if (item.id === 'deploy-app') {
        onNavigate('/deployment');
      } else if (item.id === 'content-generation') {
        onNavigate('/platforms/content-studio');
      } else if (item.id === 'game-development') {
        onNavigate('/platforms/game-builder');
      }
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-32">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden"
      >
        {/* Search Input */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search platforms, features, projects..."
              className="pl-10 pr-4 py-3 text-lg border-0 focus:ring-0 bg-gray-50"
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
              {isSearching && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
              )}
              <Badge variant="outline" className="text-xs">
                <Command className="w-3 h-3 mr-1" />
                K
              </Badge>
            </div>
          </div>
        </div>

        {/* Search Results / Suggestions */}
        <div className="max-h-96 overflow-y-auto">
          {results.length > 0 ? (
            <div>
              {/* Search Results Header */}
              <div className="px-4 py-2 bg-gray-50 border-b">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    <Sparkles className="w-3 h-3 mr-1" />
                    AI Enhanced
                  </Badge>
                </div>
              </div>

              {/* Results List */}
              <div className="py-2">
                {results.map((result, index) => {
                  const IconComponent = result.icon;
                  return (
                    <motion.div
                      key={result.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                        index === selectedIndex ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                      }`}
                      onClick={() => handleItemSelect(result)}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-gray-100">
                          <IconComponent className="w-5 h-5 text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold text-gray-900 truncate">
                              {result.title}
                            </h3>
                            <Badge variant="outline" className="text-xs capitalize">
                              {result.platform.replace('-', ' ')}
                            </Badge>
                            {result.lastUsed && (
                              <div className="flex items-center text-xs text-gray-500">
                                <Clock className="w-3 h-3 mr-1" />
                                Recent
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 truncate">
                            {result.description}
                          </p>
                          <div className="flex space-x-1 mt-1">
                            {result.tags.slice(0, 3).map(tag => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-gray-400" />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              {/* Search History */}
              {searchHistory.length > 0 && query.length === 0 && (
                <div>
                  <div className="px-4 py-2 bg-gray-50 border-b">
                    <span className="text-sm font-medium text-gray-700">Recent Searches</span>
                  </div>
                  <div className="py-2">
                    {searchHistory.map((historyQuery, index) => (
                      <div
                        key={index}
                        className="px-4 py-2 cursor-pointer hover:bg-gray-50 flex items-center space-x-3"
                        onClick={() => setQuery(historyQuery)}
                      >
                        <Clock className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-700">{historyQuery}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              <div>
                <div className="px-4 py-2 bg-gray-50 border-b">
                  <span className="text-sm font-medium text-gray-700">
                    {query.length > 0 ? 'No results found' : 'Quick Actions'}
                  </span>
                </div>
                <div className="py-2">
                  {suggestions.map((suggestion, index) => {
                    const IconComponent = suggestion.icon;
                    return (
                      <div
                        key={suggestion.id}
                        className={`px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                          index === selectedIndex ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                        }`}
                        onClick={() => handleItemSelect(suggestion)}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-lg bg-gray-100">
                            <IconComponent className="w-5 h-5 text-gray-600" />
                          </div>
                          <div className="flex-1">
                            <span className="font-medium text-gray-900">
                              {suggestion.text}
                            </span>
                            <Badge variant="secondary" className="ml-2 text-xs capitalize">
                              {suggestion.type.replace('-', ' ')}
                            </Badge>
                          </div>
                          <ArrowRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">↑↓</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center space-x-1">
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">Enter</kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center space-x-1">
              <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">Esc</kbd>
              <span>Close</span>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <Sparkles className="w-3 h-3" />
            <span>Powered by Jurexio</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Bot, Wrench, Workflow, Settings, Menu, X, Code, MessageSquare } from 'lucide-react';
import GlobalHeader from '@/components/GlobalHeader';

// NYV-PHASE3-DISPOSITION-2026-05-11 (Session-15 v8): the 5 ./superagent/*
// stub files (Chat/IDE/Tools/Workflows/Settings, 8 LOC each) were deleted
// and inlined as a single SuperAgentTabPlaceholder. The dashboard chrome
// (header, sidebar, tab nav) is the real work; the per-tab content is a
// roadmap placeholder until each tab is implemented in its own task.
function SuperAgentTabPlaceholder({ label }: { label: string }) {
  return (
    <div className="p-6 text-slate-900" data-testid={`superagent-tab-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <h2 className="text-xl font-semibold mb-2">SuperAgent {label}</h2>
      <p style={{ color: '#64748B' }}>SuperAgent {label} module</p>
    </div>
  );
}
const SuperAgentChat = () => <SuperAgentTabPlaceholder label="Chat" />;
const SuperAgentIDE = () => <SuperAgentTabPlaceholder label="IDE" />;
const SuperAgentToolMarketplace = () => <SuperAgentTabPlaceholder label="ToolMarketplace" />;
const SuperAgentWorkflowBuilder = () => <SuperAgentTabPlaceholder label="WorkflowBuilder" />;
const SuperAgentSettings = () => <SuperAgentTabPlaceholder label="Settings" />;

export default function SuperAgent() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Global Header with Platform Switcher */}
      <GlobalHeader />
      
      <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <div 
        className={`${
          sidebarOpen ? 'w-64' : 'w-0'
        } bg-white border-r border-slate-200 transition-all duration-300 overflow-hidden flex flex-col`}
      >
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Bot className="w-6 h-6 text-blue-600" />
              <h1 className="text-lg font-bold text-slate-900">AI Super Agent</h1>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="p-1 hover:bg-slate-100 rounded-lg transition-colors lg:hidden"
              data-testid="button-close-sidebar"
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="space-y-2" aria-label="Navigation">
            <button
              onClick={() => setActiveTab('chat')}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'chat'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              data-testid="nav-chat"
            >
              <MessageSquare className="w-5 h-5" />
              <span>Chat</span>
            </button>
            <button
              onClick={() => setActiveTab('ide')}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'ide'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              data-testid="nav-ide"
            >
              <Code className="w-5 h-5" />
              <span>IDE Workspace</span>
            </button>
            <button
              onClick={() => setActiveTab('tools')}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'tools'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              data-testid="nav-tools"
            >
              <Wrench className="w-5 h-5" />
              <span>Tools (93)</span>
            </button>
            <button
              onClick={() => setActiveTab('workflows')}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'workflows'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              data-testid="nav-workflows"
            >
              <Workflow className="w-5 h-5" />
              <span>Workflows</span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'settings'
                  ? 'bg-blue-50 text-blue-700 border border-blue-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              data-testid="nav-settings"
            >
              <Settings className="w-5 h-5" />
              <span>Settings</span>
            </button>
          </nav>
        </div>

        {/* Agent Status */}
        <div className="p-4 mt-auto border-t border-slate-200">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-semibold text-green-700">164 Agents Active</span>
            </div>
            <p className="text-xs text-slate-600">6 LLM Providers Connected</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                data-testid="button-open-sidebar"
              >
                <Menu className="w-5 h-5 text-slate-600" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-slate-900">
              {activeTab === 'chat' && 'Multi-Modal Chat'}
              {activeTab === 'ide' && 'AI IDE Workspace'}
              {activeTab === 'tools' && 'Tool Marketplace'}
              {activeTab === 'workflows' && 'Visual Workflow Builder'}
              {activeTab === 'settings' && 'Settings & Configuration'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-slate-300 text-slate-700 hover:bg-slate-100"
              data-testid="button-new-conversation"
            >
              New Conversation
            </Button>
          </div>
        </div>

        {/* Content Area - Conditionally render based on activeTab */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' ? (
            <SuperAgentChat />
          ) : activeTab === 'ide' ? (
            <SuperAgentIDE />
          ) : activeTab === 'tools' ? (
            <SuperAgentToolMarketplace />
          ) : activeTab === 'workflows' ? (
            <SuperAgentWorkflowBuilder />
          ) : activeTab === 'settings' ? (
            <SuperAgentSettings />
          ) : (
            <SuperAgentChat />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

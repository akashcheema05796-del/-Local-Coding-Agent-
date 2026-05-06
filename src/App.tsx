/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Terminal as TerminalIcon, 
  Files, 
  Cpu, 
  Code2, 
  Send, 
  History, 
  Settings, 
  Activity,
  ChevronRight,
  Database,
  Search,
  Command,
  Maximize2,
  CpuIcon,
  Zap,
  HardDrive
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from './lib/utils';

// --- Types ---
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// --- Constants ---
const SYSTEM_PROMPT = `You are "Gemma Agent V1", a highly advanced coding assistant. 
Your output should be technical, precise, and formatted for a terminal-style UI.
When providing code, use markdown blocks with the language specified.
You can simulate being part of a local build system. 
Stay in character as a high-performance terminal agent.
Keep responses concise but powerful.`;

interface WorkspaceFile {
  name: string;
  type: 'file' | 'dir';
  children?: WorkspaceFile[];
}

// --- Sub-components (Internal) ---

const BentoCard = ({ children, className, title, icon }: { children: React.ReactNode; className?: string; title?: string; icon?: React.ReactNode }) => (
  <div className={cn("bg-card-dark border border-border-dark rounded-2xl flex flex-col overflow-hidden shadow-2xl relative", className)}>
    {title && (
      <div className="px-4 py-3 border-b border-border-dark flex items-center justify-between bg-[#1C1C1E]">
        <div className="flex items-center gap-2">
          {icon && <span className="text-accent-purple">{icon}</span>}
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{title}</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
        </div>
      </div>
    )}
    {children}
  </div>
);

const SystemStatus = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="flex flex-col items-end">
    <span className="text-[10px] text-zinc-600 uppercase tracking-tighter">{label}</span>
    <span className={cn("text-xs font-semibold", color)}>{value}</span>
  </div>
);

const FileTreeItem = ({ item, depth = 0 }: { item: WorkspaceFile; depth?: number }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isDir = item.type === 'dir';

  return (
    <div className="flex flex-col">
      <div 
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 hover:bg-[#1F1F1F] rounded cursor-pointer group text-xs text-zinc-400 font-mono transition-colors",
          depth > 0 && "ml-4 border-l border-[#1F1F1F]"
        )}
        onClick={() => isDir && setIsOpen(!isOpen)}
      >
        {isDir ? (
          <ChevronRight 
            size={14} 
            className={cn("transition-transform", isOpen && "rotate-90 text-[#00E5FF]")} 
          />
        ) : (
          <Code2 size={14} className="text-zinc-500 group-hover:text-zinc-300" />
        )}
        <span className={cn(isDir ? "font-bold text-zinc-300" : "text-zinc-400")}>{item.name}</span>
      </div>
      {isDir && isOpen && item.children && (
        <div className="flex flex-col">
          {item.children.map((child, i) => (
            <FileTreeItem key={i} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'init',
      role: 'system',
      content: 'Gemma Agent V1 Initialized. Version 0.4.2-beta. Connection established.',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentStream, setCurrentStream] = useState('');
  const [activeTab, setActiveTab] = useState<'terminal' | 'workspace'>('terminal');
  const [provider, setProvider] = useState<'gemini' | 'local'>('gemini');
  const [reasoning, setReasoning] = useState<{ type: 'PLAN' | 'LOG' | 'TOOL'; content: string }[]>([
    { type: 'PLAN', content: 'Inference engine live. Waiting for user input.' },
  ]);

  const handleTool = async (name: string, args: any) => {
    setReasoning(prev => [...prev, { type: 'TOOL', content: `Executing ${name}...` }]);
    try {
      let result;
      if (name === 'list_files') {
        const res = await fetch(`/api/tools/ls?dir=${args.directory || '.'}`);
        result = await res.json();
      } else if (name === 'read_file') {
        const res = await fetch('/api/tools/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: args.filePath })
        });
        result = await res.json();
      } else if (name === 'write_file') {
        const res = await fetch('/api/tools/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: args.filePath, content: args.content })
        });
        result = await res.json();
      }
      return result;
    } catch (e) {
      return { error: 'Tool execution failed' };
    }
  };
  const [workspaceFiles] = useState<WorkspaceFile[]>([
    {
      name: 'src',
      type: 'dir',
      children: [
        { name: 'main.ts', type: 'file' },
        { name: 'agent.ts', type: 'file' },
        { name: 'parser.ts', type: 'file' },
      ]
    },
    { name: 'package.json', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: '.env', type: 'file' },
  ]);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }, []);

  useEffect(() => {
    // Auto-scroll on new messages
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentStream]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isTyping) return;

    const currentInput = input;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: currentInput,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    
    setReasoning(prev => [...prev, { type: 'PLAN', content: `Analyzing request: "${currentInput.slice(0, 30)}..."` }]);

    if (currentInput.startsWith('/')) {
      const cmd = currentInput.slice(1).toLowerCase();
      if (cmd === 'status') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'system',
          content: 'SYSTEM STATUS: All modules nominal. Simulation mode active.',
          timestamp: new Date()
        }]);
        return;
      }
    }

    setIsTyping(true);
    setCurrentStream('');

    try {
      if (provider === 'gemini') {
        if (!aiRef.current) aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

        const history = messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user' as const,
            parts: [{ text: m.content }]
          }));

        const stream = await aiRef.current.models.generateContentStream({
          model: "gemini-3-flash-preview",
          contents: [
            ...history,
            { role: 'user', parts: [{ text: currentInput }] }
          ],
          config: { systemInstruction: SYSTEM_PROMPT }
        });

        let fullResponse = '';
        for await (const chunk of stream) {
          const text = chunk.text || '';
          fullResponse += text;
          setCurrentStream(fullResponse);
        }
        
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        // Local Provider (Ollama Proxy)
        const response = await fetch('/api/chat/local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messages.filter(m => m.role !== 'system'),
            model: "gemma2", // Default local model
          })
        });

        if (!response.ok) throw new Error('Local backend unreachable');

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            fullResponse += chunk;
            setCurrentStream(fullResponse);
          }
        }

        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fullResponse,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
      setCurrentStream('');
    } catch (error) {
      console.error("Gemini Error:", error);
      setMessages(prev => [...prev, {
        id: 'error' + Date.now(),
        role: 'system',
        content: '!! CRITICAL ERROR: Inference engine failed. Memory dump required.',
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const [systemMetrics, setSystemMetrics] = useState({ vram: '16.4GB / 24GB', load: '32%', latency: '42ms' });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/system/status');
        if (res.ok) {
          const data = await res.json();
          setSystemMetrics(data);
        }
      } catch (e) {
        console.warn("Status fetch failed");
      }
    };
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-screen w-full bg-[#0A0A0B] text-[#E0E0E0] font-mono flex flex-col p-4 overflow-hidden selection:bg-accent-purple/30">
      
      {/* Header / System Status Bar */}
      <header className="flex justify-between items-center bg-card-dark border border-border-dark rounded-xl px-4 py-3 mb-4 shrink-0 transition-all hover:border-accent-purple/30">
        <div className="flex items-center gap-4">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56] shadow-[0_0_8px_rgba(255,95,86,0.3)]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] shadow-[0_0_8px_rgba(255,189,46,0.3)]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F] shadow-[0_0_8px_rgba(39,201,63,0.3)]" />
          </div>
          <div className="h-4 w-[1px] bg-border-dark mx-2" />
          <span className="text-zinc-500 font-bold text-xs tracking-[0.2em] uppercase">Gemma V1.0.4</span>
        </div>
        
        <div className="flex items-center gap-8">
          <button 
            onClick={() => setProvider(provider === 'gemini' ? 'local' : 'gemini')}
            className={cn(
              "px-3 py-1 rounded border text-[10px] font-bold uppercase tracking-widest transition-all",
              provider === 'gemini' 
                ? "border-accent-purple text-accent-purple bg-accent-purple/5" 
                : "border-sky-500 text-sky-500 bg-sky-500/5"
            )}
          >
            {provider === 'gemini' ? "Cloud: Gemini" : "Local: Gemma"}
          </button>
          <SystemStatus label="Latency" value={systemMetrics.latency} color="text-emerald-500" />
          <SystemStatus label="Load" value={systemMetrics.load} color="text-sky-500" />
          <SystemStatus label="VRAM" value={systemMetrics.vram} color="text-white" />
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-zinc-600 uppercase tracking-tighter">Status</span>
            <div className="flex items-center gap-1.5">
              <Activity size={10} className="text-emerald-500 animate-pulse" />
              <span className="text-xs text-white uppercase tracking-widest font-bold">Live</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Bento Grid */}
      <div className="grid grid-cols-12 grid-rows-6 gap-4 flex-1 min-h-0">
        
        {/* Sidebar: Navigation & FS */}
        <BentoCard className="col-span-2 row-span-6 p-4">
          <div className="flex flex-col h-full gap-8">
            <div className="space-y-4">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Agent_Commands</h3>
              <nav className="space-y-1">
                <SidebarItem 
                  icon={<TerminalIcon size={16} />} 
                  label="Shell" 
                  active={activeTab === 'terminal'} 
                  onClick={() => setActiveTab('terminal')}
                />
                <SidebarItem 
                  icon={<Files size={16} />} 
                  label="Files" 
                  active={activeTab === 'workspace'} 
                  onClick={() => setActiveTab('workspace')}
                />
                <SidebarItem icon={<Search size={16} />} label="Trace" />
                <SidebarItem icon={<History size={16} />} label="Logs" />
              </nav>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">Workspace_Vfs</h3>
              <div className="space-y-1">
                {workspaceFiles.map((file, i) => (
                  <FileTreeItem key={i} item={file} />
                ))}
              </div>
            </div>

            <div className="mt-auto pt-4 border-t border-border-dark space-y-4">
              <SidebarItem icon={<Settings size={16} />} label="Configs" />
              <div className="bg-[#050505] p-3 rounded-lg border border-border-dark">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-purple" />
                  <span className="text-[9px] text-zinc-500 uppercase">System_Load</span>
                </div>
                <div className="h-1 bg-[#1F1F1F] rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: '64%' }}
                    className="h-full bg-accent-purple" 
                  />
                </div>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* Main Editor/Chat Area */}
        <BentoCard 
          className="col-span-6 row-span-4"
          title={activeTab === 'terminal' ? "Inference_Engine_Output" : "Vfs_Editor"}
          icon={<Cpu size={14} />}
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 scrollbar-thin">
            <div className="max-w-3xl mx-auto">
              {activeTab === 'terminal' ? (
                <div className="space-y-6">
                  <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={cn(
                          "flex flex-col gap-2",
                          msg.role === 'user' ? "items-end" : "items-start"
                        )}
                      >
                        <div className="flex items-center gap-2 text-[10px] text-zinc-600 uppercase tracking-widest px-1">
                          {msg.role === 'assistant' && <span className="text-accent-purple">●</span>}
                          {msg.role}
                        </div>
                        <div className={cn(
                          "max-w-full px-4 py-2 rounded-lg",
                          msg.role === 'user' 
                            ? "bg-[#1F1F1F] text-zinc-200 border border-border-dark" 
                            : msg.role === 'system'
                              ? "bg-accent-purple/5 text-accent-purple border border-accent-purple/20 text-xs italic"
                              : "bg-transparent text-zinc-300"
                        )}>
                          <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-[#050505] prose-pre:border prose-pre:border-border-dark prose-code:text-accent-purple">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                    {currentStream && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2 items-start">
                        <div className="flex items-center gap-2 text-[10px] text-accent-purple uppercase tracking-widest px-1">
                          <span className="animate-pulse">●</span> Assistant
                        </div>
                        <div className="max-w-full px-4 text-zinc-300">
                          <div className="prose prose-invert prose-sm max-w-none prose-code:text-accent-purple">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {currentStream}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {isTyping && !currentStream && (
                    <div className="flex items-center gap-2 text-zinc-600 text-xs py-2">
                      <Command size={12} className="animate-spin" />
                      Token_Processing...
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-zinc-500 mb-4 border-b border-border-dark pb-2 font-bold tracking-widest">
                    <span>ROOT: /usr/agent/work</span>
                    <span>6 FILES</span>
                  </div>
                  {workspaceFiles.map((file, i) => (
                    <FileTreeItem key={i} item={file} />
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Chat Input Inside Main Bento */}
          <div className="p-4 border-t border-border-dark bg-[#0D0D0E]">
            <form onSubmit={handleSend} className="max-w-3xl mx-auto relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-purple">
                <ChevronRight size={16} />
              </span>
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Gemma or enter command..."
                className="w-full bg-bg-dark border border-border-dark rounded-lg py-2.5 pl-10 pr-12 text-sm focus:outline-none focus:border-accent-purple/50 transition-all placeholder:text-zinc-700"
                disabled={isTyping}
              />
              <button 
                type="submit"
                disabled={isTyping || !input.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md transition-all text-zinc-600 hover:text-accent-purple disabled:opacity-20"
              >
                <Send size={16} />
              </button>
            </form>
            <div className="max-w-3xl mx-auto mt-2 flex justify-between items-center px-1">
              <div className="flex gap-4">
                <Kbd label="Enter" detail="Send" />
                <Kbd label="Ctrl+Shift+R" detail="Reason" />
              </div>
              <div className="text-[9px] text-zinc-700 font-bold tracking-tighter">
                LLM_READY_STABLE
              </div>
            </div>
          </div>
        </BentoCard>

        {/* Reasoning Sidebar */}
        <BentoCard className="col-span-4 row-span-6 p-4">
          <div className="flex flex-col h-full">
            <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
              <div className="w-2 h-2 bg-accent-purple rounded-full animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
              Gemma_Reasoning_Engine
            </h3>
            
            <div className="space-y-6 flex-1 overflow-y-auto pr-2">
              {reasoning.map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className={cn(
                    "p-3 rounded-lg border",
                    item.type === 'PLAN' 
                      ? "bg-bg-dark border-border-dark" 
                      : "bg-emerald-500/5 border-emerald-500/10"
                  )}
                >
                  <span className={cn(
                    "text-[9px] font-bold block mb-1 uppercase tracking-widest",
                    item.type === 'PLAN' ? "text-accent-purple" : 
                    item.type === 'TOOL' ? "text-sky-400" : "text-emerald-500"
                  )}>
                    {item.type}
                  </span>
                  <p className="text-xs text-zinc-400 leading-relaxed italic">{item.content}</p>
                </motion.div>
              ))}

              <div className="space-y-4 pt-4 border-t border-border-dark">
                <div className="flex gap-2 text-xs">
                  <span className="text-accent-purple font-bold">›</span>
                  <p className="text-zinc-500 leading-tight">Parsing workspace context...</p>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="text-accent-purple font-bold">›</span>
                  <p className="text-zinc-500 leading-tight">Gemma LLM layers offloaded to L1 cache.</p>
                </div>
              </div>
            </div>

            <div className="mt-auto bg-[#050505] border border-border-dark p-3 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <HardwareMetric icon={<CpuIcon size={12} />} label="LOAD" value={systemMetrics.load || "0%"} />
                <div className="w-[1px] h-4 bg-border-dark" />
                <HardwareMetric icon={<HardDrive size={12} />} label="VRAM" value={(systemMetrics.vram || "0GB").split(' / ')[0]} />
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-600 font-bold">
                <Activity size={10} className="text-emerald-500" />
                NOMINAL
              </div>
            </div>
          </div>
        </BentoCard>

        {/* Terminal Output */}
        <BentoCard className="col-span-6 row-span-2 p-4 bg-bg-dark">
          <div className="flex gap-4 text-[10px] text-zinc-600 font-bold mb-3 border-b border-border-dark pb-2 uppercase tracking-widest">
            <span className="text-white border-b border-accent-purple pb-2 relative top-[1px]">Terminal</span>
            <span className="hover:text-zinc-400 cursor-pointer">Output</span>
            <span className="hover:text-zinc-400 cursor-pointer">Debug</span>
          </div>
          <div className="text-[11px] text-zinc-500 space-y-1 font-mono leading-relaxed overflow-y-auto">
            <p><span className="text-emerald-500">$</span> python gemma_inference.py --mode local</p>
            <p className="opacity-70">[INFO] Context pre-loading complete in 842ms</p>
            <p className="opacity-70">[WARN] Paging file detected. Optimization suggested.</p>
            <p><span className="text-sky-500">STATS:</span> 1.2M params | 48 context lines indexed</p>
            <p className="flex items-center gap-2">
              <span className="text-emerald-500">$</span>
              <span className="w-1.5 h-3 bg-accent-purple animate-pulse" />
            </p>
          </div>
        </BentoCard>

      </div>

      {/* Bottom Status Footer */}
      <footer className="mt-4 flex justify-between items-center text-[9px] text-zinc-600 font-bold tracking-[0.15em] uppercase shrink-0">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <span className="text-accent-purple">GIT:</span>
            <span className="text-zinc-400">MAIN</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-500">LINT:</span>
            <span className="text-zinc-400">PASSED</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap size={10} className="text-amber-500" />
            <span>Auto-Save: Active</span>
          </div>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-zinc-700">DeepSeek-TUI COMPATIBLE_V1</span>
          <span className="px-2 py-0.5 border border-border-dark rounded text-accent-purple">LOCALLY_HOSTED</span>
        </div>
      </footer>
    </div>
  );
}

// --- Sub-components ---

function HardwareMetric({ icon, label, value }: { icon: React.ReactNode, label: string, value: string }) {
  return (
    <div className="flex flex-col items-start">
      <div className="flex items-center gap-1.5 text-[8px] text-zinc-600 uppercase">
        {icon}
        {label}
      </div>
      <span className="text-[10px] text-zinc-400 font-bold tracking-tight">{value}</span>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2 rounded-lg transition-all group relative border",
        active 
          ? "bg-accent-purple/10 text-white border-accent-purple/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]" 
          : "text-zinc-600 hover:bg-[#161618] hover:text-zinc-400 border-transparent"
      )}
    >
      <span className={cn(active ? "text-accent-purple" : "text-zinc-600 group-hover:text-zinc-400")}>{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute left-[-4px] w-0.5 h-1/2 bg-accent-purple rounded-r-full"
        />
      )}
    </button>
  );
}


function Kbd({ label, detail }: { label: string, detail: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="px-1.5 py-0.5 bg-[#1F1F1F] border border-[#2F2F2F] rounded text-zinc-400 font-bold">{label}</span>
      <span className="text-zinc-600 uppercase tracking-tighter">{detail}</span>
    </div>
  );
}

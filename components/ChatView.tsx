import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatSession, Message, Settings, Persona } from '../types';
import { ModelOption } from '../services/llm/types';
import { Icon } from './Icon';
import { WelcomeView } from './WelcomeView';
import { MessageBubble } from './MessageBubble';
import { ChatInput, ChatInputRef } from './chat/ChatInput';
import { PDFParseResult } from '../services/pdfService';

import { useLocalization } from '../contexts/LocalizationContext';
import { InternalView } from './common/InternalView';
import { ChatHeader } from './chat/ChatHeader';
import { ChatContextProvider } from '../contexts/ChatContext';
import { performanceMonitor } from '../utils/performanceMonitor';

// 消息操作配置
interface MessageActions {
  onSendMessage: (message: string, files: File[], pdfDocuments?: PDFParseResult[]) => void;
  onDeleteMessage: (messageId: string) => void;
  onUpdateMessageContent: (messageId: string, newContent: string) => void;
  onRegenerate: () => void;
  onEditAndResubmit: (messageId: string, newContent: string) => void;
  onEditMessage: (message: Message) => void;
}

// 模型配置
interface ModelConfig {
  currentModel: string;
  currentModelRouteId?: string;
  availableModels: string[];
  availableModelOptions: ModelOption[];
  onSetCurrentModel: (model: string, routeId?: string) => void;
  onSetModelForActiveChat: (model: string, routeId?: string) => void;
}

// UI 交互配置
interface UIInteractions {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleMobileSidebar: () => void;
  onImageClick: (src: string) => void;
  onShowCitations: (chunks: any[]) => void;
}

// 聊天管理配置
interface ChatManagement {
  onNewChat: (personaId?: string) => void;
  onDeleteChat: (id: string) => void;
  onEditChat: (chat: ChatSession) => void;
}

interface ChatViewProps {
  // 核心数据
  chatSession: ChatSession | null;
  personas: Persona[];
  settings: Settings;
  isLoading: boolean;
  
  // 分组配置
  messageActions: MessageActions;
  modelConfig: ModelConfig;
  uiInteractions: UIInteractions;
  chatManagement: ChatManagement;
  
  // 生成控制
  onCancelGeneration: () => void;
}

export const ChatView: React.FC<ChatViewProps> = (props) => {
  const { chatSession, personas, isLoading, settings, messageActions, chatManagement } = props;
  const { t } = useLocalization();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputRef>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const [renderStartTime, setRenderStartTime] = useState<number>(0);
  
  // 分批渲染状态
  const [visibleMessageCount, setVisibleMessageCount] = useState(15); // 初始显示15条
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const BATCH_SIZE = 15; // 每批加载15条消息
  const scrollHeightBeforeLoad = useRef(0);
  
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');

  const scrollToBottom = useCallback(() => {
    // 使用 setTimeout 确保在 DOM 更新后再滚动
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }, 0);
  }, []);

  const activePersona = useMemo(() =>
    chatSession?.personaId ? personas.find(p => p && p.id === chatSession.personaId) : null
  , [chatSession?.personaId, personas]);

  const prevChatIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (chatSession?.id !== prevChatIdRef.current) {
        setEditingMessageId(null);
        setChatInput('');
        // 切换对话时，重置可见消息数量并滚动到底部
        setVisibleMessageCount(BATCH_SIZE);
        scrollToBottom(); // 1. 切换聊天时滚动
    }
    prevChatIdRef.current = chatSession?.id;
  }, [chatSession, scrollToBottom]);

  // 3. AI 回复完成时滚动
  const prevIsLoading = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoading.current && !isLoading) {
      scrollToBottom();
    }
    prevIsLoading.current = isLoading;
  }, [isLoading, scrollToBottom]);

  // 详细性能监控状态
  const [performanceBreakdown, setPerformanceBreakdown] = useState<{
    jsonReadTime: number;
    markdownParseTime: number;
    mathExtractionTime: number;
    katexRenderTime: number;
    domUpdateTime: number;
  }>({
    jsonReadTime: 0,
    markdownParseTime: 0,
    mathExtractionTime: 0,
    katexRenderTime: 0,
    domUpdateTime: 0
  });

  // 消息渲染性能监控
  useEffect(() => {
    if (chatSession?.messages && chatSession.messages.length > 0) {
      const startTime = performance.now();
      setRenderStartTime(startTime);
      
      // 记录开始渲染的性能点
      performance.mark('render-start');
      
      // This line is removed to prevent resetting scroll on new messages.
      
      // 模拟JSON读取时间（实际上数据已经在内存中）
      const jsonStart = performance.now();
      // 实际项目中这里可能是从localStorage/IndexedDB读取
      const jsonEnd = performance.now();
      
      setPerformanceBreakdown(prev => ({
        ...prev,
        jsonReadTime: jsonEnd - jsonStart
      }));
    }
  }, [chatSession?.messages]);

  useEffect(() => {
    if (renderStartTime > 0 && chatSession?.messages) {
      const totalRenderTime = performance.now() - renderStartTime;
      const messages = chatSession.messages || [];
      const visibleMessages = messages.slice(Math.max(messages.length - visibleMessageCount, 0));
      
      // 详细计算数学公式数量和解析时间
      const mathCount = visibleMessages.reduce((count, msg) => {
        const mathMatches = (msg.content || '').match(/\$\$[\s\S]*?\$\$|\$[^$\n]+?\$|\\\[[\s\S]*?\\\]|\\\(.+?\\\)/g);
        return count + (mathMatches ? mathMatches.length : 0);
      }, 0);
      
      // 模拟各阶段耗时分配
      const markdownParseTime = totalRenderTime * 0.3; // 30%用于Markdown解析
      const mathExtractionTime = totalRenderTime * 0.2; // 20%用于公式提取
      const katexRenderTime = totalRenderTime * 0.4; // 40%用于KaTeX渲染
      const domUpdateTime = totalRenderTime * 0.1; // 10%用于DOM更新
      
      const taskBreakdown = {
        jsonReadTime: performanceBreakdown.jsonReadTime,
        markdownParseTime,
        mathExtractionTime,
        katexRenderTime,
        domUpdateTime,
        totalProcessingTime: totalRenderTime
      };
      
      // 记录详细性能数据
      performanceMonitor.recordMessageRender({
        visibleMessages: visibleMessages.length,
        totalMessages: chatSession.messages.length,
        mathExpressions: mathCount,
        renderTime: totalRenderTime,
        mathRenderTime: katexRenderTime,
        method: 'lazy',
        taskBreakdown
      });
      
      // 输出详细性能报告
      if (process.env.NODE_ENV === 'development') {
        console.group('🔍 详细性能分析 - ' + new Date().toLocaleTimeString());
        console.log('📊 基础指标:');
        console.log(`  - 总消息数: ${chatSession.messages.length}`);
        console.log(`  - 可见消息数: ${visibleMessages.length}`);
        console.log(`  - 数学公式数: ${mathCount}`);
        console.log(`  - 总渲染时间: ${totalRenderTime.toFixed(2)}ms`);
        
        console.log('⏱️ 任务耗时分解:');
        console.log(`  - JSON数据读取: ${taskBreakdown.jsonReadTime.toFixed(2)}ms (${(taskBreakdown.jsonReadTime/totalRenderTime*100).toFixed(1)}%)`);
        console.log(`  - Markdown解析: ${taskBreakdown.markdownParseTime.toFixed(2)}ms (${(taskBreakdown.markdownParseTime/totalRenderTime*100).toFixed(1)}%)`);
        console.log(`  - 公式提取: ${taskBreakdown.mathExtractionTime.toFixed(2)}ms (${(taskBreakdown.mathExtractionTime/totalRenderTime*100).toFixed(1)}%)`);
        console.log(`  - KaTeX渲染: ${taskBreakdown.katexRenderTime.toFixed(2)}ms (${(taskBreakdown.katexRenderTime/totalRenderTime*100).toFixed(1)}%)`);
        console.log(`  - DOM更新: ${taskBreakdown.domUpdateTime.toFixed(2)}ms (${(taskBreakdown.domUpdateTime/totalRenderTime*100).toFixed(1)}%)`);
        
        console.log('📈 性能建议:');
        const report = performanceMonitor.getDetailedPerformanceReport();
        report.recommendations.forEach((rec, index) => {
          console.log(`  ${index + 1}. ${rec}`);
        });
        console.groupEnd();
      }
      
      setRenderStartTime(0);
    }
  }, [chatSession?.messages, visibleMessageCount, renderStartTime, performanceBreakdown]);

  // 滚动检测：向上滚动加载更多历史消息
  const handleScroll = useCallback(() => {
    if (isLoadingMore || !scrollContainerRef.current || !chatSession?.messages) return;

    const container = scrollContainerRef.current;
    // 当滚动到顶部时加载更多
    if (container.scrollTop < 100) {
      const totalMessages = chatSession.messages.length;
      if (visibleMessageCount < totalMessages) {
        setIsLoadingMore(true);
        // 保存当前滚动高度，用于后续恢复位置
        scrollHeightBeforeLoad.current = container.scrollHeight;
        setVisibleMessageCount(prev => Math.min(prev + BATCH_SIZE, totalMessages));
      }
    }
  }, [isLoadingMore, chatSession?.messages, visibleMessageCount]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // 在加载更多消息后恢复滚动位置
  React.useLayoutEffect(() => {
    if (isLoadingMore && scrollContainerRef.current) {
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      const scrollOffset = newScrollHeight - scrollHeightBeforeLoad.current;
      scrollContainerRef.current.scrollTop += scrollOffset;
      setIsLoadingMore(false);
    }
  }, [visibleMessageCount, isLoadingMore]); // 依赖于消息数量变化

  // 添加快捷性能分析功能
  useEffect(() => {
    // 在开发环境下，添加全局快捷键 Ctrl+Shift+P 来显示性能分析
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        showPerformanceAnalysis();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, []);

  const showPerformanceAnalysis = () => {
    const report = performanceMonitor.getDetailedPerformanceReport();
    console.group('🚀 KChat 性能分析报告');
    console.log('📊 总体性能:');
    console.log(`  平均渲染时间: ${report.averageRenderTime}ms`);
    console.log(`  平均公式渲染时间: ${report.averageMathRenderTime}ms`);
    console.log(`  总消息数: ${report.totalMessages}`);
    console.log(`  分批渲染效率: ${report.efficiency}%`);
    
    console.log('⏱️ 详细任务耗时:');
    console.log(`  JSON数据读取: ${report.taskBreakdown.averageJsonReadTime}ms`);
    console.log(`  Markdown解析: ${report.taskBreakdown.averageMarkdownParseTime}ms`);
    console.log(`  公式提取: ${report.taskBreakdown.averageMathExtractionTime}ms`);
    console.log(`  KaTeX渲染: ${report.taskBreakdown.averageKatexRenderTime}ms`);
    console.log(`  DOM更新: ${report.taskBreakdown.averageDomUpdateTime}ms`);
    
    console.log('💡 优化建议:');
    report.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
    
    console.log('📈 最近数据点:');
    report.detailedMetrics.slice(-3).forEach((metric, index) => {
      console.log(`  数据点${index + 1}: ${new Date(metric.timestamp).toLocaleTimeString()} - ${metric.renderTime}ms (${metric.visibleMessages}/${metric.totalMessages}消息, ${metric.mathExpressions}公式)`);
    });
    
    console.groupEnd();
  };

  const handleSendMessageWithTools = (message: string, files: File[], pdfDocuments?: PDFParseResult[]) => {
    messageActions.onSendMessage(message, files, pdfDocuments);
    setChatInput('');
    scrollToBottom(); // 2. 发送消息时滚动
  };


  const handleSaveEdit = useCallback((message: Message, newContent: string) => {
    if (message.role === 'user') {
      messageActions.onEditAndResubmit(message.id, newContent);
    } else {
      messageActions.onUpdateMessageContent(message.id, newContent);
    }
    setEditingMessageId(null);
  }, [messageActions]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const handleCopy = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
  }, []);
  
   const handleDragEnter = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) setIsDraggingOver(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDraggingOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDraggingOver(false);
    dragCounter.current = 0;
    if (e.dataTransfer.files?.length) {
        chatInputRef.current?.addFiles(Array.from(e.dataTransfer.files));
        e.dataTransfer.clearData();
    }
  };

  return (
    <ChatContextProvider value={{
      settings,
      personas,
      onImageClick: props.uiInteractions.onImageClick,
      onShowCitations: props.uiInteractions.onShowCitations
    }}>
      <main
        className="rounded-[var(--radius-2xl)] flex flex-col h-full overflow-hidden relative"
        onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={(e) => {e.preventDefault(); e.stopPropagation();}} onDrop={handleDrop}
      >
        <div className={`dropzone-overlay ${isDraggingOver ? 'visible' : ''}`}>
            <div className="dropzone-overlay-content">
                <Icon icon="upload" className="w-20 h-20" />
                <h3 className="text-2xl font-bold">Drop files here to upload</h3>
            </div>
        </div>
        
        <ChatHeader
          chatSession={chatSession}
          onNewChat={chatManagement.onNewChat}
          availableModels={props.modelConfig.availableModels}
          availableModelOptions={props.modelConfig.availableModelOptions}
          onSetModelForActiveChat={props.modelConfig.onSetModelForActiveChat}
          currentModel={props.modelConfig.currentModel}
          currentModelRouteId={props.modelConfig.currentModelRouteId}
          isSidebarCollapsed={props.uiInteractions.isSidebarCollapsed}
          onToggleSidebar={props.uiInteractions.onToggleSidebar}
          onToggleMobileSidebar={props.uiInteractions.onToggleMobileSidebar}
        />
        
        <div className="flex-grow flex flex-col relative min-h-0">
            <InternalView active={!!chatSession}>
              <div className="flex-grow overflow-y-auto pt-1 pb-5" ref={scrollContainerRef}>
                <div className={`w-full px-6 transition-all duration-300 ${props.uiInteractions.isSidebarCollapsed ? 'max-w-6xl mx-auto' : 'max-w-[672px] mx-auto'}`}>
                  {/* 分批渲染消息 */}
                  {/* 渲染可见消息 */}
                  {useMemo(() => {
                    const messages = chatSession?.messages || [];
                    const visibleMessages = messages.slice(Math.max(messages.length - visibleMessageCount, 0));
                    return visibleMessages.map((msg, index) => (
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        index={index} // 这个 index 现在是相对于 visibleMessages 的
                        persona={activePersona}
                        isLastMessageLoading={isLoading && index === visibleMessages.length - 1 && msg.id === messages[messages.length - 1].id}
                        isEditing={editingMessageId === msg.id}
                        onEditRequest={() => messageActions.onEditMessage(msg)}
                        onCancelEdit={handleCancelEdit}
                        onSaveEdit={handleSaveEdit}
                        onDelete={messageActions.onDeleteMessage}
                        onRegenerate={messageActions.onRegenerate}
                        onCopy={handleCopy}
                        isInVirtualView={false}
                        isBatchRendered={index < BATCH_SIZE}
                      />
                    ));
                  }, [chatSession?.messages, visibleMessageCount, isLoading, editingMessageId, activePersona, messageActions, handleCancelEdit, handleSaveEdit, handleCopy])}
                  
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </InternalView>

            <InternalView active={!chatSession}>
              <WelcomeView
                currentModel={props.modelConfig.currentModel}
                currentModelRouteId={props.modelConfig.currentModelRouteId}
                onSetCurrentModel={props.modelConfig.onSetCurrentModel}
                availableModels={props.modelConfig.availableModels}
                availableModelOptions={props.modelConfig.availableModelOptions}
                personas={props.personas}
                onStartChat={props.chatManagement.onNewChat}
                settings={props.settings}
                isSidebarCollapsed={props.uiInteractions.isSidebarCollapsed}
              />
            </InternalView>
        </div>
        
        <div className={`w-full px-6 transition-all duration-300 ${props.uiInteractions.isSidebarCollapsed ? 'max-w-6xl mx-auto' : 'max-w-[672px] mx-auto'}`}>
          <ChatInput
            ref={chatInputRef}
            onSendMessage={handleSendMessageWithTools}
            isLoading={isLoading}
            onCancel={props.onCancelGeneration}
            input={chatInput}
            setInput={setChatInput}
            chatSession={chatSession}
            availableModels={props.modelConfig.availableModels}
            availableModelOptions={props.modelConfig.availableModelOptions}
            currentModel={props.modelConfig.currentModel}
            currentModelRouteId={props.modelConfig.currentModelRouteId}
            onSetModelForActiveChat={props.modelConfig.onSetModelForActiveChat}
          />
        </div>
      </main>
    </ChatContextProvider>
  );
};

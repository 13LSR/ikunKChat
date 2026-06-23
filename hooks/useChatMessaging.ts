import React, { useState, useCallback, useRef } from 'react';
import { ChatSession, Message, MessageRole, Settings, Persona, FileAttachment, PDFSummary } from '../types';
import { generateChatDetails } from '../services/llm/gemini/chatService'; // 临时保留用于标题生成
import { createLLMService } from '../services/llm/llmFactory';
import { ChatRequest, StreamChunk } from '../services/llm/types';
import { fileToData } from '../utils/fileUtils';
import { TITLE_GENERATION_PROMPT } from '../data/prompts';
import { saveAttachment } from '../services/indexedDBService';
import { getUserFacingMessage, logError } from '../utils/errorUtils';
import { PDFParseResult } from '../services/pdfService';

interface UseChatMessagingProps {
  settings: Settings;
  activeChat: ChatSession | null;
  personas: Persona[];
  setChats: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  setActiveChatId: React.Dispatch<React.SetStateAction<string | null>>;
  addToast: (message: string, type: 'success' | 'error' | 'info') => void;
  availableModels: string[];
}

export const useChatMessaging = ({ settings, activeChat, personas, setChats, setActiveChatId, addToast, availableModels }: UseChatMessagingProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const isCancelledRef = useRef(false);
  let inactivityTimer: NodeJS.Timeout; // For stream watchdog
  const workerApiBaseUrl = ((import.meta as any).env?.VITE_WORKER_API_BASE_URL || '').trim();

  const handleCancel = useCallback(() => {
    isCancelledRef.current = true;
    setIsLoading(false); 
  }, []);

  const _initiateStream = useCallback(async (chatId: string, historyForAPI: Message[], personaId: string | null | undefined, titleGenerationMode: 'INITIAL' | 'RECURRING' | null = null, availableModels: string[] = []) => {
    const hasProviderEnvConfig = settings.llmProvider === 'proxy'
      ? !!workerApiBaseUrl
      : settings.llmProvider === 'openai'
        ? !!process.env.OPENAI_API_KEY?.trim()
        : !!(process.env.GEMINI_API_KEY?.trim() || process.env.API_KEY?.trim());
    const shouldUseManualConfig = settings.useCustomApi || !hasProviderEnvConfig;

    // 获取 API Key：如果用户启用了自定义，使用用户的配置；否则使用环境变量
    let apiKeys: string[] = [];
    if (shouldUseManualConfig) {
      // 用户启用了自定义配置，或当前 provider 没有环境变量配置时，使用用户输入的 API Key
      apiKeys = settings.apiKey && settings.apiKey.length > 0 ? settings.apiKey : [];
    } else {
      // 用户未启用自定义，使用环境变量
      const envKey = settings.llmProvider === 'proxy'
        ? 'worker-proxy'
        : settings.llmProvider === 'openai'
          ? process.env.OPENAI_API_KEY
          : process.env.GEMINI_API_KEY || process.env.API_KEY;
      apiKeys = envKey ? [envKey] : [];
    }

    if (apiKeys.length === 0) {
        const providerName = settings.llmProvider === 'proxy' ? 'Worker Proxy' : settings.llmProvider === 'openai' ? 'OpenAI' : 'Gemini';
        addToast(`Please set your ${providerName} API key in Settings.`, 'error');
        setIsLoading(false);
        return;
    }

    isCancelledRef.current = false;
    setIsLoading(true);

    // 确定使用的模型：优先使用 lastSelectedModel，否则使用模型列表第一个
    const defaultModel = settings.lastSelectedModel ?? availableModels[0] ?? '';

    const chatSession = activeChat && activeChat.id === chatId
        ? activeChat
        : { id: chatId, messages: historyForAPI, model: defaultModel, personaId, title: "New Chat", createdAt: Date.now(), folderId: null };

    const activePersona = chatSession.personaId ? personas.find(p => p && p.id === chatSession.personaId) : null;

    const lastUserMessage = [...historyForAPI].reverse().find(m => m.role === MessageRole.USER);
    const promptContent = lastUserMessage?.content || '';
    const promptAttachments = lastUserMessage?.attachments || [];
    
    const modelMessage: Message = { id: crypto.randomUUID(), role: MessageRole.MODEL, content: "...", timestamp: Date.now(), groundingMetadata: null, thoughts: settings.showThoughts ? "" : undefined };
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [...c.messages, modelMessage] } : c));
    
    let fullResponse = "";
    let accumulatedThoughts = "";
    let finalGroundingMetadata: any = null;
    let streamHadError = false;

    let thinkingTime: number | undefined = undefined;
    const thinkingStartTime = Date.now();

    try {
      const llmService = createLLMService(settings);

      // 获取 API Base URL：如果用户启用了自定义，使用用户的配置；否则使用环境变量
      let apiBaseUrl = '';
      if (shouldUseManualConfig) {
        // 用户启用了自定义配置，或当前 provider 没有环境变量配置时，使用用户输入的 API Base URL
        apiBaseUrl = settings.apiBaseUrl || '';
      } else {
        // 用户未启用自定义，使用环境变量
        apiBaseUrl = settings.llmProvider === 'proxy'
          ? workerApiBaseUrl
          : settings.llmProvider === 'openai'
            ? (process.env.OPENAI_API_BASE_URL || '')
            : (process.env.API_BASE_URL || '');
      }

      const chatRequest: ChatRequest = {
        messages: historyForAPI,
        model: chatSession.model,
        persona: activePersona!,
        config: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
          contextLength: settings.contextLength,
        },
        apiKey: apiKeys[0], // 服务内部目前只处理单个key
        apiBaseUrl: apiBaseUrl,
        showThoughts: settings.showThoughts,
        enableSearch: settings.enableSearch,
      };

      const stream = llmService.generateContentStream(chatRequest);
      
      // --- UI Update Logic using requestAnimationFrame ---
      let animationFrameId: number | null = null;
      let needsUpdate = false;

      const updateUI = () => {
        if (needsUpdate) {
          setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: c.messages.map(m => m.id === modelMessage.id ? { ...m, content: fullResponse || '...', thoughts: settings.showThoughts ? accumulatedThoughts : undefined, thinkingTime } : m) } : c));
          needsUpdate = false;
        }
        if (!isCancelledRef.current && !streamHadError) {
          animationFrameId = requestAnimationFrame(updateUI);
        }
      };
      
      animationFrameId = requestAnimationFrame(updateUI);

      // --- Stream Watchdog ---
      const INACTIVITY_TIMEOUT_MS = (settings.streamInactivityTimeout || 60) * 1000;
      let inactivityTimer: NodeJS.Timeout;

      const resetInactivityTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          if (!isCancelledRef.current) {
            console.warn("Stream inactivity timeout reached. Aborting.");
            isCancelledRef.current = true;
            streamHadError = true;
            fullResponse = "请求超时，模型响应时间过长或连接中断。";
            setChats(p => p.map(c => c.id === chatId ? { ...c, messages: c.messages.map(m => m.id === modelMessage.id ? { ...m, content: fullResponse } : m) } : c));
            addToast(fullResponse, 'error');
          }
        }, INACTIVITY_TIMEOUT_MS);
      };

      resetInactivityTimer();
      let chunkCount = 0;

      for await (const chunk of stream) {
        if (isCancelledRef.current) break;
        
        resetInactivityTimer();
        chunkCount++;

        let hasNewContent = false;

        switch (chunk.type) {
          case 'content':
            fullResponse += chunk.payload;
            hasNewContent = true;
            break;
          case 'thought':
            if (settings.showThoughts) {
              accumulatedThoughts += chunk.payload;
            }
            break;
          case 'error':
            streamHadError = true;
            fullResponse = chunk.payload;
            addToast(chunk.payload, 'error');
            break;
          case 'end':
            // Stream finished gracefully
            break;
        }

        if (streamHadError) break;

        if (hasNewContent && thinkingTime === undefined) {
          thinkingTime = (Date.now() - thinkingStartTime) / 1000;
        }
  
        needsUpdate = true;
      }

      clearTimeout(inactivityTimer);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);

      // Final, immediate update for the complete response
      if (!isCancelledRef.current) {
        // Final check for empty response after a "STOP" reason, which can indicate a silent refusal to answer.
        // 只在既没有主回复内容也没有思考内容时才报错
        if (!streamHadError && fullResponse.trim().length === 0 && accumulatedThoughts.trim().length === 0 && chunkCount > 0) {
          streamHadError = true;
          const providerName = settings.llmProvider === 'proxy' ? 'Worker Proxy' : settings.llmProvider === 'openai' ? 'OpenAI' : 'Google';
          fullResponse = `${providerName} did not return a message. This could be due to safety settings or other restrictions.`;
          addToast(fullResponse, 'error');
        }
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: c.messages.map(m => m.id === modelMessage.id ? { ...m, content: fullResponse || '...', thoughts: settings.showThoughts ? accumulatedThoughts : undefined, groundingMetadata: finalGroundingMetadata, thinkingTime } : m) } : c));
      }
    } catch (error) {
      logError(error, 'ChatStream');
      if (!isCancelledRef.current) {
        streamHadError = true;
        const errorMessage = getUserFacingMessage(error, '请求过程中发生错误。');
        addToast(errorMessage, 'error');
        setChats(p => p.map(c => c.id === chatId ? { ...c, messages: c.messages.map(m => m.id === modelMessage.id ? { ...m, content: errorMessage } : m) } : c));
      }
    } finally {
      clearTimeout(inactivityTimer); // Ensure timer is cleared in finally block
      if (!isCancelledRef.current) {
        setIsLoading(false);

        // New Title Generation Logic
        if (titleGenerationMode && !streamHadError) {
          setChats(prevChats => {
            const currentChat = prevChats.find(c => c.id === chatId);
            if (!currentChat) return prevChats;

            let historyForTitle: Message[] = [];
            if (titleGenerationMode === 'INITIAL') {
              historyForTitle = currentChat.messages.slice(0, 4);
            } else if (titleGenerationMode === 'RECURRING') {
              historyForTitle = currentChat.messages.slice(-4);
            }
            
            if (historyForTitle.length >= 2) {
              const conversationForTitle = historyForTitle.map(m => `${m.role}: ${m.content}`).join('\n');
              const fullPrompt = `${TITLE_GENERATION_PROMPT}\n\n**CONVERSATION:**\n${conversationForTitle}`;
              
              const apiKeys = settings.llmProvider === 'proxy' && workerApiBaseUrl
                ? ['worker-proxy']
                : settings.apiKey && settings.apiKey.length > 0
                  ? settings.apiKey
                  : (process.env.API_KEY ? [process.env.API_KEY] : []);

              if (apiKeys.length > 0) {
                const triggerReason = titleGenerationMode === 'INITIAL' ? '第二轮用户对话后' : '周期性更新';
                console.log(`[标题生成] ✨ 触发 - ${triggerReason}`);
                const titleSettings = settings.llmProvider === 'proxy'
                  ? { ...settings, apiBaseUrl: workerApiBaseUrl }
                  : settings;
                generateChatDetails(apiKeys, fullPrompt, settings.titleGenerationModel, titleSettings).then(({ title }) => {
                  console.log(`[标题生成] ✅ 应用 - 标题: \"${title}\"`);
                  setChats(p => p.map(c => c.id === chatId ? { ...c, title } : c));
                }).catch(error => {
                  logError(error, 'TitleGeneration');
                });
              }
            }
            return prevChats;
          });
        }
      }
    }
  }, [settings, setChats, activeChat, personas, addToast, workerApiBaseUrl]);

  const handleSendMessage = useCallback(async (content: string, files: File[] = [], pdfDocuments?: PDFParseResult[]) => {
    // 串行处理文件以避免内存峰值
    const attachments: FileAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        const attachment = await fileToData(file);
        
        // 验证附件数据有效性
        if (!attachment.data || typeof attachment.data !== 'string') {
          addToast(`文件 "${file.name}" 数据无效，已跳过`, 'error');
          continue;
        }
        
        // 生成唯一 ID 并保存到 IndexedDB
        const attachmentId = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (attachment.data) {
          try {
            await saveAttachment(attachmentId, attachment.data, attachment.mimeType, attachment.name);
          } catch (dbError) {
            // 如果 IndexedDB 保存失败，继续使用 data 字段（降级处理）
          }
        }
        
        // 保存引用（ID）到消息中，保留 data 用于当前会话
        const attachmentObject = {
          id: attachmentId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          data: attachment.data
        };
        
        attachments.push(attachmentObject);
        
      } catch (error) {
        logError(error, 'AttachmentProcessing', {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
        const friendlyMessage = getUserFacingMessage(error, '未知错误');
        addToast(`文件 "${file.name}" 处理失败: ${friendlyMessage}`, 'error');
      }
    }
    
    // 处理PDF文档 - 提取摘要信息和全文
    let pdfSummaries: PDFSummary[] | undefined;
    let pdfContextForAPI = '';
    
    if (pdfDocuments && pdfDocuments.length > 0) {
      // 生成PDF摘要信息（用于显示在气泡中）
      pdfSummaries = pdfDocuments.map(pdf => ({
        id: pdf.id,
        fileName: pdf.fileName,
        pageCount: pdf.pageCount,
        fileSize: pdf.fileSize,
        author: pdf.metadata?.author,
        charCount: pdf.extractedText.length
      }));
      
      // 提取PDF全文（仅用于发送给API，不保存到消息中）
      pdfContextForAPI = pdfDocuments.map(pdf =>
        `\n\n[PDF文档内容 - ${pdf.fileName}]\n${pdf.extractedText.substring(0, 30000)}`
      ).join('\n');
    }
      
    // 用户消息：仅保存用户输入的文本和PDF摘要，不包含PDF全文
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: MessageRole.USER,
      content: content,  // 只保存用户输入的文本
      timestamp: Date.now(),
      attachments,
      pdfAttachments: pdfSummaries
    };
    
    let currentChatId = activeChat?.id;
    let history: Message[];
    let currentPersonaId = activeChat?.personaId;

    const apiKeys = settings.apiKey && settings.apiKey.length > 0
      ? settings.apiKey
      : (process.env.API_KEY ? [process.env.API_KEY] : []);

    const userMessagesCount = (activeChat?.messages || []).filter(m => m.role === MessageRole.USER).length;

    let titleGenerationMode: 'INITIAL' | 'RECURRING' | null = null;
    if (settings.autoTitleGeneration && !!content) {
      const newUserMessageCount = userMessagesCount + 1;
      if (newUserMessageCount === 2) {
        titleGenerationMode = 'INITIAL';
      } else if (newUserMessageCount >= 4 && newUserMessageCount % 4 === 0) {
        titleGenerationMode = 'RECURRING';
      }
    }

    if (!currentChatId) {
      currentPersonaId = settings.defaultPersona;
      const persona = personas.find(p => p.id === currentPersonaId);
      // 优先级：角色默认模型 > 用户最后选择的模型 > 模型列表第一个
      const modelToUse = persona?.model ?? settings.lastSelectedModel ?? availableModels[0] ?? '';
      const newChat: ChatSession = { id: crypto.randomUUID(), title: persona?.name || content.substring(0, 40) || "New Chat", icon: (persona?.avatar?.type === 'emoji' ? persona.avatar.value : '👤') || "💬", messages: [userMessage], createdAt: Date.now(), model: modelToUse, folderId: null, personaId: currentPersonaId };
      currentChatId = newChat.id;
      history = newChat.messages;
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
    } else {
      history = [...(activeChat?.messages || []), userMessage];
      setChats(prev => prev.map(c => c.id === currentChatId ? { ...c, messages: [...c.messages, userMessage] } : c));
    }

    // 如果有PDF内容，需要将其附加到发送给API的历史记录中
    let historyForAPI = history;
    if (pdfContextForAPI) {
      // 创建一个临时的用户消息副本，包含PDF全文（仅用于API）
      const lastMessage = history[history.length - 1];
      const messageWithPDF = {
        ...lastMessage,
        content: lastMessage.content + pdfContextForAPI
      };
      historyForAPI = [...history.slice(0, -1), messageWithPDF];
    }

    await _initiateStream(currentChatId, historyForAPI, currentPersonaId, titleGenerationMode, availableModels);
  }, [activeChat, settings, setChats, setActiveChatId, _initiateStream, personas, availableModels]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!activeChat?.id) return;
    const chatId = activeChat.id;
    setChats(prev => prev.map(chat => {
      if (chat.id !== chatId) return chat;
      
      const messages = [...chat.messages];
      const index = messages.findIndex(m => m.id === messageId);
      if (index === -1) return chat;
      
      messages.splice(index, 1);
      
      return { ...chat, messages };
    }));
  }, [activeChat, setChats]);

  const handleUpdateMessageContent = useCallback((messageId: string, newContent: string) => {
    if (!activeChat?.id) return;
    const chatId = activeChat.id;
    setChats(prev => prev.map(chat => 
      chat.id === chatId
      ? { ...chat, messages: chat.messages.map(m => m.id === messageId ? { ...m, content: newContent } : m) }
      : chat
    ));
  }, [activeChat, setChats]);

  const handleRegenerate = useCallback(() => {
    if (!activeChat?.id || isLoading) return;

    const chatId = activeChat.id;
    const messages = activeChat.messages;

    let lastModelIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === MessageRole.MODEL) {
            lastModelIndex = i;
            break;
        }
    }

    if (lastModelIndex < 1 || messages[lastModelIndex - 1].role !== MessageRole.USER) return;

    const historyForResubmit = messages.slice(0, lastModelIndex);

    if (historyForResubmit.length > 0) {
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: historyForResubmit } : c));
        _initiateStream(chatId, historyForResubmit, activeChat.personaId, null, availableModels);
    }
  }, [activeChat, isLoading, setChats, _initiateStream, availableModels]);

  const handleEditAndResubmit = useCallback((messageId: string, newContent: string) => {
    if (!activeChat?.id || isLoading) return;
    
    const chatId = activeChat.id;
    const messages = activeChat.messages;
    const messageIndex = messages.findIndex(m => m.id === messageId);
    
    if (messageIndex === -1) return;

    const truncatedMessages = messages.slice(0, messageIndex);
    const updatedMessage = { ...messages[messageIndex], content: newContent };
    const historyForResubmit = [...truncatedMessages, updatedMessage];

    if (historyForResubmit.length > 0) {
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: historyForResubmit } : c));
        _initiateStream(chatId, historyForResubmit, activeChat.personaId, null, availableModels);
    }
  }, [activeChat, isLoading, setChats, _initiateStream, availableModels]);

  return { 
    isLoading, 
    handleSendMessage, 
    handleCancel,
    handleDeleteMessage,
    handleUpdateMessageContent,
    handleRegenerate,
    handleEditAndResubmit
  };
};

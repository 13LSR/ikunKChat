import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Icon } from '../Icon';
import { useLocalization } from '../../contexts/LocalizationContext';
import { useToast } from '../../contexts/ToastContext';
import { isFileSupported } from '../../utils/fileUtils';
import { ChatSession } from '../../types';
import { ToolItem } from './ToolItem';
import { ActiveToolIndicator } from './ActiveToolIndicator';
import { FilePreview } from './FilePreview';
import { PDFPreview } from './PDFPreview';
import { PDFParseResult, parsePDFFile, validatePDFFile } from '../../services/pdfService';
import { savePDFDocument } from '../../services/indexedDBService';

export interface ChatInputRef {
  addFiles: (files: File[]) => void;
}

export interface SendMessageData {
  message: string;
  files: File[];
  pdfDocuments: PDFParseResult[];
}

interface ChatInputProps {
  onSendMessage: (message: string, files: File[], pdfDocuments?: PDFParseResult[]) => void;
  isLoading: boolean;
  onCancel: () => void;
  toolConfig: any;
  onToolConfigChange: (config: any) => void;
  input: string;
  setInput: (value: string) => void;
  chatSession: ChatSession | null;
  availableModels: string[];
  currentModel: string;
  onSetModelForActiveChat: (model: string) => void;
}

export interface FileWithId {
  file: File;
  id: string;
}

interface ParsingPDFState {
  fileName: string;
  message: string;
  percentage: number;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(({ onSendMessage, isLoading, onCancel, toolConfig, onToolConfigChange, input, setInput, chatSession, availableModels, currentModel, onSetModelForActiveChat }, ref) => {
   const { t } = useLocalization();
  const { addToast } = useToast();
  const [files, setFiles] = useState<FileWithId[]>([]);
  const [pdfDocuments, setPdfDocuments] = useState<PDFParseResult[]>([]);
  const [parsingPDFs, setParsingPDFs] = useState<Record<string, ParsingPDFState>>({});
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isMobileModelSelectorOpen, setIsMobileModelSelectorOpen] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsWrapperRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const mobileModelSelectorRef = useRef<HTMLDivElement>(null);
  const [isMobileView, setIsMobileView] = useState(window.innerWidth < 768);

  useEffect(() => {
    setFiles([]);
    setPdfDocuments([]);
    setParsingPDFs({});
  }, [chatSession?.id]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const maxHeight = parseInt(getComputedStyle(textareaRef.current).maxHeight, 10);
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [input]);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsWrapperRef.current && !toolsWrapperRef.current.contains(event.target as Node) && toolsButtonRef.current && !toolsButtonRef.current.contains(event.target as Node)) {
        setIsToolsOpen(false);
      }
      if (mobileModelSelectorRef.current && !mobileModelSelectorRef.current.contains(event.target as Node)) {
        setIsMobileModelSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    const handleResize = () => setIsMobileView(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
    }
  }, []);

  const addFiles = async (newFiles: File[]) => {
    // 分离PDF和其他文件
    const pdfFiles = newFiles.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    const otherFiles = newFiles.filter(f => f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf'));
    
    // 处理PDF文件 - 自动解析
    for (const pdfFile of pdfFiles) {
      const parsingId = `${pdfFile.name}-${pdfFile.size}-${pdfFile.lastModified}`;
      const validation = validatePDFFile(pdfFile);
      if (!validation.valid) {
        addToast(`PDF "${pdfFile.name}": ${validation.error}`, 'error');
        continue;
      }
      
      try {
        setParsingPDFs(prev => ({
          ...prev,
          [parsingId]: {
            fileName: pdfFile.name,
            message: '准备解析...',
            percentage: 0,
          },
        }));

        const result = await parsePDFFile(pdfFile, (progress) => {
          setParsingPDFs(prev => ({
            ...prev,
            [parsingId]: {
              fileName: pdfFile.name,
              message: progress.message || '正在解析...',
              percentage: progress.percentage,
            },
          }));
        });
        await savePDFDocument(result);
        setPdfDocuments(prev => [...prev, result]);
        addToast(`PDF "${result.fileName}" 解析成功`, 'success');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '解析失败';
        addToast(`PDF "${pdfFile.name}" 解析失败: ${errorMessage}`, 'error');
      } finally {
        setParsingPDFs(prev => {
          const next = { ...prev };
          delete next[parsingId];
          return next;
        });
      }
    }
    
    // 处理其他文件
    const supportedFiles = otherFiles.filter(isFileSupported);
    if (otherFiles.length - supportedFiles.length > 0) {
      addToast('本站目前只支持上传 txt、pdf、md、docx 文件。', 'error');
    }
    if (supportedFiles.length > 0) {
      setFiles(prev => [...prev, ...supportedFiles.map(file => ({ file, id: crypto.randomUUID() }))]);
    }
  };

  useImperativeHandle(ref, () => ({ addFiles }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const handleRemoveFile = (idToRemove: string) => setFiles(prev => prev.filter(f => f.id !== idToRemove));

  const handlePDFParsed = (result: PDFParseResult) => {
    setPdfDocuments(prev => [...prev, result]);
    addToast(`PDF "${result.fileName}" 解析成功`, 'success');
  };

  const handlePDFError = (error: string) => {
    addToast(error, 'error');
  };

  const handleRemovePDF = (idToRemove: string) => {
    setPdfDocuments(prev => prev.filter(pdf => pdf.id !== idToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || files.length > 0 || pdfDocuments.length > 0) && !isLoading) {
      // 将PDF文档作为独立参数传递，不拼接到消息文本中
      onSendMessage(input.trim(), files.map(f => f.file), pdfDocuments);
      setFiles([]);
      setPdfDocuments([]);
      setIsToolsOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading && !isMobileView) {
        e.preventDefault();
        handleSubmit(e as any);
    }
  }
  

  const toggleMobileModelSelector = () => {
    setIsMobileModelSelectorOpen(prev => !prev);
  };

  const handleMobileModelSelect = (model: string) => {
    onSetModelForActiveChat(model);
    setIsMobileModelSelectorOpen(false);
  };

  return (
    <form onSubmit={handleSubmit} className="chat-input-shell p-2 pt-0 flex flex-col relative">
        <div
          ref={toolsWrapperRef}
          className={`tool-selector-options ${isToolsOpen ? 'visible' : ''}`}
          style={{ backgroundColor: 'var(--neu-surface)', border: '0', boxShadow: 'var(--neu-shadow-raised)' }}
        >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-2 text-left hover:bg-black/10 dark:hover:bg-white/10 flex items-center gap-3 text-[var(--text-color)]"
              title="本站目前只支持上传 txt、pdf、md、docx 文件。"
              data-tooltip="本站目前只支持上传 txt、pdf、md、docx 文件。"
              data-tooltip-placement="top"
            >
                <Icon icon="paperclip" className="w-4 h-4" />
                <span>{t('attachFile') || '上传文件'}</span>
            </button>
            <input ref={fileInputRef} type="file" onChange={handleFileChange} accept=".txt,.pdf,.md,.docx" multiple className="hidden" />
        </div>
        <div
          className="rounded-[var(--radius-2xl)] flex flex-col transition-all duration-300"
          style={{ backgroundColor: 'var(--neu-pressed)', border: '0', boxShadow: 'var(--neu-shadow-inset)' }}
        >
          <FilePreview files={files} onRemoveFile={handleRemoveFile} />
          {Object.values(parsingPDFs).length > 0 && (
            <div className="px-3 pt-2 space-y-2">
              {Object.entries(parsingPDFs).map(([id, pdf]) => (
                <div key={id} className="pdf-parsing-card">
                  <div className="pdf-parsing-icon">
                    <Icon icon="file" className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="pdf-parsing-title">{pdf.fileName}</div>
                    <div className="pdf-parsing-message">{pdf.message}</div>
                    <div className="pdf-parsing-track">
                      <div className="pdf-parsing-progress" style={{ width: `${Math.max(4, pdf.percentage)}%` }} />
                    </div>
                  </div>
                  <span className="pdf-parsing-percent">{pdf.percentage}%</span>
                </div>
              ))}
            </div>
          )}
          {pdfDocuments.length > 0 && (
            <div className="px-3 pt-2">
              {pdfDocuments.map(pdf => (
                <PDFPreview
                  key={pdf.id}
                  pdf={pdf}
                  onRemove={() => handleRemovePDF(pdf.id)}
                />
              ))}
            </div>
          )}
           <ActiveToolIndicator t={t} />
           <div className="flex items-center p-1.5">
            <button ref={toolsButtonRef} type="button" onClick={() => setIsToolsOpen(p => !p)} className={`p-2.5 rounded-full flex-shrink-0 transition-colors mr-2 ${isToolsOpen ? 'text-[var(--md-sys-color-primary)]' : 'text-[var(--text-color-secondary)]'}`} aria-label="Tools"><Icon icon="plus" className="w-5 h-5" /></button>
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('typeMessage')} rows={1} maxLength={15000} className="chat-input-textarea flex-grow bg-transparent focus:outline-none resize-none max-h-48 text-[var(--text-color)] px-2 py-2.5" />
            <button type={isLoading ? 'button' : 'submit'} onClick={isLoading ? onCancel : undefined} disabled={!isLoading && (!input.trim() && files.length === 0 && pdfDocuments.length === 0)} className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-[var(--radius-2xl)] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${isLoading ? 'text-[var(--md-sys-color-error)]' : 'text-[var(--md-sys-color-primary)]'}`} aria-label={isLoading ? 'Stop generation' : 'Send message'}>
                {isLoading ? <Icon icon="stop" className="w-4 h-4" /> : <Icon icon="send" className="w-4 h-4" />}
            </button>
          </div>
        </div>
    </form>
  )
});

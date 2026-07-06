import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatSession } from '../../types';
import { Icon } from '../Icon';
import { ModelSelector } from '../ModelSelector';
import { useLocalization } from '../../contexts/LocalizationContext';
import { ModelOption } from '../../services/llm/types';

interface ChatHeaderProps {
    chatSession: ChatSession | null;
    onNewChat: () => void;
    availableModels: string[];
    availableModelOptions: ModelOption[];
    onSetModelForActiveChat: (model: string, routeId?: string) => void;
    currentModel: string;
    currentModelRouteId?: string;
    isSidebarCollapsed: boolean;
    onToggleSidebar: () => void;
    onToggleMobileSidebar: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ chatSession, onNewChat, availableModels, availableModelOptions, onSetModelForActiveChat, currentModel, currentModelRouteId, isSidebarCollapsed, onToggleSidebar, onToggleMobileSidebar }) => {
    const { t } = useLocalization();
    const [isMobileModelSelectorOpen, setIsMobileModelSelectorOpen] = useState(false);
    const mobileModelSelectorRef = useRef<HTMLDivElement>(null);
    const normalizedModelOptions = useMemo<ModelOption[]>(
        () => availableModelOptions.length > 0
            ? availableModelOptions
            : availableModels.map(id => ({ id, label: id, routeId: 'default', channelName: 'Default' })),
        [availableModelOptions, availableModels]
    );
    const mobileModelGroups = useMemo(() => {
        const groups = new Map<string, { id: string; name: string; models: ModelOption[] }>();
        normalizedModelOptions.forEach(model => {
            const id = model.routeId || model.channelName || 'default';
            const name = model.channelName || model.routeId || 'Default';
            const group = groups.get(id);
            if (group) {
                group.models.push(model);
            } else {
                groups.set(id, { id, name, models: [model] });
            }
        });
        return Array.from(groups.values());
    }, [normalizedModelOptions]);

    const toggleMobileModelSelector = () => {
        setIsMobileModelSelectorOpen(prev => !prev);
    };

    const selectedModel = chatSession?.model || currentModel;
    const selectedRouteId = chatSession?.modelRouteId || currentModelRouteId;

    const handleMobileModelSelect = (model: ModelOption) => {
        onSetModelForActiveChat(model.id, model.routeId);
        setIsMobileModelSelectorOpen(false);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (mobileModelSelectorRef.current && !mobileModelSelectorRef.current.contains(event.target as Node)) {
                setIsMobileModelSelectorOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <header className="chat-header-surface flex-shrink-0 flex items-center justify-between gap-2 relative z-[150]">
            <div className="flex items-center gap-2 min-w-0">
                <button
                    onClick={onToggleMobileSidebar}
                    className="md:hidden p-3 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors active:scale-95"
                    style={{
                        minWidth: '48px',
                        minHeight: '48px',
                        WebkitTapHighlightColor: 'transparent'
                    }}
                    aria-label={t('expandSidebar')}
                    data-tooltip={t('expandSidebar')}
                    data-tooltip-placement="right"
                    type="button"
                >
                    <Icon icon="menu" className="w-6 h-6" />
                </button>
                {isSidebarCollapsed && (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleSidebar();
                        }}
                        className="hidden md:flex items-center justify-center p-3 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors active:scale-95"
                        aria-label={t('expandSidebar')}
                        data-tooltip={t('expandSidebar')}
                        data-tooltip-placement="right"
                        type="button"
                    >
                        <Icon icon="menu" className="w-6 h-6" />
                    </button>
                )}
                {!isSidebarCollapsed && (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleSidebar();
                        }}
                        className="hidden md:flex items-center justify-center p-3 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors active:scale-95"
                        aria-label={t('collapseSidebar')}
                        data-tooltip={t('collapseSidebar')}
                        data-tooltip-placement="right"
                        type="button"
                    >
                        <Icon icon="panel-left-close" className="w-6 h-6" />
                    </button>
                )}
                {chatSession && (
                    <h2 className="text-xl font-bold text-[var(--text-color)] truncate">{chatSession.title}</h2>
                )}
            </div>
            {/* 桌面端按钮 - 始终显示 */}
            <div className="hidden md:flex items-center gap-2 ml-auto">
                <button onClick={() => onNewChat()} className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10" data-tooltip={t('newChat')} data-tooltip-placement="left">
                    <Icon icon="plus" className="w-5 h-5" />
                </button>
                <div className="w-64">
                    <ModelSelector
                        models={availableModels}
                        modelOptions={availableModelOptions}
                        selectedModel={selectedModel}
                        selectedRouteId={selectedRouteId}
                        onModelChange={onSetModelForActiveChat}
                        isHeader={true}
                    />
                </div>
            </div>
            
            {/* 移动端按钮 - 始终显示 */}
            <div className="md:hidden flex items-center gap-2 ml-auto">
                <button onClick={() => onNewChat()} className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10" data-tooltip={t('newChat')} data-tooltip-placement="left">
                    <Icon icon="plus" className="w-5 h-5" />
                </button>
                <div className="relative" ref={mobileModelSelectorRef}>
                    <button
                        onClick={toggleMobileModelSelector}
                        className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                        data-tooltip={t('switchModel')}
                        data-tooltip-placement="left"
                    >
                        <Icon icon="chip" className="w-6 h-6" />
                    </button>
                    {isMobileModelSelectorOpen && (
                        <div className="absolute top-16 right-0 z-10 w-48 max-h-60 overflow-y-auto">
                            <div className="glass-pane rounded-[var(--radius-2xl)] p-2">
                                {mobileModelGroups.map(group => (
                                    <div key={group.id} className="mb-1 last:mb-0">
                                        <div className="px-2 py-1 text-xs font-semibold text-[var(--text-color-secondary)] truncate">{group.name}</div>
                                        {group.models.map(model => (
                                            <div
                                                key={`${model.routeId || 'default'}:${model.id}`}
                                                onClick={() => handleMobileModelSelect(model)}
                                                className={`custom-select-option p-2 rounded-[var(--radius-2xl)] cursor-pointer flex items-center gap-2 ${
                                                    selectedModel === model.id && (!selectedRouteId || selectedRouteId === model.routeId) ? 'active' : ''
                                                }`}
                                            >
                                                <Icon icon="chip" className="w-4 h-4" />
                                                <span className="text-sm truncate">{model.label || model.id}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};

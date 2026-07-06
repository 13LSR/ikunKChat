import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Icon } from './Icon';
import { ModelOption } from '../services/llm/types';

interface ModelSelectorProps {
  models: string[];
  modelOptions?: ModelOption[];
  selectedModel: string;
  selectedRouteId?: string;
  onModelChange: (model: string, routeId?: string) => void;
  isHeader?: boolean;
}

interface ModelChannel {
  id: string;
  name: string;
  models: ModelOption[];
}

const fallbackChannelId = 'default';

const normalizeModelOptions = (models: string[], modelOptions?: ModelOption[]): ModelOption[] => {
  if (modelOptions && modelOptions.length > 0) return modelOptions;
  return models.map(id => ({
    id,
    label: id,
    routeId: fallbackChannelId,
    channelName: 'Default',
  }));
};

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  models,
  modelOptions,
  selectedModel,
  selectedRouteId,
  onModelChange,
  isHeader = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const normalizedModels = useMemo(
    () => normalizeModelOptions(models, modelOptions),
    [models, modelOptions]
  );

  const channels = useMemo<ModelChannel[]>(() => {
    const channelMap = new Map<string, ModelChannel>();

    normalizedModels.forEach(model => {
      const id = model.routeId || model.channelName || fallbackChannelId;
      const name = model.channelName || model.routeId || 'Default';
      const existing = channelMap.get(id);

      if (existing) {
        existing.models.push(model);
        return;
      }

      channelMap.set(id, { id, name, models: [model] });
    });

    return Array.from(channelMap.values());
  }, [normalizedModels]);

  const selectedOption = useMemo(() => {
    return normalizedModels.find(model =>
      model.id === selectedModel &&
      (!selectedRouteId || model.routeId === selectedRouteId)
    ) || normalizedModels.find(model => model.id === selectedModel);
  }, [normalizedModels, selectedModel, selectedRouteId]);

  const [activeChannelId, setActiveChannelId] = useState<string>(() =>
    selectedOption?.routeId || channels[0]?.id || fallbackChannelId
  );

  useEffect(() => {
    if (!isOpen) return;
    setActiveChannelId(selectedOption?.routeId || channels[0]?.id || fallbackChannelId);
  }, [channels, isOpen, selectedOption]);

  const activeChannel = channels.find(channel => channel.id === activeChannelId) || channels[0];
  const displayChannelName = selectedOption?.channelName || selectedOption?.routeId || 'Model';
  const displayModelName = selectedOption?.label || selectedModel || 'Select Model';
  const triggerText = selectedOption ? `${displayChannelName} / ${displayModelName}` : displayModelName;
  const compactTriggerText = triggerText.length > 24 ? `${triggerText.substring(0, 24)}...` : triggerText;

  const toggleOpen = () => setIsOpen(prev => !prev);

  const handleSelect = (model: ModelOption) => {
    onModelChange(model.id, model.routeId);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="model-selector-wrapper" ref={wrapperRef}>
      <div className={`model-selector-options glass-pane border-opacity-30 ${isOpen ? 'visible' : ''} ${isHeader ? 'header-selector' : ''}`}>
        {channels.length === 0 ? (
          <div className="model-selector-option">
            <Icon icon="chip" className="w-5 h-5 flex-shrink-0" />
            <span>Models loading...</span>
          </div>
        ) : (
          <div className="flex gap-2 min-w-[360px] max-w-[min(78vw,520px)]">
            <div className="w-36 shrink-0 space-y-1">
              {channels.map(channel => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setActiveChannelId(channel.id)}
                  className={`model-selector-option w-full text-left ${activeChannel?.id === channel.id ? 'active' : ''}`}
                >
                  <Icon icon="arrow-left-right" className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              {activeChannel?.models.map(model => (
                <button
                  key={`${model.routeId || fallbackChannelId}:${model.id}`}
                  type="button"
                  onClick={() => handleSelect(model)}
                  className={`model-selector-option w-full text-left ${
                    selectedModel === model.id &&
                    (!selectedRouteId || selectedRouteId === model.routeId)
                      ? 'active'
                      : ''
                  }`}
                >
                  <Icon icon="chip" className="w-5 h-5 flex-shrink-0" />
                  <span className="truncate">{model.label || model.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button onClick={toggleOpen} className="model-selector-trigger glass-pane border-opacity-30" type="button">
        <div className="flex items-center gap-3 min-w-0">
          <Icon icon="arrow-left-right" className="w-5 h-5 text-[var(--accent-color)] flex-shrink-0" />
          <span className="font-semibold text-[var(--text-color)] truncate max-w-[170px]">{compactTriggerText}</span>
        </div>
        <Icon icon="chevron-down" className={`w-5 h-5 text-[var(--text-color-secondary)] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
};

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Settings } from '../../types';
import { useLocalization } from '../../contexts/LocalizationContext';
import { isApiKeySetByEnv, isApiBaseUrlSetByEnv } from '../../hooks/useSettings';

interface AdvancedSettingsProps {
  settings: Settings;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
  visibleIds: Set<string>;
  availableModels: string[];
}

const settingsToJson = (settings: Settings): string => {
  const config: Record<string, unknown> = {
    provider: settings.llmProvider || 'gemini',
    apiKey: settings.apiKey && settings.apiKey.length > 0 ? settings.apiKey : [''],
    apiBaseUrl: settings.apiBaseUrl || '',
    customModels: settings.customModels || '',
    temperature: settings.temperature ?? 0.7,
    maxOutputTokens: settings.maxOutputTokens ?? 16384,
    contextLength: settings.contextLength ?? 50,
    streamInactivityTimeout: settings.streamInactivityTimeout ?? 120,
    enableSearch: settings.enableSearch ?? false,
  };
  if (isApiBaseUrlSetByEnv || isApiKeySetByEnv) {
    config.useCustomApi = settings.useCustomApi ?? false;
  }
  return JSON.stringify(config, null, 2);
};

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({ settings, onSettingsChange }) => {
  const { t } = useLocalization();
  const [jsonText, setJsonText] = useState(() => settingsToJson(settings));
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSyncRef = useRef(false);

  // Sync from external settings changes (not from user editing the textarea)
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    setJsonText(settingsToJson(settings));
    setError(false);
  }, [settings]);

  const applyJson = useCallback((text: string) => {
    try {
      const config = JSON.parse(text);
      if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        setError(true);
        return;
      }
      setError(false);
      skipSyncRef.current = true;

      const patch: Partial<Settings> = {};
      if (config.provider === 'gemini' || config.provider === 'openai' || config.provider === 'proxy') {
        patch.llmProvider = config.provider;
      }
      if (Array.isArray(config.apiKey)) {
        patch.apiKey = config.apiKey.filter((k: unknown) => typeof k === 'string' && k.trim());
        if (patch.apiKey.length === 0) patch.apiKey = [''];
      }
      if (typeof config.apiBaseUrl === 'string') {
        patch.apiBaseUrl = config.apiBaseUrl;
      }
      if (typeof config.customModels === 'string') {
        patch.customModels = config.customModels;
      }
      if (typeof config.temperature === 'number') {
        patch.temperature = config.temperature;
      }
      if (typeof config.maxOutputTokens === 'number') {
        patch.maxOutputTokens = config.maxOutputTokens;
      }
      if (typeof config.contextLength === 'number') {
        patch.contextLength = config.contextLength;
      }
      if (typeof config.streamInactivityTimeout === 'number') {
        patch.streamInactivityTimeout = config.streamInactivityTimeout;
      }
      if (typeof config.enableSearch === 'boolean') {
        patch.enableSearch = config.enableSearch;
      }
      if (typeof config.useCustomApi === 'boolean') {
        patch.useCustomApi = config.useCustomApi;
      }

      onSettingsChange(patch);
    } catch {
      setError(true);
    }
  }, [onSettingsChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setJsonText(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applyJson(text), 500);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">{t('apiConfig')}</h3>
      <p className="settings-item-description mb-3">{t('apiConfigDesc')}</p>
      <textarea
        value={jsonText}
        onChange={handleChange}
        spellCheck={false}
        className={`input-glass w-full font-mono text-sm leading-relaxed resize-y min-h-[320px] ${
          error ? '!border-red-500' : ''
        }`}
        style={{ tabSize: 2 }}
      />
      {error && (
        <p className="text-red-500 text-sm mt-2">{t('apiConfigError')}</p>
      )}
    </div>
  );
};

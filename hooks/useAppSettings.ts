import { useCallback } from 'react';
import { useSettings } from './useSettings';
import { useTheme } from './useTheme';
import { Settings, Persona } from '../types';
import { ModelOption } from '../services/llm/types';

interface UseAppSettingsReturn {
  // 设置相关
  settings: Settings;
  setSettings: (settings: Partial<Settings>) => void;
  availableModels: string[];
  availableModelOptions: ModelOption[];
  isStorageLoaded: boolean;
  refreshModels: () => Promise<boolean>;
  isRefreshingModels: boolean;
  
  // 主题相关
  themeLoaded: boolean;
  
  // 设置变更处理
  handleSettingsChange: (newSettings: Partial<Settings>) => void;
  
  // 默认人格验证
  validateAndUpdateDefaultPersona: (personas: Persona[]) => void;
}

/**
 * AppSettings Hook - 处理设置管理和主题控制
 * 职责：设置状态管理、主题应用、默认人格验证
 */
export const useAppSettings = (): UseAppSettingsReturn => {
  const {
    settings,
    setSettings,
    availableModels,
    availableModelOptions,
    isStorageLoaded,
    refreshModels,
    isRefreshingModels,
  } = useSettings();
  
  // 应用主题
  useTheme(settings, isStorageLoaded);

  // 处理设置变更
  const handleSettingsChange = useCallback(
    (newSettings: Partial<Settings>) => {
      setSettings((prev) => ({ ...prev, ...newSettings }));
    },
    [setSettings]
  );

  // 默认人格验证逻辑
  const validateAndUpdateDefaultPersona = useCallback(
    (personas: Persona[]) => {
      if (personas.length === 0) return;

      const currentDefaultPersonaId = settings.defaultPersona;
      const isDefaultPersonaValid = personas.some((p) => p.id === currentDefaultPersonaId);

      if (!isDefaultPersonaValid) {
        const firstAvailablePersona = personas[0];
        if (firstAvailablePersona) {
          handleSettingsChange({ defaultPersona: firstAvailablePersona.id });
        }
      }
    },
    [settings.defaultPersona, handleSettingsChange]
  );

  return {
    settings,
    setSettings,
    availableModels,
    availableModelOptions,
    isStorageLoaded,
    refreshModels,
    isRefreshingModels,
    themeLoaded: isStorageLoaded,
    handleSettingsChange,
    validateAndUpdateDefaultPersona
  };
};

import { useState, useEffect } from 'react';
import { Settings } from '../types';
import { useLocalization } from '../contexts/LocalizationContext';
import { createLLMService } from '../services/llm/llmFactory';
import { loadSettings, saveSettings } from '../services/storageService';
import { USE_EMERGENCY_ROUTE } from '../emergency.config';

const defaultSettings: Settings = {
  theme: 'apple-light',
  language: 'zh',
  fontFamily: 'lxgw',
  colorPalette: 'neutral',
  customColor: undefined,
  apiKey: [],
  lastSelectedModel: undefined,
  defaultPersona: 'default-math-assistant',
  autoTitleGeneration: true,
  titleGenerationModel: '',
  showThoughts: true,
  optimizeFormatting: false,
  thinkDeeper: false,
  enableSearch: false,
  apiBaseUrl: '',
  temperature: 0.7,
  maxOutputTokens: 16384,
  contextLength: 50,
  password: undefined,
  pdfQuality: 'hd',
  fontSize: 100,
};

// 检测环境变量中是否有 API Key 配置
const hasGeminiEnvKey = !!(process.env.GEMINI_API_KEY?.trim());
const hasOpenAIEnvKey = !!(process.env.OPENAI_API_KEY?.trim());
const workerApiBaseUrl = ((import.meta as any).env?.VITE_WORKER_API_BASE_URL || '').trim();
const hasWorkerProxy = !!workerApiBaseUrl;
const hasEnvApiKey = hasGeminiEnvKey || hasOpenAIEnvKey || hasWorkerProxy;
const faviconByTheme: Record<Settings['theme'], string> = {
  'apple-light': 'https://tc.lcxj.dpdns.org/docs/mgb.ico',
  'apple-dark': 'https://tc.lcxj.dpdns.org/docs/mgh.ico',
};

const syncFavicon = (theme: Settings['theme']) => {
  const href = faviconByTheme[theme] || faviconByTheme['apple-light'];
  let favicon = document.querySelector<HTMLLinkElement>('link#app-favicon');

  if (!favicon) {
    favicon = document.createElement('link');
    favicon.id = 'app-favicon';
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }

  favicon.type = 'image/x-icon';
  favicon.href = href;
};

// 从环境变量获取 API 配置
const getEnvApiConfig = () => {
  if (hasWorkerProxy) {
    return {
      provider: 'proxy' as const,
      apiKey: 'worker-proxy',
      apiBaseUrl: workerApiBaseUrl,
    };
  }

  const useEmergency = USE_EMERGENCY_ROUTE && process.env.FALLBACK_API_BASE_URL;

  if (useEmergency) {
    return {
      provider: 'gemini' as const,
      apiKey: process.env.FALLBACK_API_KEY?.trim() || '',
      apiBaseUrl: process.env.FALLBACK_API_BASE_URL?.trim() || '',
    };
  }

  if (hasGeminiEnvKey && !hasOpenAIEnvKey) {
    return {
      provider: 'gemini' as const,
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      apiBaseUrl: process.env.API_BASE_URL?.trim() || '',
    };
  }

  if (hasOpenAIEnvKey && !hasGeminiEnvKey) {
    return {
      provider: 'openai' as const,
      apiKey: process.env.OPENAI_API_KEY!.trim(),
      apiBaseUrl: process.env.OPENAI_API_BASE_URL?.trim() || '',
    };
  }

  if (hasGeminiEnvKey && hasOpenAIEnvKey) {
    // 两者都有，默认使用 Gemini，用户可以切换
    return {
      provider: 'gemini' as const,
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      apiBaseUrl: process.env.API_BASE_URL?.trim() || '',
    };
  }

  return null;
};

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const { setLanguage } = useLocalization();

  // 环境变量配置（不存到 localStorage）
  const envConfig = getEnvApiConfig();

  useEffect(() => {
    const loadedSettings = loadSettings();
    const initialSettings = { ...defaultSettings, ...loadedSettings };

    // 如果有环境变量配置
    if (envConfig) {
      initialSettings.llmProvider = envConfig.provider;

      if (envConfig.provider === 'proxy') {
        initialSettings.useCustomApi = false;
        initialSettings.apiKey = [];
        initialSettings.apiBaseUrl = '';
      }

      // 关键修改：只有在用户启用了自定义 API 配置时，才保留用户的设置
      // 否则，清空 apiKey 和 apiBaseUrl，避免暴露环境变量
      if (!initialSettings.useCustomApi) {
        // 用户未启用自定义，清空这些字段，实际使用时从环境变量读取
        initialSettings.apiKey = [];
        initialSettings.apiBaseUrl = '';
      }
      // 如果用户启用了自定义，保留 loadedSettings 中的值
    }

    // 如果没有环境变量配置，保持用户之前的手动配置或默认值
    if (!initialSettings.llmProvider) {
      initialSettings.llmProvider = 'gemini';
    }

    setSettings(initialSettings);
    setLanguage(initialSettings.language);
    setIsStorageLoaded(true);
  }, [setLanguage]);

  useEffect(() => {
    if (!isStorageLoaded) return;

    // 保存设置时，排除 apiKey 和 apiBaseUrl（如果来自环境变量且用户未启用自定义）
    // 这样环境变量不会被缓存到 localStorage
    const settingsToSave = { ...settings };
    if ((hasEnvApiKey || isApiBaseUrlSetByEnv) && !settings.useCustomApi) {
      // 环境变量有配置且用户未启用自定义，不保存 API 配置到 localStorage
      delete (settingsToSave as Record<string, unknown>).apiKey;
      delete (settingsToSave as Record<string, unknown>).apiBaseUrl;
    }
    saveSettings(settingsToSave);

    // Clear all previous theme classes
    document.body.classList.remove('theme-apple-light', 'theme-apple-dark');

    // Apply theme class
    document.body.classList.add(`theme-${settings.theme}`);
    syncFavicon(settings.theme);

    document.body.dataset.font = settings.fontFamily;

    // Apply font size
    const fontSizeMultiplier = (settings.fontSize || 100) / 100;
    document.documentElement.style.setProperty('--font-size-multiplier', `${fontSizeMultiplier}`);

    setLanguage(settings.language);
  }, [settings, isStorageLoaded, setLanguage]);

  useEffect(() => {
    if (!isStorageLoaded) return;

    const customModelsList = settings.customModels
      ? settings.customModels.split(/[\n,]+/).map(m => m.trim()).filter(Boolean)
      : [];

    // 先展示用户手填的模型，避免接口拉取卡住时选择器一直为空。
    if (customModelsList.length > 0) {
      setAvailableModels(currentModels => {
        const mergedModels = [...new Set([...currentModels, ...customModelsList])];
        return mergedModels.length === currentModels.length &&
          mergedModels.every((model, index) => model === currentModels[index])
          ? currentModels
          : mergedModels;
      });
    } else {
      setAvailableModels(currentModels => {
        if (currentModels.length === 0) return currentModels;
        return [];
      });
    }

    // 获取实际使用的 API Key 和 Base URL
    let actualApiKey = '';
    let actualApiBaseUrl = '';

    const shouldUseManualConfig = settings.useCustomApi || !envConfig;

    if (shouldUseManualConfig) {
      // 用户启用了自定义配置
      const apiKeys = settings.apiKey || [];
      actualApiKey = apiKeys.length > 0 ? apiKeys[0] : '';
      actualApiBaseUrl = settings.apiBaseUrl || '';
    } else if (envConfig) {
      // 用户未启用自定义，使用环境变量
      actualApiKey = envConfig.apiKey;
      actualApiBaseUrl = envConfig.apiBaseUrl;
    }

    const applyModels = (fetchedModels: string[]) => {
      const allModels = [...new Set([...fetchedModels, ...customModelsList])];

      if (allModels.length === 0) return;

      setAvailableModels(allModels);
      setSettings(current => {
        const newDefaults: Partial<Settings> = {};
        // 如果 lastSelectedModel 不在模型列表中，清空它（会自动使用第一个模型）
        if (current.lastSelectedModel && !allModels.includes(current.lastSelectedModel)) {
          newDefaults.lastSelectedModel = undefined;
        }
        // 标题生成模型逻辑：优先使用环境变量，否则取列表最后一位
        const envTitleModel = process.env.TITLE_MODEL_NAME?.trim();
        if (envTitleModel) {
          // 环境变量有配置，使用环境变量
          newDefaults.titleGenerationModel = envTitleModel;
        } else if (!allModels.includes(current.titleGenerationModel)) {
          // 环境变量没有配置，取列表最后一位
          newDefaults.titleGenerationModel = allModels[allModels.length - 1] || '';
        }
        return Object.keys(newDefaults).length > 0 ? { ...current, ...newDefaults } : current;
      });
    };

    if (!actualApiKey) {
      applyModels([]);
      return;
    }

    const llmService = createLLMService(settings);
    llmService.getAvailableModels(actualApiKey, actualApiBaseUrl)
      .then(applyModels)
      .catch(() => applyModels([]));
  }, [isStorageLoaded, settings.apiKey, settings.apiBaseUrl, settings.llmProvider, settings.useCustomApi, settings.customModels, authVersion]);

  useEffect(() => {
    const handleAuthChanged = () => setAuthVersion(version => version + 1);
    window.addEventListener('kchat-auth-changed', handleAuthChanged);
    return () => window.removeEventListener('kchat-auth-changed', handleAuthChanged);
  }, []);

  return { settings, setSettings, availableModels, isStorageLoaded };
};

// 导出环境变量配置状态，供设置界面使用
export const isApiKeySetByEnv = hasEnvApiKey;
export const isApiBaseUrlSetByEnv = !!(
  workerApiBaseUrl ||
  process.env.API_BASE_URL ||
  process.env.OPENAI_API_BASE_URL ||
  (USE_EMERGENCY_ROUTE && process.env.FALLBACK_API_BASE_URL)
);

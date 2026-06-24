import React, { useState, useEffect } from 'react';
import { Settings, Persona } from '../../types';
import { Icon, type IconName } from '../Icon';
import { useLocalization } from '../../contexts/LocalizationContext';
import { useSettingsSearch } from '../../hooks/useSettingsSearch';
import { SettingsSection } from './SettingsSection';
import { GeneralSettings } from './GeneralSettings';
import { BehaviorSettings } from './BehaviorSettings';
import { AdvancedSettings } from './AdvancedSettings';
import { DataManagement } from './DataManagement';
import { PDFManagement } from './PDFManagement';
import { AboutSettings } from './AboutSettings';

interface SettingsModalProps {
  settings: Settings;
  onClose: () => void;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
  onExportSettings: () => void;
  onExportAll: () => void;
  onExportSelectedChats: () => void;
  onImport: (file: File) => void;
  onClearAll: () => void;
  onClearChatHistory: () => void;
  availableModels: string[];
  personas: Persona[];
  versionInfo: { version: string } | null;
}

type SettingsTab = 'general' | 'behavior' | 'data' | 'about' | 'advanced';

export const SettingsModal: React.FC<SettingsModalProps> = ({ versionInfo, ...props }) => {
  const { t } = useLocalization();
  const [isVisible, setIsVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { visibleSettingIds, sectionVisibility } = useSettingsSearch(searchQuery);

  const tabs: Array<{ id: SettingsTab; label: string; icon: IconName }> = [
    { id: 'general', label: t('general'), icon: 'palette' },
    { id: 'behavior', label: t('behavior'), icon: 'message-square' },
    { id: 'data', label: t('data'), icon: 'download' },
    { id: 'about', label: t('about'), icon: 'info' },
    { id: 'advanced', label: t('advanced'), icon: 'code' },
  ];

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(props.onClose, 300);
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const showAllSections = !!searchQuery.trim();

  return (
    <>
      <div className={`modal-backdrop ${isVisible ? 'visible' : ''}`} onClick={handleClose}></div>
      <div className={`modal-dialog modal-dialog-lg settings-modal ${isVisible ? 'visible' : ''} glass-pane rounded-[var(--radius-2xl)] p-6 flex flex-col`}>
        <div className="settings-modal-header flex items-center justify-between mb-4 flex-shrink-0 gap-4">
          <h2 className="text-xl font-bold text-[var(--text-color)]">{t('settings')}</h2>
          <div className="sidebar-search-wrapper settings-search">
            <Icon icon="search" className="sidebar-search-icon w-4 h-4" />
            <input
              type="text"
              placeholder="Search settings..."
              className="sidebar-search-input !py-2 !text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 -mr-2" type="button">
            <Icon icon="close" className="w-5 h-5"/>
          </button>
        </div>

        <div className="settings-modal-body flex-grow min-h-0">
          <nav className="settings-nav" aria-label={t('settings')}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`settings-nav-item ${!showAllSections && activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon icon={tab.icon} className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content flex-grow min-h-0 overflow-y-auto">
            {showAllSections || activeTab === 'general' ? (
              <SettingsSection title={t('general')} isVisible={showAllSections || sectionVisibility.general}>
                <GeneralSettings {...props} visibleIds={visibleSettingIds} />
              </SettingsSection>
            ) : null}

            {showAllSections || activeTab === 'behavior' ? (
              <SettingsSection title={t('behavior')} isVisible={showAllSections || sectionVisibility.behavior}>
                <BehaviorSettings {...props} visibleIds={visibleSettingIds} availableModels={props.availableModels} />
              </SettingsSection>
            ) : null}

            {showAllSections || activeTab === 'data' ? (
              <SettingsSection title={t('data')} isVisible={showAllSections || sectionVisibility.data}>
                <DataManagement
                  settings={props.settings}
                  onSettingsChange={props.onSettingsChange}
                  onExportSettings={props.onExportSettings}
                  onExportAll={props.onExportAll}
                  onExportSelected={() => props.onExportSelectedChats()}
                  onImport={props.onImport}
                  onClearAll={props.onClearAll}
                  onClearChatHistory={props.onClearChatHistory}
                  visibleIds={visibleSettingIds}
                />

                <div className="settings-subsection">
                  <PDFManagement visibleIds={visibleSettingIds} />
                </div>
              </SettingsSection>
            ) : null}

            {activeTab === 'about' && !showAllSections ? (
              <SettingsSection title={t('about')} isVisible={true}>
                <AboutSettings versionInfo={versionInfo} />
              </SettingsSection>
            ) : null}

            {showAllSections || activeTab === 'advanced' ? (
              <SettingsSection title={t('advanced')} isVisible={showAllSections || sectionVisibility.advanced}>
                <AdvancedSettings {...props} visibleIds={visibleSettingIds} availableModels={props.availableModels} />
              </SettingsSection>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
};

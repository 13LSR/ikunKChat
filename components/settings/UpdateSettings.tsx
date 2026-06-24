import React, { useState, useEffect } from 'react';
import { Icon } from '../Icon';
import { useLocalization } from '../../contexts/LocalizationContext';
import { UpdateStatus } from '../../hooks/usePWAUpdate';

interface UpdateSettingsProps {
  versionInfo: { version: string } | null;
  updateAvailable: boolean;
  isCheckingUpdate: boolean;
  updateStatus: UpdateStatus;
  onClose: () => void;
  onCheckUpdate: () => void;
  onUpdateNow: () => void;
}

export const UpdateSettings: React.FC<UpdateSettingsProps> = ({
  versionInfo,
  updateAvailable,
  isCheckingUpdate,
  updateStatus,
  onClose,
  onCheckUpdate,
  onUpdateNow
}) => {
  const { t } = useLocalization();
  const [isVisible, setIsVisible] = useState(false);

  // 根据状态显示不同的图标和文本
  const getStatusDisplay = () => {
    switch (updateStatus) {
      case 'checking':
        return { icon: 'history', text: '正在检查更新...', color: 'text-blue-500', spinning: true };
      case 'available':
        return { icon: 'download', text: '发现新版本', color: 'text-green-500', spinning: false };
      case 'downloading':
        return { icon: 'download', text: '正在下载更新...', color: 'text-blue-500', spinning: true };
      case 'ready':
        return { icon: 'check-circle', text: '准备更新', color: 'text-green-500', spinning: false };
      case 'error':
        return { icon: 'alert-circle', text: '检查失败', color: 'text-red-500', spinning: false };
      default:
        return { icon: 'info', text: '就绪', color: 'text-gray-500', spinning: false };
    }
  };

  const statusDisplay = getStatusDisplay();

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', handleKeyDown); };
  }, []);

  const handleClose = () => { setIsVisible(false); setTimeout(onClose, 300); };

  return (
    <>
      <div className={`modal-backdrop ${isVisible ? 'visible' : ''}`} onClick={handleClose}></div>
      <div className={`modal-dialog modal-dialog-md ${isVisible ? 'visible' : ''} glass-pane rounded-[var(--radius-2xl)] p-6 flex flex-col`}>
        <div className="flex items-center justify-between mb-4 flex-shrink-0 gap-4">
          <h2 className="text-xl font-bold text-[var(--text-color)]">{t('update')}</h2>
          <button onClick={handleClose} className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 -mr-2">
            <Icon icon="close" className="w-5 h-5"/>
          </button>
        </div>
        
        <div className="flex-grow min-h-0 overflow-y-auto -mr-4 pr-4 pb-4">
          <div className="space-y-4">
            {/* 更新状态指示器 */}
            <div className="flex items-center justify-center gap-3 p-4 bg-[var(--bg-secondary)] rounded-2xl">
              <Icon
                icon={statusDisplay.icon}
                className={`w-6 h-6 ${statusDisplay.color} ${statusDisplay.spinning ? 'animate-spin' : ''}`}
              />
              <span className={`font-medium ${statusDisplay.color}`}>
                {statusDisplay.text}
              </span>
            </div>

            {/* 检查更新按钮 */}
            <button
              onClick={onCheckUpdate}
              disabled={isCheckingUpdate || updateStatus === 'checking'}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-[var(--accent-color)] text-[var(--accent-color-text)] rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            >
              <Icon icon="history" className={`w-5 h-5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              <span>{isCheckingUpdate ? '检查中...' : t('checkForUpdate')}</span>
            </button>
            
            <p className="text-xs text-[var(--text-color-secondary)] px-4 text-center">
              {t('updatePrompt')}
            </p>

            {/* 立即更新按钮 */}
            {updateAvailable && (
              <div className="space-y-2">
                <button
                  onClick={onUpdateNow}
                  className="neu-button w-full flex items-center justify-center gap-3 px-4 py-3 text-[var(--text-color)] rounded-[var(--radius-2xl)]"
                >
                  <Icon icon="download" className="w-5 h-5" />
                  <span>{t('updateNow')}</span>
                </button>
                <p className="text-xs text-center text-green-600 dark:text-green-400">
                  🎉 新版本已就绪，点击上方按钮立即更新
                </p>
              </div>
            )}

            {/* 版本信息 */}
            <div className="pt-4 border-t border-[var(--border-color)]">
              <p className="text-center text-sm text-[var(--text-color-secondary)]">
                {t('currentVersion')}: <span className="font-mono font-semibold text-[var(--text-color)]">{versionInfo?.version || '...'}</span>
              </p>
              {updateStatus === 'error' && (
                <p className="text-center text-xs text-red-500 mt-2">
                  ⚠️ 检查更新时出现错误，请稍后重试
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

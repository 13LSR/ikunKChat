import React from 'react';
import { useLocalization } from '../../contexts/LocalizationContext';
import { Icon } from '../Icon';

interface AboutSettingsProps {
  versionInfo: { version: string } | null;
}

export const AboutSettings: React.FC<AboutSettingsProps> = ({ versionInfo }) => {
  const { t } = useLocalization();

  return (
    <div className="space-y-6 text-sm text-[var(--text-color-secondary)]">
      
      <div className="space-y-4">
        <h3 className="font-bold text-lg text-[var(--text-color)]">隐私声明</h3>
        <p className="text-base">本网站不会收集任何个人隐私,所有数据均存储在本地。</p>
      </div>

      <div className="border-t border-[var(--glass-border)] pt-6 space-y-4">
        <h3 className="font-bold text-lg text-[var(--text-color)]">{t('webmaster')}</h3>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--md-sys-color-primary)] font-bold overflow-hidden" style={{ background: 'var(--neu-surface)', boxShadow: 'var(--neu-shadow-inset)' }}>
            <img
              src="https://tc.lcxj.dpdns.org/docs/1757001944794.ico"
              alt="Webmaster Avatar"
              className="w-full h-full object-cover"
              onLoad={(e) => {
                const target = e.target as HTMLImageElement;
                console.log('[AboutSettings] ✅ 站长头像加载成功');
                console.log('[AboutSettings] 图片实际尺寸:', target.naturalWidth, 'x', target.naturalHeight);
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                console.error('[AboutSettings] ❌ 站长头像加载失败');
                console.error('[AboutSettings] 图片路径:', target.src);
                console.error('[AboutSettings] 当前URL:', window.location.href);
                console.error('[AboutSettings] BASE_URL:', document.baseURI);
                
                // 尝试直接fetch检查响应
                fetch(target.src)
                  .then(res => {
                    console.error('[AboutSettings] Fetch状态:', res.status, res.statusText);
                    console.error('[AboutSettings] Content-Type:', res.headers.get('content-type'));
                    console.error('[AboutSettings] Content-Length:', res.headers.get('content-length'));
                    return res.blob();
                  })
                  .then(blob => {
                    console.error('[AboutSettings] Blob类型:', blob.type, '大小:', blob.size);
                  })
                  .catch(err => console.error('[AboutSettings] Fetch错误:', err));
                
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = '<span class="text-white font-bold">無光</span>';
                }
              }}
            />
          </div>
          <div>
            <p className="font-medium text-[var(--text-color)]">{t('webmasterName')}: 無光</p>
            <p className="text-[var(--text-color-secondary)]">本站由無光二次开发和维护</p>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--glass-border)] pt-6 space-y-4">
        <h3 className="font-bold text-lg text-[var(--text-color)]">项目说明</h3>
        <p className="text-base">
          本项目基于
          <a
            href="https://github.com/Wing900/ikunKChat"
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 text-[var(--md-sys-color-primary)] hover:underline"
          >
            原项目
          </a>
          进行二次开发。
        </p>
        <p className="text-base">
          本站的各种梗不存在任何攻击艺人的主观想法，站长十分喜爱他的舞台、音乐作品，尊重艺人本人与所有不同喜好的粉丝群体。
        </p>
      </div>

      <div className="border-t border-[var(--glass-border)] pt-6 space-y-4">
        <h3 className="font-bold text-lg text-[var(--text-color)]">{t('usefulLinks')}</h3>
        <div className="flex flex-wrap gap-4">
          <a href="https://hjm.331106.xyz" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[var(--md-sys-color-primary)] hover:underline">
            <Icon icon="link" className="w-4 h-4" />
            <span>hjm.331106.xyz</span>
          </a>
        </div>
      </div>
    </div>
  );
};

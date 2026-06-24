import React, { useEffect, useRef, useState } from 'react';
import CharVideo from '../ikun/charVideo';
import { IKUN_VIDEO_URL, preloadIkunVideo } from '../utils/ikunVideo';

export const IkunLoadingIndicator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isMounted = true;
    void preloadIkunVideo();

    const computedColor =
      getComputedStyle(wrapperRef.current || document.documentElement)
        .getPropertyValue('color')
        .trim() || '#333';

    const charVideo = new CharVideo({
      canvasElement: canvas,
      width: 220,
      height: 124,
      space: 5,
      color: computedColor,
      onFirstFrame: () => {
        if (isMounted) {
          setIsReady(true);
        }
      },
    });

    charVideo.playUrl(IKUN_VIDEO_URL);

    return () => {
      isMounted = false;
      charVideo.stop();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`ikun-loading-indicator${isReady ? ' is-ready' : ''}`}
      aria-label="AI 正在输出"
    >
      <div className="ikun-loading-fallback" aria-hidden="true" />
      <canvas ref={canvasRef} className="ikun-loading-canvas" />
    </div>
  );
};

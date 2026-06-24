import React, { useEffect, useRef } from 'react';
import CharVideo from '../ikun/charVideo';

const IKUN_VIDEO_URL = new URL('../ikun/ikun.mp4', import.meta.url).href;

export const IkunLoadingIndicator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
    });

    charVideo.playUrl(IKUN_VIDEO_URL);

    return () => {
      charVideo.stop();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="ikun-loading-indicator" aria-label="AI 正在输出">
      <canvas ref={canvasRef} className="ikun-loading-canvas" />
    </div>
  );
};

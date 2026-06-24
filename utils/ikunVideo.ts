export const IKUN_VIDEO_URL = `${import.meta.env.BASE_URL}ikun/ikun.mp4`;

let preloadPromise: Promise<void> | null = null;
let warmVideo: HTMLVideoElement | null = null;

export const preloadIkunVideo = (): Promise<void> => {
  if (preloadPromise) {
    return preloadPromise;
  }

  if (typeof document === 'undefined') {
    return Promise.resolve();
  }

  const absoluteVideoUrl = new URL(IKUN_VIDEO_URL, window.location.href).href;
  const existingPreload = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')
  ).some((link) => link.href === absoluteVideoUrl);

  if (!existingPreload) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = IKUN_VIDEO_URL;
    link.type = 'video/mp4';
    link.setAttribute('fetchpriority', 'high');
    document.head.appendChild(link);
  }

  preloadPromise = new Promise((resolve) => {
    warmVideo = document.createElement('video');
    warmVideo.muted = true;
    warmVideo.loop = true;
    warmVideo.playsInline = true;
    warmVideo.preload = 'auto';

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    warmVideo.addEventListener('loadeddata', done, { once: true });
    warmVideo.addEventListener('canplay', done, { once: true });
    warmVideo.addEventListener('error', done, { once: true });
    window.setTimeout(done, 3000);

    warmVideo.src = IKUN_VIDEO_URL;
    warmVideo.load();
  });

  return preloadPromise;
};

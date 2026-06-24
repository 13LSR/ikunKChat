const DEFAULT_CONFIG = {
  space: 5,
  width: 220,
  height: 124,
  color: '#333',
};

class CharVideo {
  constructor(config = {}) {
    if (!config.canvasElement) {
      throw new Error('CharVideo requires a canvasElement.');
    }

    this.space = config.space || DEFAULT_CONFIG.space;
    this.width = Math.ceil((config.width || DEFAULT_CONFIG.width) / this.space);
    this.height = Math.ceil((config.height || DEFAULT_CONFIG.height) / this.space);
    this.canvasWidth = config.width || DEFAULT_CONFIG.width;
    this.canvasHeight = config.height || DEFAULT_CONFIG.height;
    this.color = config.color || DEFAULT_CONFIG.color;
    this.points = ' .,`"^:!?o+*wU$HB%@&#M'.split('');
    this.frameId = null;
    this.objectUrl = null;

    this.charVideo = config.canvasElement;
    this.charVideo.width = this.canvasWidth;
    this.charVideo.height = this.canvasHeight;
    this.textCtx = this.charVideo.getContext('2d');

    this.initVideo();
    this.initCanvas();
  }

  initVideo(src) {
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.loop = true;
      this.video.playsInline = true;
      this.video.preload = 'auto';
    }

    if (src) {
      this.video.src = src;
    }
  }

  initCanvas() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  loadData() {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  reDraw(data) {
    for (let i = 0, len = data.data.length; i < len; i += 4) {
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const value = (255 - (r + g + b) / 3) | 0;
      data.data[i] = value;
      data.data[i + 1] = value;
      data.data[i + 2] = value;
    }

    this.data = data;
    this.ctx.putImageData(data, 0, 0, 0, 0, this.width, this.height);
  }

  drawText() {
    if (!this.data?.data) return;

    this.textCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    this.textCtx.fillStyle = this.color;
    this.textCtx.font = '10px courier';

    const data = this.data.data;
    const step = Math.ceil(255 / this.points.length);

    for (let i = 0, len = data.length; i < len; i += 4) {
      const column = ((i / 4) | 0) % this.width;
      const row = Math.ceil(i / 4 / this.width);
      const x = column * this.space;
      const y = row * this.space;
      const value = data[i] | 0;
      const point = this.points[(value / step) | 0] || '';
      this.textCtx.fillText(point, x, y);
    }
  }

  renderFrame = () => {
    if (!this.video?.paused && !this.video?.ended) {
      this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
      this.reDraw(this.loadData());
      this.drawText();
    }

    this.frameId = requestAnimationFrame(this.renderFrame);
  };

  async playUrl(src) {
    this.initVideo(src);
    this.frameId = requestAnimationFrame(this.renderFrame);

    try {
      await this.video.play();
    } catch (error) {
      console.warn('[CharVideo] Failed to autoplay video:', error);
    }
  }

  playFile(blob) {
    this.objectUrl = URL.createObjectURL(blob);
    return this.playUrl(this.objectUrl);
  }

  stop() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.textCtx?.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
  }
}

export default CharVideo;

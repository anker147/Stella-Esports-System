// Shared upload-image compressor: scale to fit maxEdge and re-encode as
// WebP so small-display avatars stop shipping multi-megabyte originals.
// Returns { dataUrl, bytes, type }; callers enforce their own byte limits
// with their own localized messages.
(() => {
  const SOURCE_MIME = /^data:(image\/(?:png|jpeg|webp));/i;

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = source;
    });
  }

  function base64Bytes(dataUrl) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 0.75) - padding);
  }

  async function compress(source, options = {}) {
    const match = SOURCE_MIME.exec(String(source || ''));
    if (!match) throw new Error('unsupported image source');
    const sourceType = match[1].toLowerCase();
    const maxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : 512;
    const quality = Number(options.quality) > 0 ? Number(options.quality) : 0.85;

    const image = await loadImage(source);
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.drawImage(image, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/webp', quality);
    let type = 'image/webp';
    if (!dataUrl.startsWith('data:image/webp')) {
      // Browser re-encodes unsupported targets as PNG; keep that for
      // alpha-bearing sources, re-encode JPEG sources as JPEG instead.
      type = sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      if (type === 'image/jpeg') {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.globalCompositeOperation = 'source-over';
      }
      dataUrl = canvas.toDataURL(type, quality);
    }
    return { dataUrl, type, bytes: base64Bytes(dataUrl) };
  }

  window.ImageCompress = { compress };
})();

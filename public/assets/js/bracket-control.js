(function () {
  const input = document.getElementById('bracketImageInput');
  const dropZone = document.getElementById('bracketImageDropZone');
  const preview = document.getElementById('bracketImagePreview');
  const clear = document.getElementById('clearBracketImage');
  const upload = document.getElementById('uploadBracketImage');
  const status = document.getElementById('bracketUploadStatus');
  let file = null;
  let previewUrl = null;

  function selectFile(next) {
    if (!next?.type?.startsWith('image/')) {
      status.textContent = '请选择 PNG、JPG 或 WebP 图片';
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    file = next;
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
    dropZone.classList.add('has-image');
    upload.disabled = false;
    status.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    file = null;
    input.value = '';
    preview.removeAttribute('src');
    preview.hidden = true;
    dropZone.classList.remove('has-image');
    upload.disabled = true;
    status.textContent = '等待选择图片';
  }

  input.addEventListener('change', () => selectFile(input.files[0]));
  clear.addEventListener('click', reset);
  dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    selectFile(event.dataTransfer.files[0]);
  });
  document.addEventListener('paste', event => {
    const itemFile = [...(event.clipboardData?.items || [])]
      .find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    const pasted = itemFile || [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
    if (pasted && !document.getElementById('bracketPage').hidden) {
      event.preventDefault();
      selectFile(pasted);
    }
  });
  upload.addEventListener('click', async () => {
    if (!file) return;
    upload.disabled = true;
    status.textContent = '正在保存并推送到 OBS...';
    try {
      const response = await fetch('/api/bracket-image', {
        method: 'POST', headers: { 'Content-Type': file.type }, body: file
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '上传失败');
      reset();
      status.textContent = payload.obsSynced
        ? `已保存并切换到晋级榜：${payload.fileName}`
        : `已保存：${payload.fileName}；OBS 同步或场景切换失败`;
    } catch (error) {
      status.textContent = error.message;
      upload.disabled = false;
    }
  });
})();

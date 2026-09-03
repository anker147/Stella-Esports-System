(function () {
  'use strict';

  const dialog = document.getElementById('systemDialog');
  const form = document.getElementById('systemDialogForm');
  const mark = document.getElementById('systemDialogMark');
  const title = document.getElementById('systemDialogTitle');
  const message = document.getElementById('systemDialogMessage');
  const inputWrap = document.getElementById('systemDialogInputWrap');
  const input = document.getElementById('systemDialogInput');
  const cancelButton = document.getElementById('systemDialogCancel');
  const confirmButton = document.getElementById('systemDialogConfirm');
  const queue = [];
  let activeRequest = null;

  function text(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function showNext() {
    if (activeRequest || !queue.length || !dialog?.showModal) return;
    activeRequest = queue.shift();
    const options = activeRequest.options;
    const mode = activeRequest.mode;
    const tone = options.tone === 'danger' ? 'danger' : 'default';

    dialog.classList.toggle('is-danger', tone === 'danger');
    mark.textContent = tone === 'danger' ? '!' : mode === 'alert' ? 'i' : '?';
    title.textContent = text(options.title, mode === 'alert' ? '提示' : '请确认');
    message.textContent = text(options.message, '请确认是否继续。');
    inputWrap.hidden = mode !== 'prompt';
    input.disabled = mode !== 'prompt';
    input.value = mode === 'prompt' ? String(options.defaultValue ?? '') : '';
    input.placeholder = text(options.placeholder, '请输入内容');
    input.maxLength = Number.isInteger(options.maxLength) && options.maxLength > 0 ? options.maxLength : 500;
    cancelButton.hidden = mode === 'alert';
    cancelButton.textContent = text(options.cancelText, '取消');
    confirmButton.textContent = text(options.confirmText, mode === 'alert' ? '知道了' : '确认');
    confirmButton.classList.toggle('btn-danger', tone === 'danger');
    confirmButton.classList.toggle('btn-primary', tone !== 'danger');
    dialog.returnValue = '';
    dialog.showModal();
    window.requestAnimationFrame(() => {
      (mode === 'prompt' ? input : confirmButton).focus();
      if (mode === 'prompt') input.select();
    });
  }

  function finish() {
    if (!activeRequest) return;
    const request = activeRequest;
    const accepted = dialog.returnValue === 'confirm';
    activeRequest = null;

    if (request.mode === 'prompt') request.resolve(accepted ? input.value : null);
    else if (request.mode === 'confirm') request.resolve(accepted);
    else request.resolve();

    if (request.trigger && document.contains(request.trigger)) request.trigger.focus();
    window.setTimeout(showNext, 0);
  }

  function enqueue(mode, options) {
    return new Promise(resolve => {
      queue.push({
        mode,
        options: typeof options === 'string' ? { message: options } : (options || {}),
        resolve,
        trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null
      });
      showNext();
    });
  }

  form?.addEventListener('submit', event => {
    event.preventDefault();
    dialog.close('confirm');
  });
  cancelButton?.addEventListener('click', () => dialog.close('cancel'));
  dialog?.addEventListener('close', finish);
  dialog?.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right
      && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) dialog.close('cancel');
  });

  window.StellaDialog = Object.freeze({
    alert(options) {
      return enqueue('alert', options);
    },
    confirm(options) {
      return enqueue('confirm', options);
    },
    prompt(options) {
      return enqueue('prompt', options);
    }
  });
})();

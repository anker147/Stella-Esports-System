(function () {
  'use strict';

  // 全站弹窗退场动画：拦截 close() 先播 140ms 退场再真正关闭；
  // Esc 的 cancel 事件同样接管，保证关闭路径一致。
  if (window.__dialogThemePatched) return;
  window.__dialogThemePatched = true;

  const EXIT_MS = 150;
  const nativeClose = HTMLDialogElement.prototype.close;
  const nativeShowModal = HTMLDialogElement.prototype.showModal;

  function flushPendingClose(dialog) {
    if (!dialog.dataset.dialogThemeClosing) return;
    dialog.classList.remove('dialog-closing');
    delete dialog.dataset.dialogThemeClosing;
    window.clearTimeout(dialog.__dialogThemeTimer);
    nativeClose.call(dialog);
  }

  HTMLDialogElement.prototype.close = function (returnValue) {
    if (!this.open || this.dataset.dialogThemeClosing) {
      return nativeClose.call(this, returnValue);
    }
    if (getComputedStyle(this).animationName === 'none') {
      return nativeClose.call(this, returnValue);
    }
    this.dataset.dialogThemeClosing = '1';
    if (returnValue !== undefined) this.returnValue = String(returnValue);
    this.classList.add('dialog-closing');
    this.__dialogThemeTimer = window.setTimeout(() => {
      flushPendingClose(this);
    }, EXIT_MS);
  };

  HTMLDialogElement.prototype.showModal = function (...args) {
    flushPendingClose(this);
    return nativeShowModal.apply(this, args);
  };

  document.addEventListener('cancel', event => {
    const target = event.target;
    if (target instanceof HTMLDialogElement && target.open && !target.dataset.dialogThemeClosing) {
      if (target.dataset.dialogThemeStrict) return; // 严格模式弹窗自行决定取消行为
      event.preventDefault();
      target.close();
    }
  }, true);
})();

(function () {
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then(response => {
      if (response.status === 401) location.replace('/');
      return response;
    });
  };
})();

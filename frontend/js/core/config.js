// Defaults to the same host, but allows separate frontend/API hosting.
const API_BASE = (() => {
  const configured = window.VECTOR_PORTAL_CONFIG && window.VECTOR_PORTAL_CONFIG.apiBase;
  const value = configured || window.location.origin;
  return String(value).replace(/\/+$/, '');
})();

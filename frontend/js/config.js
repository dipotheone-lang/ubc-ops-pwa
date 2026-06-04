/**
 * config.js — runtime configuration for the UBC Operations PWA.
 *
 * After deploying the Apps Script Web App, paste its /exec URL into API_BASE
 * (or set it at runtime from the in-app Settings screen, which persists to
 * localStorage and overrides this default).
 */
window.UBC_CONFIG = {
  // Default backend URL. Overridable in Settings (stored in localStorage).
  API_BASE: '',

  // App metadata
  APP_NAME: 'UBC Operations',
  VERSION: '1.0.0',

  // Image handling thresholds (architecture req #2)
  IMAGE_MAX_DIM: 1200,          // px — longest edge after client compression
  IMAGE_QUALITY: 0.72,          // JPEG quality
  CHUNK_THRESHOLD_BYTES: 2 * 1024 * 1024,   // >2MB -> chunked upload
  CHUNK_SIZE_B64: 80 * 1024,    // ≤100KB CacheService cap per key; keep margin

  // Sync behavior
  SYNC_BATCH: 10,               // ops per sync.push request
  SYNC_RETRY_BACKOFF_MS: [2000, 5000, 15000, 60000]
};

/** Resolve the live API base (Settings override wins). */
window.getApiBase = function () {
  return localStorage.getItem('ubc_api_base') || window.UBC_CONFIG.API_BASE || '';
};
window.getApiToken = function () {
  return localStorage.getItem('ubc_api_token') || '';
};
window.getActor = function () {
  return localStorage.getItem('ubc_actor') || 'app-user';
};

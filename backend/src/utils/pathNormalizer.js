/**
 * Normalizes gateway endpoint paths to ensure they have exactly one leading slash,
 * resolve duplicate consecutive slashes, and handle root/edge cases cleanly.
 * 
 * @param {string} pathRaw - The raw parameter path from Express wildcard route
 * @returns {string} Normalized path
 */
const normalizeEndpoint = (pathRaw) => {
  if (pathRaw === undefined || pathRaw === null) {
    return '/';
  }

  // Cast to string and trim whitespace
  let clean = String(pathRaw).trim();

  if (clean === '') {
    return '/';
  }

  // Replace multiple consecutive slashes with a single slash
  clean = clean.replace(/\/+/g, '/');

  // Ensure it starts with a leading slash
  if (!clean.startsWith('/')) {
    clean = '/' + clean;
  }

  // Strip any provider prefix (e.g., /gemini/, /openai/) at the start of the path
  const providers = ['openai', 'gemini', 'claude', 'anthropic', 'google_maps', 'stripe', 'twilio', 'weather', 'custom'];
  for (const p of providers) {
    if (clean.toLowerCase() === `/${p}`) {
      clean = '/';
      break;
    }
    if (clean.toLowerCase().startsWith(`/${p}/`)) {
      clean = clean.substring(p.length + 1);
      break;
    }
  }

  // Standardize API version prefixes (e.g., v1beta -> v1)
  clean = clean.replace(/^\/v1beta\//i, '/v1/');

  return clean;
};

module.exports = {
  normalizeEndpoint
};

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

  return clean;
};

module.exports = {
  normalizeEndpoint
};

const crypto = require('crypto');

/**
 * Validates and returns the derived 256-bit key from VAULT_ENCRYPTION_KEY.
 * @returns {Buffer} 32-byte derived key
 */
const getEncryptionKey = () => {
  const keyStr = process.env.VAULT_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('VAULT_ENCRYPTION_KEY environment variable is missing.');
  }
  if (keyStr.length < 32) {
    throw new Error('VAULT_ENCRYPTION_KEY is invalid. It must be at least 32 characters long.');
  }
  // Derive a strong 32-byte key using SHA-256
  return crypto.createHash('sha256').update(keyStr).digest();
};

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns formatted string: v1:iv_hex:auth_tag_hex:ciphertext_hex
 * @param {string} plaintext - The raw value to encrypt
 * @returns {string} Encrypted format
 */
const encrypt = (plaintext) => {
  if (!plaintext) return '';
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `v1:${iv.toString('hex')}:${authTag}:${ciphertext}`;
};

/**
 * Decrypts a formatted ciphertext string: v1:iv_hex:auth_tag_hex:ciphertext_hex.
 * If the input does not start with "v1:", returns it as-is for plaintext migration fallback.
 * @param {string} encryptedText - The encrypted string from database
 * @returns {string} Decrypted plaintext
 */
const decrypt = (encryptedText) => {
  if (!encryptedText) return '';
  
  // Return plaintext if it does not contain our version identifier prefix
  if (!encryptedText.startsWith('v1:')) {
    return encryptedText;
  }
  
  const parts = encryptedText.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted credential format.');
  }
  
  const iv = Buffer.from(parts[1], 'hex');
  const authTag = Buffer.from(parts[2], 'hex');
  const ciphertext = parts[3];
  
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  
  return plaintext;
};

module.exports = {
  encrypt,
  decrypt,
  getEncryptionKey
};

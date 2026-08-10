const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { encrypt, decrypt, getEncryptionKey } = require('./crypto');

test('Crypto Vault - Encryption creates unique ciphertext', () => {
  const plaintext = 'demo-provider-key-used-for-crypto-unit-testing-only';
  const ciphertext = encrypt(plaintext);
  
  assert.notStrictEqual(ciphertext, plaintext, 'Ciphertext must be different from plaintext');
  assert.ok(ciphertext.startsWith('v1:'), 'Ciphertext must start with version identifier prefix');
});

test('Crypto Vault - Unique IVs on consecutive encryptions', () => {
  const plaintext = 'demo-provider-key-used-for-crypto-unit-testing-only';
  const ciphertext1 = encrypt(plaintext);
  const ciphertext2 = encrypt(plaintext);
  
  assert.notStrictEqual(ciphertext1, ciphertext2, 'Encrypting same plaintext twice must produce different ciphertexts');
});

test('Crypto Vault - Decryption yields original value', () => {
  const plaintext = 'demo-provider-key-used-for-crypto-unit-testing-only';
  const ciphertext = encrypt(plaintext);
  const decrypted = decrypt(ciphertext);
  
  assert.strictEqual(decrypted, plaintext, 'Decrypted value must equal original plaintext');
});

test('Crypto Vault - Decrypt plaintext fallback', () => {
  const plaintext = 'existing_legacy_plaintext_api_key_123';
  const decrypted = decrypt(plaintext);
  
  assert.strictEqual(decrypted, plaintext, 'Plaintext fallback should return the input value as-is');
});

test('Crypto Vault - Decryption fails if ciphertext or tag is tampered', () => {
  const plaintext = 'demo-provider-key-used-for-crypto-unit-testing-only';
  const ciphertext = encrypt(plaintext);
  
  // Tamper ciphertext
  const parts = ciphertext.split(':');
  parts[3] = parts[3].substring(0, parts[3].length - 2) + '00';
  const tamperedCiphertext = parts.join(':');
  
  assert.throws(() => {
    decrypt(tamperedCiphertext);
  }, /Unsupported state|unable to authenticate data|bad decrypt/i, 'Decrypting tampered ciphertext must throw an error');

  // Tamper auth tag
  const parts2 = ciphertext.split(':');
  parts2[2] = parts2[2].substring(0, parts2[2].length - 2) + '00';
  const tamperedTag = parts2.join(':');
  
  assert.throws(() => {
    decrypt(tamperedTag);
  }, /Unsupported state|unable to authenticate data|bad decrypt/i, 'Decrypting tampered authentication tag must throw an error');
});

test('Crypto Vault - Missing or invalid key configuration fails safely', () => {
  const originalKey = process.env.VAULT_ENCRYPTION_KEY;
  
  // 1. Test missing key
  delete process.env.VAULT_ENCRYPTION_KEY;
  assert.throws(() => {
    getEncryptionKey();
  }, /VAULT_ENCRYPTION_KEY environment variable is missing/, 'Should throw error when encryption key is missing');
  
  // 2. Test short/invalid key (less than 32 characters)
  process.env.VAULT_ENCRYPTION_KEY = 'too_short';
  assert.throws(() => {
    getEncryptionKey();
  }, /VAULT_ENCRYPTION_KEY is invalid/, 'Should throw error when encryption key is too short');
  
  // Restore original key
  process.env.VAULT_ENCRYPTION_KEY = originalKey;
});

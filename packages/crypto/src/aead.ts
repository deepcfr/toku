export interface EncryptInput {
  key: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  plaintext: Uint8Array<ArrayBuffer>;
}

export interface DecryptInput {
  key: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  cipherText: Uint8Array<ArrayBuffer>;
}

export async function encrypt({
  key,
  nonce,
  plaintext,
}: EncryptInput): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const out = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    plaintext
  );

  return new Uint8Array(out);
}

export async function decrypt({
  key,
  nonce,
  cipherText,
}: DecryptInput): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const out = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    cipherText
  );

  return new Uint8Array(out);
}

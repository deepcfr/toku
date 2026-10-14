const PBKDF2_ITERATIONS = 600_000;

export interface Pbkdf2Input {
  password: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export interface HkdfInput {
  ikm: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
  info: Uint8Array<ArrayBuffer>;
  byteLength: number;
}

// hashes arbitrary bytes using SHA-256
export async function sha256(
  data: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hashBuffer);
}

// stretches a password into a 32-byte key using pbkdf2-sha256
export async function pbkdf2({
  password,
  salt,
}: Pbkdf2Input): Promise<Uint8Array<ArrayBuffer>> {
  if (password.length === 0) throw new RangeError("password cant be empty");

  // raw bytes must be imported before derivation
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    password,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return new Uint8Array(derived);
}

// derives a fixed-length key from high-entropy material using hkdf-sha256
export async function hkdf({
  ikm,
  salt,
  info,
  byteLength,
}: HkdfInput): Promise<Uint8Array<ArrayBuffer>> {
  // raw bytes must be imported before derivation
  const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);

  // subtle runs extract then expand in one call from these parameters
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info,
    },
    keyMaterial,
    byteLength * 8 // api requires length in bits
  );

  return new Uint8Array(derived);
}

// CSPRNG = high quality entropy + continuous re-seeding, unpredictable
// satisfies the next-bit unpredictability property
const MAX_BYTES = 65536;

// generate safe, raw binary numbers -> salts, nonces..
export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError("byte length must be a non-negative integer");
  }

  const out = new Uint8Array(n);

  // loop chunk-by-chunk, window starts from 'o'
  for (let o = 0; o < n; o += MAX_BYTES) {
    // make sure the window never exceeds our 'n'
    const endWindow = Math.min(o + MAX_BYTES, n);
    crypto.getRandomValues(out.subarray(o, endWindow));
  }

  return out;
}

// converts raw binary array into readable hex text
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// converts hex text into raw binary array
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new RangeError("hex string must have an even length");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// room identity
export function randomToken(kind: "rm_" | "dm_" | "cr_"): string {
  const rawBytes = randomBytes(16); // -> 32-character hex string
  const hexString = bytesToHex(rawBytes);
  return `${kind}${hexString}`;
}

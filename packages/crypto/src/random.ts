// CSPRNG = high quality entropy + continuous re-seeding, unpredictable
// satisfies the next-bit unpredictability property
const MAX_BYTES = 65536;

// generate safe, raw binary numbers -> salts, nonces..
export function randomBytes(n: number): Uint8Array {
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

// room identity
export function randomToken(kind: "rm_" | "dm_"): string {
  const rawBytes = randomBytes(16); // -> 32-character hex string
  const hexString = bytesToHex(rawBytes);
  return `${kind}${hexString}`;
}

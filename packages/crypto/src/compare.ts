/**
 * timing attack is a specific type of side-channel attack where the attacker steals the secret by measuring how much time the system takes to process each input
 * side-channel attack -> physical behaviour of the system is observed to steal the secret, rather than the data itself
 * fix = constant-time comparison
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  // first do XOR, 1 ^ 1 = 0 but 1 ^ 3 > 0
  // then OR that output with diff = 0, repeat throughout the loop
  // if at the end diff is still 0, then return true
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }

  return diff === 0;
}

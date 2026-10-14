import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "./kdf";
import { randomBytes } from "./random";

export interface IdentityKeypair {
  privateKey: Uint8Array<ArrayBuffer>;
  publicKey: Uint8Array<ArrayBuffer>;
}

function narrow(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

export function generateIdentityKeypair(): IdentityKeypair {
  const privateKey = randomBytes(32);
  const publicKey = narrow(ed25519.getPublicKey(privateKey));
  return { privateKey, publicKey };
}

export function getAgreementKey(
  identityPriv: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return narrow(ed25519.utils.toMontgomerySecret(identityPriv));
}

export function getAgreementPublic(
  identityPriv: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return narrow(x25519.getPublicKey(getAgreementKey(identityPriv)));
}

export function agree(
  peerXPub: Uint8Array<ArrayBuffer>,
  identityPriv: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  const secret = narrow(
    x25519.getSharedSecret(getAgreementKey(identityPriv), peerXPub)
  );
  if (secret.every(b => b === 0)) throw new Error("zero shared secret");
  return secret;
}

export async function publicKeyHash(
  xPub: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(xPub);
}

export function sign(
  identityPriv: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return narrow(ed25519.sign(message, identityPriv));
}

export function verify(
  identityPub: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
  sig: Uint8Array<ArrayBuffer>
): boolean {
  return ed25519.verify(sig, message, identityPub);
}

function prekeyPayload(
  roomToken: string,
  prekeyPub: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  const room = new TextEncoder().encode(roomToken);
  const out = new Uint8Array(room.length + prekeyPub.length);
  out.set(room, 0);
  out.set(prekeyPub, room.length);
  return out;
}

export function signPrekey(
  identityPriv: Uint8Array<ArrayBuffer>,
  roomToken: string,
  prekeyPub: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return sign(identityPriv, prekeyPayload(roomToken, prekeyPub));
}

export function verifyPrekey(
  identityPub: Uint8Array<ArrayBuffer>,
  roomToken: string,
  prekeyPub: Uint8Array<ArrayBuffer>,
  sig: Uint8Array<ArrayBuffer>
): boolean {
  return verify(identityPub, prekeyPayload(roomToken, prekeyPub), sig);
}

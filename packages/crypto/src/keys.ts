import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "./kdf";
import { randomBytes } from "./random";

const utf8 = new TextEncoder();

// ED25519 is for Digital Signatures(proving who sent a message, the identity)
// X25519 is for Key Exchange -> agreeing on a shared secret key

// ED25519 -> twisted edwards curve
// X255199 -> montgomery curve

/**
 * the user has to store only one single master secret(private key)
 * the same key is used for signatures with ed25519,
 * and with x25519 for key exchange
 */

export interface IdentityKeypair {
  privateKey: Uint8Array<ArrayBuffer>;
  publicKey: Uint8Array<ArrayBuffer>;
}

export interface AgreeInput {
  peerXPub: Uint8Array<ArrayBuffer>;
  identityPriv: Uint8Array<ArrayBuffer>;
}

export interface SignInput {
  identityPriv: Uint8Array<ArrayBuffer>;
  message: Uint8Array<ArrayBuffer>;
}

export interface VerifyInput {
  identityPub: Uint8Array<ArrayBuffer>;
  message: Uint8Array<ArrayBuffer>;
  sig: Uint8Array<ArrayBuffer>;
}

export interface SignPrekeyInput {
  identityPriv: Uint8Array<ArrayBuffer>;
  roomToken: string;
  prekeyPub: Uint8Array<ArrayBuffer>;
}

export interface VerifyPrekeyInput {
  identityPub: Uint8Array<ArrayBuffer>;
  roomToken: string;
  prekeyPub: Uint8Array<ArrayBuffer>;
  sig: Uint8Array<ArrayBuffer>;
}

function narrow(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

// creates a brand-new, long-term master identity for an user
export function generateIdentityKeypair(): IdentityKeypair {
  const privateKey = randomBytes(32);
  const publicKey = narrow(ed25519.getPublicKey(privateKey));
  return { privateKey, publicKey };
}

export function getAgreementKey(
  identityPriv: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  // take the ed25519 private key & morph it mathematically into a safe x25519 private key
  return narrow(ed25519.utils.toMontgomerySecret(identityPriv));
}

export function getAgreementPublic(
  identityPriv: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  const agreementPriv = getAgreementKey(identityPriv);

  // get an x25519 public key from the converted x25519 private key
  return narrow(x25519.getPublicKey(agreementPriv));
}

// creates the shared secret key using Diffie-Hellman math
export function agree({
  peerXPub,
  identityPriv,
}: AgreeInput): Uint8Array<ArrayBuffer> {
  const agreementPriv = getAgreementKey(identityPriv);
  const secret = narrow(x25519.getSharedSecret(agreementPriv, peerXPub));
  if (secret.every(b => b === 0)) throw new Error("zero shared secret");
  return secret;
}

export async function publicKeyHash(
  xPub: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  return sha256(xPub);
}

// verifies the message integrity
// to check the message came from the genuine person and hasnt been altered
export function sign({
  identityPriv,
  message,
}: SignInput): Uint8Array<ArrayBuffer> {
  return narrow(ed25519.sign(message, identityPriv));
}

export function verify({ identityPub, message, sig }: VerifyInput): boolean {
  return ed25519.verify(sig, message, identityPub);
}

// offline message setup
function prekeyPayload(
  roomToken: string,
  prekeyPub: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  const room = utf8.encode(roomToken);
  const out = new Uint8Array(room.length + prekeyPub.length);
  out.set(room, 0);
  out.set(prekeyPub, room.length);
  return out;
}

export function signPrekey({
  identityPriv,
  roomToken,
  prekeyPub,
}: SignPrekeyInput): Uint8Array<ArrayBuffer> {
  // pack the roomToken and prekey together -> single byte array
  const payload = prekeyPayload(roomToken, prekeyPub);
  return sign({ identityPriv, message: payload });
}

export function verifyPrekey({
  identityPub,
  roomToken,
  prekeyPub,
  sig,
}: VerifyPrekeyInput): boolean {
  const payload = prekeyPayload(roomToken, prekeyPub);
  return verify({ identityPub, message: payload, sig });
}

// shared failure type for encode and decode
// server reads err.code straight into ERROR frames, no string matching
import type { ErrorCode } from "./types";

export class ProtocolError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    Error.captureStackTrace(this, ProtocolError);
  }
}

// extend the base Error class to use additonal properties
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// custom error classes
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", code = "UNAUTHORIZED") {
    super(401, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code = "NOT_FOUND") {
    super(404, code, message);
  }
}

export class BadRequestError extends AppError {
  constructor(
    message = "Bad request",
    code = "BAD_REQUEST",
    details?: unknown
  ) {
    super(400, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(403, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", code = "CONFLICT") {
    super(409, code, message);
  }
}

export class GoneError extends AppError {
  constructor(message = "Resource is no longer available", code = "GONE") {
    super(410, code, message);
  }
}

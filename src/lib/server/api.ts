import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { logError, logWarn } from "@/lib/server/log";

const DEFAULT_JSON_MAX_BYTES = 1024 * 1024;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    status: number,
    message: string,
    options?: {
      code?: string;
      details?: unknown;
      expose?: boolean;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
    this.expose = options?.expose ?? status < 500;
  }
}

function zodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function badRequest(message: string, options?: { code?: string; details?: unknown }) {
  return new ApiError(400, message, options);
}

export function forbidden(message: string, options?: { code?: string; details?: unknown }) {
  return new ApiError(403, message, options);
}

export function notFound(message: string, options?: { code?: string; details?: unknown }) {
  return new ApiError(404, message, options);
}

export function conflict(message: string, options?: { code?: string; details?: unknown }) {
  return new ApiError(409, message, options);
}

export function assertTrustedWriteRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return;
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) {
    let parsedOrigin: URL;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw forbidden("Invalid request origin", { code: "invalid_origin" });
    }

    if (parsedOrigin.origin !== requestUrl.origin) {
      throw forbidden("Cross-site write requests are not allowed", {
        code: "cross_site_request",
      });
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw forbidden("Cross-site write requests are not allowed", {
      code: "cross_site_request",
      details: { fetchSite },
    });
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  options?: {
    maxBytes?: number;
    requireContentType?: boolean;
  },
) {
  const maxBytes = options?.maxBytes ?? DEFAULT_JSON_MAX_BYTES;
  const requireContentType = options?.requireContentType ?? true;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (requireContentType && !contentType.includes("application/json")) {
    throw badRequest("Content-Type must be application/json", {
      code: "invalid_content_type",
    });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, "Request body is too large", {
      code: "body_too_large",
      details: { maxBytes },
    });
  }

  const rawBody = await request.text();
  const actualBytes = new TextEncoder().encode(rawBody).byteLength;
  if (actualBytes > maxBytes) {
    throw new ApiError(413, "Request body is too large", {
      code: "body_too_large",
      details: { maxBytes },
    });
  }

  if (!rawBody.trim()) {
    throw badRequest("Request body is required", { code: "missing_body" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw badRequest("Invalid JSON body", { code: "invalid_json" });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw badRequest("Invalid request body", {
      code: "invalid_body",
      details: zodIssues(result.error),
    });
  }

  return result.data;
}

export function handleApiError(
  event: string,
  error: unknown,
  context?: Record<string, unknown>,
) {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logError(event, error, context);
    } else {
      logWarn(event, {
        ...context,
        status: error.status,
        code: error.code ?? null,
        details: error.details,
        message: error.message,
      });
    }

    return NextResponse.json(
      {
        error: error.expose ? error.message : "Internal server error",
        ...(error.code ? { code: error.code } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        code: "invalid_body",
        details: zodIssues(error),
      },
      { status: 400 },
    );
  }

  logError(event, error, context);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "internal_error",
    },
    { status: 500 },
  );
}

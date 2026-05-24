import type { Request, Response } from "express";

function readQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (Array.isArray(value)) return String(value[0] ?? "");
  if (value === undefined) return undefined;
  return String(value);
}

function parseNonNegativeInteger(value: string, key: string): number | string {
  if (!/^\d+$/.test(value)) {
    return `${key} must be a non-negative integer`;
  }
  return Number(value);
}

export function parsePaginationQuery(
  req: Request,
  res: Response,
  {
    defaultLimit,
    maxLimit,
  }: {
    defaultLimit: number;
    maxLimit: number;
  },
): { limit: number; offset: number } | null {
  const rawLimit = readQueryParam(req, "limit");
  const rawOffset = readQueryParam(req, "offset");

  const limitValue =
    rawLimit === undefined
      ? defaultLimit
      : parseNonNegativeInteger(rawLimit, "limit");
  const offsetValue =
    rawOffset === undefined ? 0 : parseNonNegativeInteger(rawOffset, "offset");

  if (typeof limitValue === "string" || typeof offsetValue === "string") {
    res.status(400).json({
      error: "Invalid query parameter",
      code: "VALIDATION_ERROR",
      details: {
        fieldErrors: {
          ...(typeof limitValue === "string" ? { limit: [limitValue] } : {}),
          ...(typeof offsetValue === "string" ? { offset: [offsetValue] } : {}),
        },
      },
    });
    return null;
  }

  return {
    limit: Math.min(limitValue, maxLimit),
    offset: offsetValue,
  };
}

export function parseDateQueryParam(
  req: Request,
  res: Response,
  key: string,
): Date | null | undefined {
  const value = readQueryParam(req, key);
  if (value === undefined) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    res.status(400).json({
      error: "Invalid query parameter",
      code: "VALIDATION_ERROR",
      details: {
        fieldErrors: {
          [key]: [`${key} must be a valid date or datetime`],
        },
      },
    });
    return null;
  }

  return parsed;
}

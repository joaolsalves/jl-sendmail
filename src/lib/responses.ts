import { NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import type { RateLimitResult } from '@/src/lib/rate-limit'

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
    },
    { status }
  )
}

// ---------------------------------------------------------------------------
// Success response
// ---------------------------------------------------------------------------

export function successResponse<T>(
  data: T,
  status = 200,
  headers?: HeadersInit
): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status, headers })
}

// ---------------------------------------------------------------------------
// Rate limit response (429)
// ---------------------------------------------------------------------------

export function rateLimitResponse(rl: RateLimitResult): NextResponse {
  const retryAfter = Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000))
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please retry after the indicated time.',
        retryAfter,
      },
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(rl.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(rl.resetAt),
      },
    }
  )
}

// ---------------------------------------------------------------------------
// Validation error response (422)
// ---------------------------------------------------------------------------

export function validationErrorResponse(error: ZodError): NextResponse {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] = issue.message
  }
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        fields,
      },
    },
    { status: 422 }
  )
}

// ---------------------------------------------------------------------------
// Rate limit headers helper (for success responses)
// ---------------------------------------------------------------------------

export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(Math.max(0, rl.remaining)),
    'X-RateLimit-Reset': String(rl.resetAt),
  }
}

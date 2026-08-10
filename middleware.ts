import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

const MAX_BODY_SIZE = 100_000 // 100 KB

function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? ''
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

export function middleware(req: NextRequest): NextResponse {
  const origin = req.headers.get('origin')
  const allowedOrigins = getAllowedOrigins()

  // 1. CORS check — always first
  if (origin) {
    const isAllowed = allowedOrigins.includes(origin)
    if (!isAllowed) {
      const res = NextResponse.json(
        { success: false, error: { code: 'CORS_FORBIDDEN', message: 'Origin not allowed' } },
        { status: 403 }
      )
      applySecurityHeaders(res)
      return res
    }
  }

  const method = req.method.toUpperCase()
  const pathname = req.nextUrl.pathname

  // 2. Content-Type check for requests with a body on API routes
  const bodyMethods = ['POST', 'PUT', 'PATCH']
  if (bodyMethods.includes(method) && pathname.startsWith('/api/')) {
    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      const res = NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Content-Type must be application/json',
          },
        },
        { status: 415 }
      )
      applySecurityHeaders(res)
      return res
    }
  }

  // 3. Body size check
  const contentLength = req.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    const res = NextResponse.json(
      {
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
      },
      { status: 413 }
    )
    applySecurityHeaders(res)
    return res
  }

  // All checks passed — add security headers and continue
  const response = NextResponse.next()
  applySecurityHeaders(response)

  // CORS allow headers for the permitted origin
  if (origin && allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.headers.set('Vary', 'Origin')
  }

  return response
}

export const config = {
  matcher: [
    // Apply to all API routes and pages — but not static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

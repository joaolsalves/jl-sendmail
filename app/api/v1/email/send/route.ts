import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/src/lib/auth'
import { checkRateLimit } from '@/src/lib/rate-limit'
import {
  errorResponse,
  successResponse,
  rateLimitResponse,
  validationErrorResponse,
  rateLimitHeaders,
} from '@/src/lib/responses'
import { sendEmailSchema, FORBIDDEN_FIELDS_V1 } from '@/src/validators/email.validator'
import { sendEmail } from '@/src/services/email.service'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate
  const auth = await authenticateRequest(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. Rate limit
  const rl = await checkRateLimit(auth.apiKey!.id)
  if (!rl.allowed) {
    return rateLimitResponse(rl)
  }

  // 3. Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Invalid JSON body')
  }

  // 4. Check for forbidden fields (V1 restrictions)
  if (body && typeof body === 'object') {
    for (const field of FORBIDDEN_FIELDS_V1) {
      if (field in (body as Record<string, unknown>)) {
        return errorResponse(
          400,
          'FORBIDDEN_FIELD',
          `Field '${field}' is not allowed in V1`
        )
      }
    }
  }

  // 5. Validate with Zod
  const parsed = sendEmailSchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }

  // 6. Extract client IP
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  // 7. Send email
  try {
    const result = await sendEmail({
      ...parsed.data,
      apiKeyId: auth.apiKey!.id,
      ipAddress,
    })

    return successResponse(
      { messageId: result.messageId, logId: result.logId },
      200,
      rateLimitHeaders(rl)
    )
  } catch (err: unknown) {
    const tagged = err as { code?: string }
    if (tagged?.code === 'EMAIL_DELIVERY_FAILED') {
      return errorResponse(502, 'EMAIL_DELIVERY_FAILED', 'Failed to send email')
    }
    console.error('[send] Unexpected error:', err)
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/src/lib/auth'
import { errorResponse, validationErrorResponse } from '@/src/lib/responses'
import { emailLogsQuerySchema } from '@/src/validators/email.validator'
import { getEmailLogs } from '@/src/services/email.service'

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate
  const auth = await authenticateRequest(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. Parse and validate query params
  const { searchParams } = req.nextUrl
  const rawQuery = {
    page: searchParams.get('page') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  }

  const parsed = emailLogsQuerySchema.safeParse(rawQuery)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }

  // 3. Fetch logs
  const { page, limit } = parsed.data
  const result = await getEmailLogs(auth.apiKey!.id, page, limit)

  return NextResponse.json({ success: true, ...result })
}

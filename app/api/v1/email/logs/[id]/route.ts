import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/src/lib/auth'
import { errorResponse } from '@/src/lib/responses'
import { getEmailLogById } from '@/src/services/email.service'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // 1. Authenticate
  const auth = await authenticateRequest(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. Fetch log — returns null for both "not found" and "belongs to another key"
  const log = await getEmailLogById(params.id, auth.apiKey!.id)

  if (!log) {
    return errorResponse(404, 'NOT_FOUND', 'Log not found')
  }

  return NextResponse.json({ success: true, data: log })
}

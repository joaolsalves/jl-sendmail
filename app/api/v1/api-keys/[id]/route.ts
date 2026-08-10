import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/src/lib/auth'
import { errorResponse } from '@/src/lib/responses'
import { revokeApiKey } from '@/src/services/api-key.service'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // 1. Admin authentication
  const auth = await authenticateAdmin(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. Revoke (idempotent — already inactive returns the same result)
  const result = await revokeApiKey(params.id)

  if (!result) {
    return errorResponse(404, 'NOT_FOUND', 'API key not found')
  }

  return NextResponse.json({
    success: true,
    data: { id: result.id, active: result.active },
  })
}

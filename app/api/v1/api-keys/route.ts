import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { authenticateAdmin } from '@/src/lib/auth'
import { errorResponse, validationErrorResponse } from '@/src/lib/responses'
import { createApiKeySchema } from '@/src/validators/api-key.validator'
import { createApiKey, listApiKeys } from '@/src/services/api-key.service'

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1. Admin authentication
  const auth = await authenticateAdmin(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. List all API Keys (without keyHash)
  const keys = await listApiKeys()
  return NextResponse.json({ success: true, data: keys })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Admin authentication
  const auth = await authenticateAdmin(req)
  if (!auth.success) {
    return errorResponse(auth.error!.status, auth.error!.code, auth.error!.message)
  }

  // 2. Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'INVALID_REQUEST', 'Invalid JSON body')
  }

  // 3. Validate
  const parsed = createApiKeySchema.safeParse(body)
  if (!parsed.success) {
    return validationErrorResponse(parsed.error)
  }

  // 4. Create API Key
  const result = await createApiKey({
    name: parsed.data.name,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
  })

  // Return 201 with plaintext key — the ONLY time it is exposed
  return NextResponse.json(
    { success: true, data: result },
    { status: 201 }
  )
}

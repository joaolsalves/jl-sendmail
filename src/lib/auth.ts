import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/src/lib/prisma'
import { config } from '@/src/lib/env'

export interface AuthResult {
  success: boolean
  apiKey?: { id: string; name: string }
  error?: { status: number; code: string; message: string }
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if header is absent or malformed.
 */
function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1] || null
}

/**
 * Hash a token with SHA-256.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Authenticate a client request against the ApiKey table.
 * Checks: presence → hash lookup → active → not expired → updates lastUsedAt.
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
  const token = extractBearerToken(req)

  if (!token) {
    return {
      success: false,
      error: { status: 401, code: 'UNAUTHORIZED', message: 'Authorization header is required' },
    }
  }

  const keyHash = hashToken(token)

  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, name: true, active: true, expiresAt: true },
    })

    if (!apiKey) {
      return {
        success: false,
        error: { status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid API key' },
      }
    }

    if (!apiKey.active) {
      return {
        success: false,
        error: { status: 403, code: 'KEY_DISABLED', message: 'API key is disabled' },
      }
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return {
        success: false,
        error: { status: 403, code: 'KEY_EXPIRED', message: 'API key has expired' },
      }
    }

    // Update lastUsedAt without blocking the request
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // Non-critical — do not fail the request if this update fails
      })

    return { success: true, apiKey: { id: apiKey.id, name: apiKey.name } }
  } catch {
    return {
      success: false,
      error: {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    }
  }
}

/**
 * Authenticate an admin request against the ADMIN_API_KEY env var.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function authenticateAdmin(req: NextRequest): Promise<AuthResult> {
  const token = extractBearerToken(req)

  if (!token) {
    return {
      success: false,
      error: { status: 401, code: 'UNAUTHORIZED', message: 'Admin authorization is required' },
    }
  }

  const adminKey = config.auth.adminApiKey

  // Constant-time comparison using Buffer to prevent timing attacks
  let isEqual = false
  try {
    const tokenBuf = Buffer.from(token)
    const keyBuf = Buffer.from(adminKey)
    if (tokenBuf.length === keyBuf.length) {
      isEqual = crypto.timingSafeEqual(tokenBuf, keyBuf)
    }
  } catch {
    isEqual = false
  }

  if (!isEqual) {
    return {
      success: false,
      error: { status: 403, code: 'ADMIN_FORBIDDEN', message: 'Invalid admin credentials' },
    }
  }

  return { success: true }
}

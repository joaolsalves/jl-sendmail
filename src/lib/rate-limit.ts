import { prisma } from '@/src/lib/prisma'

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number // Unix timestamp (seconds)
}

const RATE_LIMIT = 30
const WINDOW_MS = 60_000 // 60 seconds

/**
 * Check and increment the rate limit counter for the given API Key.
 * Uses a fixed-window algorithm persisted in MySQL — safe for multi-instance deployments.
 */
export async function checkRateLimit(apiKeyId: string): Promise<RateLimitResult> {
  const now = Date.now()
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS)
  const resetAt = Math.floor((windowStart.getTime() + WINDOW_MS) / 1000)

  // Atomic upsert: insert with count=1 or increment existing count
  await prisma.$executeRaw`
    INSERT INTO rate_limits (apiKeyId, windowStart, count)
    VALUES (${apiKeyId}, ${windowStart}, 1)
    ON DUPLICATE KEY UPDATE count = count + 1
  `

  const record = await prisma.rateLimit.findUnique({
    where: {
      apiKeyId_windowStart: { apiKeyId, windowStart },
    },
    select: { count: true },
  })

  const count = record?.count ?? 1
  const allowed = count <= RATE_LIMIT
  const remaining = Math.max(0, RATE_LIMIT - count)

  return { allowed, limit: RATE_LIMIT, remaining, resetAt }
}

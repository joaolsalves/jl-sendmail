import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prismaMock } from '../../__mocks__/prisma'

vi.mock('@/src/lib/env', () => ({
  config: {
    database: { url: 'mysql://localhost/test' },
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
    auth: { adminApiKey: 'a'.repeat(32) },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

import { checkRateLimit } from '@/src/lib/rate-limit'

describe('checkRateLimit', () => {
  const apiKeyId = 'test-api-key-id'

  function mockCount(count: number) {
    prismaMock.$executeRaw.mockResolvedValue(1)
    prismaMock.rateLimit.findUnique.mockResolvedValue({
      apiKeyId,
      windowStart: new Date(),
      count,
    })
  }

  it('allows request when count is exactly 30', async () => {
    mockCount(30)
    const result = await checkRateLimit(apiKeyId)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
    expect(result.limit).toBe(30)
  })

  it('blocks request when count is 31', async () => {
    mockCount(31)
    const result = await checkRateLimit(apiKeyId)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('blocks request when count exceeds limit', async () => {
    mockCount(50)
    const result = await checkRateLimit(apiKeyId)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('returns correct remaining count for count=10', async () => {
    mockCount(10)
    const result = await checkRateLimit(apiKeyId)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(20)
  })

  it('returns a resetAt timestamp in the future', async () => {
    mockCount(1)
    const before = Math.floor(Date.now() / 1000)
    const result = await checkRateLimit(apiKeyId)
    expect(result.resetAt).toBeGreaterThanOrEqual(before)
    expect(result.resetAt).toBeLessThanOrEqual(before + 60)
  })

  it('returns limit=30 always', async () => {
    mockCount(5)
    const result = await checkRateLimit(apiKeyId)
    expect(result.limit).toBe(30)
  })
})

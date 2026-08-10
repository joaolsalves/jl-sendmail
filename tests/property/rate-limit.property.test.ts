// Feature: email-api, Property 2: Rate limit respeita o limite máximo por janela e bloqueia excedentes
// Feature: email-api, Property 3: Janela de rate limit é reiniciada e contadores são isolados por API Key
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import { prismaMock } from '../__mocks__/prisma'

vi.mock('@/src/lib/env', () => ({
  config: {
    database: { url: '' },
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
    auth: { adminApiKey: 'a'.repeat(32) },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

import { checkRateLimit } from '@/src/lib/rate-limit'

describe('Property 2: Rate limit respeita o limite máximo por janela', () => {
  it('requests within limit are allowed; requests beyond limit are blocked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 30 }),  // count within limit
        async (count) => {
          prismaMock.$executeRaw.mockResolvedValue(1)
          prismaMock.rateLimit.findUnique.mockResolvedValue({
            apiKeyId: 'k1', windowStart: new Date(), count,
          })

          const result = await checkRateLimit('k1')
          expect(result.allowed).toBe(true)
          expect(result.remaining).toBe(30 - count)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('requests beyond limit (count > 30) are always blocked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 31, max: 200 }),  // count exceeding limit
        async (count) => {
          prismaMock.$executeRaw.mockResolvedValue(1)
          prismaMock.rateLimit.findUnique.mockResolvedValue({
            apiKeyId: 'k1', windowStart: new Date(), count,
          })

          const result = await checkRateLimit('k1')
          expect(result.allowed).toBe(false)
          expect(result.remaining).toBe(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('Property 3: Contadores são isolados por API Key', () => {
  it('counter for K1 does not affect K2', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.integer({ min: 31, max: 100 }),  // K1 exceeded limit
        async (k1, k2, k1Count) => {
          fc.pre(k1 !== k2)

          prismaMock.$executeRaw.mockResolvedValue(1)
          // K1 has exceeded limit
          prismaMock.rateLimit.findUnique
            .mockResolvedValueOnce({ apiKeyId: k1, windowStart: new Date(), count: k1Count })
            // K2 has count=1 (fresh)
            .mockResolvedValueOnce({ apiKeyId: k2, windowStart: new Date(), count: 1 })

          const r1 = await checkRateLimit(k1)
          const r2 = await checkRateLimit(k2)

          expect(r1.allowed).toBe(false)
          expect(r2.allowed).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

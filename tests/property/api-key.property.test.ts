// Feature: email-api, Property 8: Revogação de API Key é idempotente
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

import { revokeApiKey } from '@/src/services/api-key.service'

describe('Property 8: Revogação de API Key é idempotente', () => {
  it('multiple revocations of the same key always result in active=false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),  // N calls
        async (keyId, n) => {
          // Always found
          prismaMock.apiKey.findUnique.mockResolvedValue({ id: keyId } as any)
          prismaMock.apiKey.update.mockResolvedValue({
            id: keyId,
            name: 'App',
            active: false,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastUsedAt: null,
            expiresAt: null,
          } as any)

          let lastResult = null
          for (let i = 0; i < n; i++) {
            lastResult = await revokeApiKey(keyId)
          }

          expect(lastResult?.active).toBe(false)
          expect(lastResult?.id).toBe(keyId)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('revoking a nonexistent key always returns null (never throws)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (keyId) => {
          prismaMock.apiKey.findUnique.mockResolvedValue(null)

          const result = await revokeApiKey(keyId)
          expect(result).toBeNull()
        }
      ),
      { numRuns: 100 }
    )
  })
})

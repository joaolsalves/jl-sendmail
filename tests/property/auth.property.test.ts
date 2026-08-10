// Feature: email-api, Property 1: Hash de API Key é determinístico e o valor em texto puro nunca é persistido
import { describe, it, expect, vi } from 'vitest'
import * as fc from 'fast-check'
import crypto from 'crypto'
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

import { createApiKey } from '@/src/services/api-key.service'

describe('Property 1: Hash de API Key é determinístico e o valor em texto puro nunca é persistido', () => {
  it('keyHash stored is always sha256(rawKey) and never equals rawKey', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        async (name) => {
          prismaMock.apiKey.create.mockResolvedValue({
            id: 'id',
            name,
            createdAt: new Date(),
          } as any)

          const result = await createApiKey({ name })

          const expectedHash = crypto
            .createHash('sha256')
            .update(result.key)
            .digest('hex')

          const storedHash = prismaMock.apiKey.create.mock.calls.at(-1)![0].data.keyHash

          // The stored hash must equal sha256(rawKey)
          expect(storedHash).toBe(expectedHash)
          // The stored hash must NEVER equal the raw key
          expect(storedHash).not.toBe(result.key)
          // Raw key is always 64 hex chars (32 bytes)
          expect(result.key).toHaveLength(64)
          expect(result.key).toMatch(/^[0-9a-f]+$/)
        }
      ),
      { numRuns: 100 }
    )
  })
})

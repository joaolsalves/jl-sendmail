// Feature: email-api, Property 5: Isolamento completo de logs entre API Keys distintas
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

import { getEmailLogs, getEmailLogById } from '@/src/services/email.service'

describe('Property 5: Isolamento completo de logs entre API Keys distintas', () => {
  it('logs created by K1 never appear in K2 listing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (k1, k2) => {
          fc.pre(k1 !== k2)

          // K2 query returns empty — it must never see K1 logs
          prismaMock.emailLog.findMany.mockResolvedValue([])
          prismaMock.emailLog.count.mockResolvedValue(0)

          const result = await getEmailLogs(k2, 1, 20)
          expect(result.data).toHaveLength(0)
          expect(result.pagination.total).toBe(0)

          // Verify the query was scoped to k2
          const queryWhere = prismaMock.emailLog.findMany.mock.calls.at(-1)![0]?.where
          expect(queryWhere?.apiKeyId).toBe(k2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('log belonging to K1 returns null when queried with K2', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.uuid(),
        async (k1, k2, logId) => {
          fc.pre(k1 !== k2)

          // Log belongs to k1
          prismaMock.emailLog.findUnique.mockResolvedValue({
            id: logId,
            apiKeyId: k1,
            recipient: 'u@e.com',
            subject: 'S',
            status: 'SENT',
            messageId: null,
            ipAddress: '1.1.1.1',
            errorMessage: null,
            createdAt: new Date(),
          } as any)

          // Queried with k2 — should return null (same as not found)
          const result = await getEmailLogById(logId, k2)
          expect(result).toBeNull()
        }
      ),
      { numRuns: 100 }
    )
  })
})

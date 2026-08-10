import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../../__mocks__/prisma'

vi.mock('@/src/lib/env', () => ({
  config: {
    auth: { adminApiKey: 'admin-secret-key-at-least-32-chars!!' },
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
    database: { url: '' },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

import { authenticateRequest, authenticateAdmin } from '@/src/lib/auth'
import { createMockNextRequest } from '../../helpers/request'

describe('authenticateRequest', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const req = createMockNextRequest('GET', '/api/v1/email/logs')
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(401)
    expect(result.error?.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when Authorization header has wrong format', async () => {
    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Basic somecreds',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(401)
  })

  it('returns 401 when key hash not found in DB', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(null)
    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Bearer nonexistent-key',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(401)
    expect(result.error?.code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 403 when API key is inactive', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({
      id: '1', name: 'test', active: false, expiresAt: null,
    } as any)
    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Bearer some-key',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(403)
    expect(result.error?.code).toBe('KEY_DISABLED')
  })

  it('returns 403 when API key is expired', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({
      id: '1', name: 'test', active: true,
      expiresAt: new Date('2020-01-01'),
    } as any)
    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Bearer some-key',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(403)
    expect(result.error?.code).toBe('KEY_EXPIRED')
  })

  it('returns success and updates lastUsedAt for valid key', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({
      id: 'key-id', name: 'My App', active: true, expiresAt: null,
    } as any)
    prismaMock.apiKey.update.mockResolvedValue({} as any)

    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Bearer valid-token',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(true)
    expect(result.apiKey?.id).toBe('key-id')
    expect(result.apiKey?.name).toBe('My App')
  })

  it('returns 503 when database is unavailable', async () => {
    prismaMock.apiKey.findUnique.mockRejectedValue(new Error('DB connection failed'))
    const req = createMockNextRequest('GET', '/api/v1/email/logs', {
      Authorization: 'Bearer some-key',
    })
    const result = await authenticateRequest(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(503)
    expect(result.error?.code).toBe('SERVICE_UNAVAILABLE')
  })
})

describe('authenticateAdmin', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const req = createMockNextRequest('POST', '/api/v1/api-keys')
    const result = await authenticateAdmin(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(401)
  })

  it('returns 403 when admin token is wrong', async () => {
    const req = createMockNextRequest('POST', '/api/v1/api-keys', {
      Authorization: 'Bearer wrong-admin-token',
    })
    const result = await authenticateAdmin(req)
    expect(result.success).toBe(false)
    expect(result.error?.status).toBe(403)
    expect(result.error?.code).toBe('ADMIN_FORBIDDEN')
  })

  it('returns success when admin token is correct', async () => {
    const req = createMockNextRequest('POST', '/api/v1/api-keys', {
      Authorization: 'Bearer admin-secret-key-at-least-32-chars!!',
    })
    const result = await authenticateAdmin(req)
    expect(result.success).toBe(true)
  })
})

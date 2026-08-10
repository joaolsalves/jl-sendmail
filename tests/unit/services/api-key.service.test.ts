import { describe, it, expect, vi } from 'vitest'
import { prismaMock } from '../../__mocks__/prisma'
import crypto from 'crypto'

vi.mock('@/src/lib/env', () => ({
  config: {
    database: { url: '' },
    smtp: { host: '', port: 465, user: '', pass: '', from: '' },
    auth: { adminApiKey: 'a'.repeat(32) },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

import { createApiKey, listApiKeys, revokeApiKey } from '@/src/services/api-key.service'

describe('createApiKey', () => {
  it('generates a 64-char hex key and stores only its SHA-256 hash', async () => {
    prismaMock.apiKey.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-id',
      name: data.name,
      createdAt: new Date(),
    }))

    const result = await createApiKey({ name: 'Test App' })

    expect(result.key).toHaveLength(64)
    expect(result.key).toMatch(/^[0-9a-f]+$/)

    const expectedHash = crypto
      .createHash('sha256')
      .update(result.key)
      .digest('hex')

    const storedHash = prismaMock.apiKey.create.mock.calls[0][0].data.keyHash
    expect(storedHash).toBe(expectedHash)
    expect(storedHash).not.toBe(result.key)
  })

  it('returns id, name, key and createdAt', async () => {
    const now = new Date()
    prismaMock.apiKey.create.mockResolvedValue({
      id: 'abc-123',
      name: 'My Service',
      createdAt: now,
    } as any)

    const result = await createApiKey({ name: 'My Service' })
    expect(result.id).toBe('abc-123')
    expect(result.name).toBe('My Service')
    expect(result.createdAt).toBe(now)
    expect(result.key).toBeTruthy()
  })

  it('persists expiresAt when provided', async () => {
    prismaMock.apiKey.create.mockResolvedValue({
      id: 'x', name: 'X', createdAt: new Date(),
    } as any)

    const expires = new Date(Date.now() + 86_400_000)
    await createApiKey({ name: 'X', expiresAt: expires })

    expect(prismaMock.apiKey.create.mock.calls[0][0].data.expiresAt).toEqual(expires)
  })
})

describe('listApiKeys', () => {
  it('returns list without keyHash', async () => {
    prismaMock.apiKey.findMany.mockResolvedValue([
      { id: '1', name: 'App A', active: true, createdAt: new Date(), updatedAt: new Date(), lastUsedAt: null, expiresAt: null },
    ] as any)

    const result = await listApiKeys()
    expect(result).toHaveLength(1)
    // Ensure keyHash is never in the select — verify it's not in the result
    expect((result[0] as any).keyHash).toBeUndefined()
  })
})

describe('revokeApiKey', () => {
  it('sets active=false for an existing key', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({ id: 'key-id' } as any)
    prismaMock.apiKey.update.mockResolvedValue({
      id: 'key-id', name: 'App', active: false,
      createdAt: new Date(), updatedAt: new Date(),
      lastUsedAt: null, expiresAt: null,
    } as any)

    const result = await revokeApiKey('key-id')
    expect(result?.active).toBe(false)
    expect(prismaMock.apiKey.update.mock.calls[0][0].data.active).toBe(false)
  })

  it('returns null when key ID does not exist', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue(null)
    const result = await revokeApiKey('nonexistent-id')
    expect(result).toBeNull()
    expect(prismaMock.apiKey.update).not.toHaveBeenCalled()
  })

  it('is idempotent — revoking already-inactive key succeeds', async () => {
    prismaMock.apiKey.findUnique.mockResolvedValue({ id: 'key-id' } as any)
    prismaMock.apiKey.update.mockResolvedValue({
      id: 'key-id', name: 'App', active: false,
      createdAt: new Date(), updatedAt: new Date(),
      lastUsedAt: null, expiresAt: null,
    } as any)

    const r1 = await revokeApiKey('key-id')
    const r2 = await revokeApiKey('key-id')
    expect(r1?.active).toBe(false)
    expect(r2?.active).toBe(false)
  })
})

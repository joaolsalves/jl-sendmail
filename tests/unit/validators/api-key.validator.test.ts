import { describe, it, expect } from 'vitest'
import { createApiKeySchema } from '@/src/validators/api-key.validator'

describe('createApiKeySchema', () => {
  it('accepts a valid name', () => {
    const result = createApiKeySchema.safeParse({ name: 'My App' })
    expect(result.success).toBe(true)
  })

  it('accepts name with optional future expiresAt', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const result = createApiKeySchema.safeParse({ name: 'My App', expiresAt: future })
    expect(result.success).toBe(true)
  })

  it('rejects empty name', () => {
    const result = createApiKeySchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('rejects name longer than 100 chars', () => {
    const result = createApiKeySchema.safeParse({ name: 'x'.repeat(101) })
    expect(result.success).toBe(false)
  })

  it('rejects expiresAt in the past', () => {
    const result = createApiKeySchema.safeParse({
      name: 'My App',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('expiresAt'))).toBe(true)
    }
  })

  it('rejects malformed expiresAt (not ISO 8601)', () => {
    const result = createApiKeySchema.safeParse({
      name: 'My App',
      expiresAt: '25/12/2030',
    })
    expect(result.success).toBe(false)
  })

  it('allows omitting expiresAt', () => {
    const result = createApiKeySchema.safeParse({ name: 'My App' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.expiresAt).toBeUndefined()
    }
  })
})

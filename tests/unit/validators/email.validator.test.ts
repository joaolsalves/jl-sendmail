import { describe, it, expect } from 'vitest'
import { sendEmailSchema, emailLogsQuerySchema } from '@/src/validators/email.validator'

describe('sendEmailSchema', () => {
  const valid = { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' }

  it('accepts a valid payload with html', () => {
    expect(sendEmailSchema.safeParse(valid).success).toBe(true)
  })

  it('accepts a valid payload with text only', () => {
    const result = sendEmailSchema.safeParse({ ...valid, html: undefined, text: 'Hello' })
    expect(result.success).toBe(true)
  })

  it('accepts payload with both html and text', () => {
    const result = sendEmailSchema.safeParse({ ...valid, text: 'Hello' })
    expect(result.success).toBe(true)
  })

  it('rejects when both html and text are absent', () => {
    const result = sendEmailSchema.safeParse({ to: valid.to, subject: valid.subject })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email in to field', () => {
    const result = sendEmailSchema.safeParse({ ...valid, to: 'not-an-email' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('to'))).toBe(true)
    }
  })

  it('rejects to longer than 254 chars', () => {
    const longEmail = 'a'.repeat(250) + '@x.com'
    const result = sendEmailSchema.safeParse({ ...valid, to: longEmail })
    expect(result.success).toBe(false)
  })

  it('rejects empty subject', () => {
    const result = sendEmailSchema.safeParse({ ...valid, subject: '' })
    expect(result.success).toBe(false)
  })

  it('rejects subject longer than 255 chars', () => {
    const result = sendEmailSchema.safeParse({ ...valid, subject: 'x'.repeat(256) })
    expect(result.success).toBe(false)
  })

  it('rejects html longer than 50000 chars', () => {
    const result = sendEmailSchema.safeParse({ ...valid, html: 'x'.repeat(50_001) })
    expect(result.success).toBe(false)
  })

  it('rejects text longer than 10000 chars', () => {
    const result = sendEmailSchema.safeParse({ ...valid, text: 'x'.repeat(10_001) })
    expect(result.success).toBe(false)
  })

  it('rejects unknown field cc (strict mode)', () => {
    const result = sendEmailSchema.safeParse({ ...valid, cc: 'cc@example.com' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown field bcc (strict mode)', () => {
    const result = sendEmailSchema.safeParse({ ...valid, bcc: 'bcc@example.com' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown field from (strict mode)', () => {
    const result = sendEmailSchema.safeParse({ ...valid, from: 'from@example.com' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown field attachments (strict mode)', () => {
    const result = sendEmailSchema.safeParse({ ...valid, attachments: [] })
    expect(result.success).toBe(false)
  })

  it('rejects invalid replyTo email', () => {
    const result = sendEmailSchema.safeParse({ ...valid, replyTo: 'not-an-email' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('replyTo'))).toBe(true)
    }
  })

  it('accepts valid replyTo email', () => {
    const result = sendEmailSchema.safeParse({ ...valid, replyTo: 'reply@example.com' })
    expect(result.success).toBe(true)
  })
})

describe('emailLogsQuerySchema', () => {
  it('defaults page to 1 and limit to 20', () => {
    const result = emailLogsQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
      expect(result.data.limit).toBe(20)
    }
  })

  it('accepts valid page and limit', () => {
    const result = emailLogsQuerySchema.safeParse({ page: '2', limit: '50' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(2)
      expect(result.data.limit).toBe(50)
    }
  })

  it('rejects page less than 1', () => {
    const result = emailLogsQuerySchema.safeParse({ page: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects limit greater than 100', () => {
    const result = emailLogsQuerySchema.safeParse({ limit: '101' })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer page', () => {
    const result = emailLogsQuerySchema.safeParse({ page: 'abc' })
    expect(result.success).toBe(false)
  })
})

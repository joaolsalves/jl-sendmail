import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '../../__mocks__/prisma'

vi.mock('@/src/lib/env', () => ({
  config: {
    smtp: { host: 'smtp.hostinger.com', port: 465, user: 'u', pass: 'p', from: 'no-reply@example.com' },
    database: { url: '' },
    auth: { adminApiKey: 'a'.repeat(32) },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

vi.mock('@/src/lib/mailer', () => ({
  sendMail: vi.fn(),
}))

import { sendMail } from '@/src/lib/mailer'
import { sendEmail, getEmailLogs, getEmailLogById } from '@/src/services/email.service'

const sendMailMock = sendMail as ReturnType<typeof vi.fn>

const baseInput = {
  to: 'user@example.com',
  subject: 'Test',
  html: '<p>Hello</p>',
  apiKeyId: 'key-id',
  ipAddress: '127.0.0.1',
}

describe('sendEmail', () => {
  beforeEach(() => {
    sendMailMock.mockReset()
  })

  it('persists SENT log and returns messageId + logId on success', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-001' })
    prismaMock.emailLog.create.mockResolvedValue({ id: 'log-001' } as any)

    const result = await sendEmail(baseInput)

    expect(result.messageId).toBe('msg-001')
    expect(result.logId).toBe('log-001')

    const logData = prismaMock.emailLog.create.mock.calls[0][0].data
    expect(logData.status).toBe('SENT')
    expect(logData.messageId).toBe('msg-001')
    expect(logData.errorMessage).toBeNull()
  })

  it('persists FAILED log with sanitized error and throws on SMTP failure', async () => {
    sendMailMock.mockRejectedValue(new Error('550 Mailbox not found'))
    prismaMock.emailLog.create.mockResolvedValue({ id: 'log-002' } as any)

    await expect(sendEmail(baseInput)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' })

    const logData = prismaMock.emailLog.create.mock.calls[0][0].data
    expect(logData.status).toBe('FAILED')
    expect(logData.errorMessage).toContain('550')
    expect(logData.errorMessage).not.toContain('Mailbox not found') // sanitized
  })

  it('records ipAddress in log', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-003' })
    prismaMock.emailLog.create.mockResolvedValue({ id: 'log-003' } as any)

    await sendEmail({ ...baseInput, ipAddress: '192.168.1.1' })

    const logData = prismaMock.emailLog.create.mock.calls[0][0].data
    expect(logData.ipAddress).toBe('192.168.1.1')
  })

  it('does not expose DB error to caller when log persistence fails', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-004' })
    prismaMock.emailLog.create.mockRejectedValue(new Error('DB error'))

    // Should NOT throw — DB log failure is silent
    const result = await sendEmail(baseInput)
    expect(result.messageId).toBe('msg-004')
  })

  it('throws EMAIL_DELIVERY_FAILED on SMTP timeout', async () => {
    sendMailMock.mockRejectedValue(new Error('Connection timeout'))
    prismaMock.emailLog.create.mockResolvedValue({ id: 'log-005' } as any)

    await expect(sendEmail(baseInput)).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' })

    const logData = prismaMock.emailLog.create.mock.calls[0][0].data
    expect(logData.status).toBe('FAILED')
  })
})

describe('getEmailLogs', () => {
  it('returns paginated logs for the given apiKeyId', async () => {
    const logs = [
      { id: 'l1', apiKeyId: 'key-id', recipient: 'u@e.com', subject: 'S', status: 'SENT', messageId: 'm1', ipAddress: '1.1.1.1', errorMessage: null, createdAt: new Date() },
    ]
    prismaMock.emailLog.findMany.mockResolvedValue(logs as any)
    prismaMock.emailLog.count.mockResolvedValue(1)

    const result = await getEmailLogs('key-id', 1, 20)
    expect(result.data).toHaveLength(1)
    expect(result.pagination.total).toBe(1)
    expect(result.pagination.page).toBe(1)
    expect(result.pagination.limit).toBe(20)
    expect(result.pagination.totalPages).toBe(1)
  })
})

describe('getEmailLogById', () => {
  it('returns log when it belongs to the authenticated apiKeyId', async () => {
    const log = { id: 'log-1', apiKeyId: 'key-id', recipient: 'u@e.com', subject: 'S', status: 'SENT', messageId: null, ipAddress: '1.1.1.1', errorMessage: null, createdAt: new Date() }
    prismaMock.emailLog.findUnique.mockResolvedValue(log as any)

    const result = await getEmailLogById('log-1', 'key-id')
    expect(result?.id).toBe('log-1')
  })

  it('returns null when log belongs to a different apiKeyId', async () => {
    const log = { id: 'log-1', apiKeyId: 'other-key', recipient: 'u@e.com', subject: 'S', status: 'SENT', messageId: null, ipAddress: '1.1.1.1', errorMessage: null, createdAt: new Date() }
    prismaMock.emailLog.findUnique.mockResolvedValue(log as any)

    const result = await getEmailLogById('log-1', 'key-id')
    expect(result).toBeNull()
  })

  it('returns null when log does not exist', async () => {
    prismaMock.emailLog.findUnique.mockResolvedValue(null)
    const result = await getEmailLogById('nonexistent', 'key-id')
    expect(result).toBeNull()
  })
})

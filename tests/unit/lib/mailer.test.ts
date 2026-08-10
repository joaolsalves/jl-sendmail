import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/src/lib/env', () => ({
  config: {
    smtp: {
      host: 'smtp.hostinger.com',
      port: 465,
      user: 'no-reply@example.com',
      pass: 'secret',
      from: 'no-reply@example.com',
    },
    database: { url: '' },
    auth: { adminApiKey: 'a'.repeat(32) },
    cors: { allowedOrigins: [] },
    server: { port: 3000 },
  },
}))

// Mock nodemailer
const sendMailMock = vi.fn()
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: sendMailMock,
    })),
  },
}))

import { sendMail, _resetTransporter } from '@/src/lib/mailer'

describe('sendMail', () => {
  beforeEach(() => {
    _resetTransporter()
    sendMailMock.mockReset()
  })

  it('returns messageId on successful send', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-123@smtp' })
    const result = await sendMail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<h1>Hello</h1>',
    })
    expect(result.messageId).toBe('msg-123@smtp')
  })

  it('throws when SMTP returns an error', async () => {
    sendMailMock.mockRejectedValue(new Error('550 Mailbox not found'))
    await expect(
      sendMail({ to: 'user@example.com', subject: 'Test', text: 'hello' })
    ).rejects.toThrow('550 Mailbox not found')
  })

  it('sends both html and text when both are provided (multipart/alternative)', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-456' })
    await sendMail({
      to: 'user@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
      text: 'Hello',
    })
    const callArg = sendMailMock.mock.calls[0][0]
    expect(callArg.html).toBe('<p>Hello</p>')
    expect(callArg.text).toBe('Hello')
  })

  it('always uses from address from config, not caller input', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-789' })
    await sendMail({ to: 'user@example.com', subject: 'Test', text: 'hi' })
    const callArg = sendMailMock.mock.calls[0][0]
    expect(callArg.from).toBe('no-reply@example.com')
  })

  it('forwards replyTo when provided', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'msg-abc' })
    await sendMail({
      to: 'user@example.com',
      subject: 'Test',
      text: 'hi',
      replyTo: 'reply@example.com',
    })
    const callArg = sendMailMock.mock.calls[0][0]
    expect(callArg.replyTo).toBe('reply@example.com')
  })
})

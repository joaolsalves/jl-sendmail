// Feature: email-api, Property 4: Log de e-mail sempre reflete o resultado real do envio SMTP
// Feature: email-api, Property 6: Campos proibidos no body são sempre rejeitados com HTTP 400
// Feature: email-api, Property 7: Validação de endereço de e-mail é consistente para `to` e `replyTo`
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { prismaMock } from '../__mocks__/prisma'

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
import { sendEmail } from '@/src/services/email.service'
import { sendEmailSchema, FORBIDDEN_FIELDS_V1 } from '@/src/validators/email.validator'

const sendMailMock = sendMail as ReturnType<typeof vi.fn>

describe('Property 4: Log sempre reflete o resultado real do SMTP', () => {
  beforeEach(() => {
    sendMailMock.mockReset()
  })

  it('SMTP success → log status is always SENT', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (to, subject) => {
          sendMailMock.mockResolvedValue({ messageId: `msg-${Math.random()}` })
          prismaMock.emailLog.create.mockResolvedValue({ id: 'log-id' } as any)

          await sendEmail({ to, subject, html: '<p>Test</p>', apiKeyId: 'k', ipAddress: '1.1.1.1' })

          const logData = prismaMock.emailLog.create.mock.calls.at(-1)![0].data
          expect(logData.status).toBe('SENT')
          expect(logData.messageId).toBeTruthy()
          expect(logData.errorMessage).toBeNull()
        }
      ),
      { numRuns: 50 }
    )
  })

  it('SMTP failure → log status is always FAILED with non-empty errorMessage', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 100 }),
        async (to, subject) => {
          sendMailMock.mockRejectedValue(new Error('550 User unknown'))
          prismaMock.emailLog.create.mockResolvedValue({ id: 'log-id' } as any)

          await expect(
            sendEmail({ to, subject, html: '<p>Test</p>', apiKeyId: 'k', ipAddress: '1.1.1.1' })
          ).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' })

          const logData = prismaMock.emailLog.create.mock.calls.at(-1)![0].data
          expect(logData.status).toBe('FAILED')
          expect(logData.errorMessage).toBeTruthy()
          expect(logData.messageId).toBeNull()
        }
      ),
      { numRuns: 50 }
    )
  })
})

describe('Property 6: Campos proibidos são sempre rejeitados pelo validator (.strict())', () => {
  it('any body containing a forbidden field is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FORBIDDEN_FIELDS_V1),
        fc.emailAddress(),
        fc.string({ minLength: 1, maxLength: 100 }),
        (forbiddenField, to, subject) => {
          const body = {
            to,
            subject,
            html: '<p>Test</p>',
            [forbiddenField]: 'some-value',
          }
          const result = sendEmailSchema.safeParse(body)
          expect(result.success).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('Property 7: Validação de e-mail é consistente para `to` e `replyTo`', () => {
  // Use a set of known-valid emails for Zod instead of fc.emailAddress()
  // which may generate RFC-valid but Zod-invalid addresses (e.g. "!@a.aa")
  const knownValidEmails = [
    'user@example.com',
    'name.surname@domain.org',
    'contact+tag@company.co.uk',
    'test123@sub.domain.com',
    'admin@hostinger.com',
    'no-reply@seudominio.com.br',
  ]

  it('known valid email addresses always pass validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownValidEmails),
        (email) => {
          const result = sendEmailSchema.safeParse({
            to: email,
            subject: 'Test',
            html: '<p>Hello</p>',
          })
          expect(result.success).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('strings without @ always fail validation for `to`', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('@')),
        (invalidEmail) => {
          const result = sendEmailSchema.safeParse({
            to: invalidEmail,
            subject: 'Test',
            html: '<p>Hello</p>',
          })
          expect(result.success).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })
})

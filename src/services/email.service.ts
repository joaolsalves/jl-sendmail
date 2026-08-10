import { prisma } from '@/src/lib/prisma'
import { sendMail } from '@/src/lib/mailer'
import type { PaginationMeta, EmailLogPublic } from '@/src/types'

export interface SendEmailServiceInput {
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  from?: string
  apiKeyId: string
  ipAddress: string
}

export interface SendEmailOutput {
  messageId: string
  logId: string
}

/**
 * Sanitize SMTP error messages before storing — remove hostnames, IPs, credentials.
 */
function sanitizeSmtpError(err: unknown): string {
  if (!(err instanceof Error)) return 'SMTP error'
  // Extract SMTP response code if present (e.g. "550 User unknown")
  const codeMatch = err.message.match(/\b[45]\d{2}\b/)
  if (codeMatch) return `SMTP ${codeMatch[0]}`
  // Generic fallback — never expose internal details
  return 'Email delivery failed'
}

/**
 * Send an email via SMTP and persist the result log.
 * Throws a tagged error on SMTP failure so the route handler can return HTTP 502.
 */
export async function sendEmail(input: SendEmailServiceInput): Promise<SendEmailOutput> {
  let messageId: string | null = null
  let errorMessage: string | null = null
  let succeeded = false

  try {
    const result = await sendMail({
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      from: input.from,
    })
    messageId = result.messageId
    succeeded = true
  } catch (err) {
    errorMessage = sanitizeSmtpError(err)
  }

  // Persist log — do not let a DB error mask the SMTP result
  let logId: string | undefined
  try {
    const log = await prisma.emailLog.create({
      data: {
        apiKeyId: input.apiKeyId,
        recipient: input.to,
        subject: input.subject,
        status: succeeded ? 'SENT' : 'FAILED',
        messageId: messageId ?? null,
        ipAddress: input.ipAddress,
        errorMessage: errorMessage ?? null,
      },
      select: { id: true },
    })
    logId = log.id
  } catch {
    // Log failure is non-critical — server logs but does not expose to client
    console.error('[email.service] Failed to persist email log')
  }

  if (!succeeded) {
    const err = new Error(errorMessage ?? 'Email delivery failed') as Error & {
      code: string
    }
    err.code = 'EMAIL_DELIVERY_FAILED'
    throw err
  }

  return { messageId: messageId!, logId: logId! }
}

/**
 * List email logs for the given API Key with pagination.
 * Returns logs ordered by createdAt DESC, id DESC for deterministic ordering.
 */
export async function getEmailLogs(
  apiKeyId: string,
  page: number,
  limit: number
): Promise<{ data: EmailLogPublic[]; pagination: PaginationMeta }> {
  const skip = (page - 1) * limit

  const [data, total] = await Promise.all([
    prisma.emailLog.findMany({
      where: { apiKeyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
      select: {
        id: true,
        apiKeyId: true,
        recipient: true,
        subject: true,
        status: true,
        messageId: true,
        ipAddress: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
    prisma.emailLog.count({ where: { apiKeyId } }),
  ])

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
}

/**
 * Get a single email log by ID — only if it belongs to the given API Key.
 * Returns null if not found or if it belongs to a different API Key.
 */
export async function getEmailLogById(
  id: string,
  apiKeyId: string
): Promise<EmailLogPublic | null> {
  const log = await prisma.emailLog.findUnique({
    where: { id },
    select: {
      id: true,
      apiKeyId: true,
      recipient: true,
      subject: true,
      status: true,
      messageId: true,
      ipAddress: true,
      errorMessage: true,
      createdAt: true,
    },
  })

  // Return null for both "not found" and "belongs to another key" — no info leakage
  if (!log || log.apiKeyId !== apiKeyId) return null

  return log
}

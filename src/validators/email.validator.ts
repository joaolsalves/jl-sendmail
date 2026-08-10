import { z } from 'zod'

/**
 * Schema for POST /api/v1/email/send
 * - Uses .strict() to reject unknown fields (cc, bcc, attachments etc.)
 * - Requires at least one of html or text
 * - Accepts optional `from` field (client-provided sender address)
 */
export const sendEmailSchema = z
  .object({
    to: z.string().email('Invalid email address').max(254, 'Email address too long'),
    subject: z
      .string()
      .min(1, 'Subject is required')
      .max(255, 'Subject must be 255 characters or less'),
    html: z
      .string()
      .max(50_000, 'HTML content must be 50,000 characters or less')
      .optional(),
    text: z
      .string()
      .max(10_000, 'Plain text content must be 10,000 characters or less')
      .optional(),
    replyTo: z.string().email('Invalid replyTo email address').optional(),
    from: z.string().email('Invalid from email address').optional(),
  })
  .strict() // rejects cc, bcc, attachments → ZodError with unrecognized_keys
  .refine((d) => d.html || d.text, {
    message: 'At least one of html or text is required',
    path: ['html'],
  })

export type SendEmailInput = z.infer<typeof sendEmailSchema>

/**
 * Schema for GET /api/v1/email/logs query params
 */
export const emailLogsQuerySchema = z.object({
  page: z.coerce.number().int('page must be an integer').min(1, 'page must be >= 1').default(1),
  limit: z
    .coerce
    .number()
    .int('limit must be an integer')
    .min(1, 'limit must be >= 1')
    .max(100, 'limit must be <= 100')
    .default(20),
})

export type EmailLogsQuery = z.infer<typeof emailLogsQuerySchema>

/**
 * Set of field names explicitly forbidden in V1.
 * `from` is now allowed, so removed from this list.
 */
export const FORBIDDEN_FIELDS_V1 = ['cc', 'bcc', 'attachments'] as const

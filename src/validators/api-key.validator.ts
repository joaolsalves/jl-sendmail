import { z } from 'zod'

/**
 * Schema for POST /api/v1/api-keys
 */
export const createApiKeySchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be a valid ISO 8601 datetime' })
    .optional()
    .refine(
      (v) => !v || new Date(v) > new Date(),
      { message: 'expiresAt must be a future date' }
    ),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>

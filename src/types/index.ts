import type { EmailStatus } from '@prisma/client'

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

// ---------------------------------------------------------------------------
// EmailLog (public shape — safe to return in API responses)
// ---------------------------------------------------------------------------

export interface EmailLogPublic {
  id: string
  apiKeyId: string
  recipient: string
  subject: string
  status: EmailStatus
  messageId: string | null
  ipAddress: string
  errorMessage: string | null
  createdAt: Date
}

// ---------------------------------------------------------------------------
// ApiKey (public shape — without keyHash)
// ---------------------------------------------------------------------------

export interface ApiKeyPublic {
  id: string
  name: string
  active: boolean
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

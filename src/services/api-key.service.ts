import crypto from 'crypto'
import { prisma } from '@/src/lib/prisma'
import type { ApiKeyPublic } from '@/src/types'

export interface CreateApiKeyServiceInput {
  name: string
  expiresAt?: Date
}

export interface CreateApiKeyOutput {
  id: string
  name: string
  key: string // plaintext — exposed ONLY at creation time
  createdAt: Date
}

/**
 * Generate a cryptographically secure API Key and persist only its SHA-256 hash.
 */
export async function createApiKey(
  input: CreateApiKeyServiceInput
): Promise<CreateApiKeyOutput> {
  const rawKey = crypto.randomBytes(32).toString('hex') // 64 hex chars
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex')

  const record = await prisma.apiKey.create({
    data: {
      name: input.name,
      keyHash,
      active: true,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true, name: true, createdAt: true },
  })

  return {
    id: record.id,
    name: record.name,
    key: rawKey, // plaintext returned once — never stored
    createdAt: record.createdAt,
  }
}

/**
 * List all API Keys — never exposes keyHash.
 */
export async function listApiKeys(): Promise<ApiKeyPublic[]> {
  return prisma.apiKey.findMany({
    select: {
      id: true,
      name: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Revoke an API Key by setting active = false.
 * Idempotent: if already inactive, still returns the record.
 * Returns null if the ID does not exist.
 */
export async function revokeApiKey(id: string): Promise<ApiKeyPublic | null> {
  const existing = await prisma.apiKey.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!existing) return null

  return prisma.apiKey.update({
    where: { id },
    data: { active: false },
    select: {
      id: true,
      name: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  })
}

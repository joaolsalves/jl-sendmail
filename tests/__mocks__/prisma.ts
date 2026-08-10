import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { beforeEach, vi } from 'vitest'

// The mock must be declared before vi.mock() hoisting
export const prismaMock = mockDeep<PrismaClient>()

// Auto-reset before each test
beforeEach(() => {
  mockReset(prismaMock)
})

// Replace the real prisma singleton with the mock
vi.mock('@/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

// Endpoint de diagnóstico temporário — remover após resolver o problema
export async function GET(): Promise<NextResponse> {
  // Mostra DATABASE_URL completa para diagnóstico (remover após resolver)
  const rawUrl = process.env.DATABASE_URL ?? 'not set'

  try {
    await prisma.$queryRaw`SELECT 1`

    const [apiKeyCount, logCount] = await Promise.all([
      prisma.apiKey.count(),
      prisma.emailLog.count(),
    ])

    return NextResponse.json({
      status: 'connected',
      database: { apiKeys: apiKeyCount, emailLogs: logCount },
      DATABASE_URL: rawUrl,
      ADMIN_API_KEY_LENGTH: process.env.ADMIN_API_KEY?.length ?? 0,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      status: 'error',
      error: message,
      DATABASE_URL: rawUrl,
      ADMIN_API_KEY_LENGTH: process.env.ADMIN_API_KEY?.length ?? 0,
    }, { status: 500 })
  }
}

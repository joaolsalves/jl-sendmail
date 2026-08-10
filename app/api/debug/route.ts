import { NextResponse } from 'next/server'
import { prisma } from '@/src/lib/prisma'

// Endpoint de diagnóstico temporário — remover após resolver o problema
// GET /api/debug — testa a conexão com o banco de dados
// Não requer autenticação para facilitar diagnóstico
export async function GET(): Promise<NextResponse> {
  try {
    // Testa a conexão com o banco
    await prisma.$queryRaw`SELECT 1`

    // Conta registros em cada tabela
    const [apiKeyCount, logCount] = await Promise.all([
      prisma.apiKey.count(),
      prisma.emailLog.count(),
    ])

    return NextResponse.json({
      status: 'connected',
      database: {
        apiKeys: apiKeyCount,
        emailLogs: logCount,
      },
      env: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@') ?? 'not set',
        ADMIN_API_KEY: process.env.ADMIN_API_KEY ? `set (${process.env.ADMIN_API_KEY.length} chars)` : 'not set',
        SMTP_HOST: process.env.SMTP_HOST ?? 'not set',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? 'not set',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      status: 'error',
      error: message,
      DATABASE_URL: process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@') ?? 'not set',
    }, { status: 500 })
  }
}

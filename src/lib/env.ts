import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM: z.string().email(),
  ADMIN_API_KEY: z.string().min(32),
  ALLOWED_ORIGINS: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
})

export interface AppConfig {
  database: { url: string }
  smtp: { host: string; port: number; user: string; pass: string; from: string }
  auth: { adminApiKey: string }
  cors: { allowedOrigins: string[] }
  server: { port: number }
}

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ')
    process.stderr.write(
      `[env] Missing or invalid environment variables: ${missing}\n`
    )
    // Em produção, logar mas não derrubar o processo — o app retorna 503 nas rotas afetadas
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1)
    }
    // Retornar config parcial com valores vazios para produção
    return {
      database: { url: process.env.DATABASE_URL ?? '' },
      smtp: {
        host: process.env.SMTP_HOST ?? '',
        port: parseInt(process.env.SMTP_PORT ?? '465'),
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
        from: process.env.SMTP_FROM ?? '',
      },
      auth: { adminApiKey: process.env.ADMIN_API_KEY ?? '' },
      cors: {
        allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      },
      server: { port: parseInt(process.env.PORT ?? '3000') },
    }
  }

  const env = result.data

  return {
    database: { url: env.DATABASE_URL },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    },
    auth: { adminApiKey: env.ADMIN_API_KEY },
    cors: {
      allowedOrigins: env.ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    },
    server: { port: env.PORT },
  }
}

// Lazy singleton — evaluated on first access, not at module load time during build
let _config: AppConfig | null = null

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig()
  }
  return _config
}

// Convenience export — use getConfig() in route handlers; use config in lib files
// that are only called at request time (not during build)
export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return getConfig()[prop as keyof AppConfig]
  },
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('src/lib/env.ts — loadConfig()', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key]
    }
    Object.assign(process.env, originalEnv)
    vi.resetModules()
  })

  function setValidEnv() {
    process.env.DATABASE_URL = 'mysql://root:pass@localhost:3306/test'
    process.env.SMTP_HOST = 'smtp.hostinger.com'
    process.env.SMTP_PORT = '465'
    process.env.SMTP_USER = 'no-reply@example.com'
    process.env.SMTP_PASS = 'secret'
    process.env.SMTP_FROM = 'no-reply@example.com'
    process.env.ADMIN_API_KEY = 'a'.repeat(32)
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000'
    process.env.PORT = '3000'
  }

  it('loads config correctly when all env vars are present', async () => {
    setValidEnv()
    const { loadConfig } = await import('@/src/lib/env')
    const cfg = loadConfig()

    expect(cfg.database.url).toBe('mysql://root:pass@localhost:3306/test')
    expect(cfg.smtp.host).toBe('smtp.hostinger.com')
    expect(cfg.smtp.port).toBe(465)
    expect(cfg.smtp.user).toBe('no-reply@example.com')
    expect(cfg.smtp.from).toBe('no-reply@example.com')
    expect(cfg.auth.adminApiKey).toBe('a'.repeat(32))
    expect(cfg.cors.allowedOrigins).toEqual(['http://localhost:3000'])
    expect(cfg.server.port).toBe(3000)
  })

  it('parses ALLOWED_ORIGINS as a comma-separated array', async () => {
    setValidEnv()
    process.env.ALLOWED_ORIGINS = 'https://a.com, https://b.com , https://c.com'
    const { loadConfig } = await import('@/src/lib/env')
    const cfg = loadConfig()

    expect(cfg.cors.allowedOrigins).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ])
  })

  it('defaults PORT to 3000 when not set', async () => {
    setValidEnv()
    delete process.env.PORT
    const { loadConfig } = await import('@/src/lib/env')
    const cfg = loadConfig()
    expect(cfg.server.port).toBe(3000)
  })

  it('calls process.exit(1) when required vars are missing', async () => {
    delete process.env.DATABASE_URL
    delete process.env.SMTP_HOST
    delete process.env.SMTP_PORT
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASS
    delete process.env.SMTP_FROM
    delete process.env.ADMIN_API_KEY
    delete process.env.ALLOWED_ORIGINS

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called')
    }) as never)

    const { loadConfig } = await import('@/src/lib/env')
    expect(() => loadConfig()).toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)

    exitSpy.mockRestore()
  })
})

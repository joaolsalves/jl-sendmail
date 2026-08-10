#!/usr/bin/env node
/**
 * Gera o arquivo .env a partir das variáveis de ambiente do sistema.
 * Usado no prebuild da Hostinger para garantir que as variáveis
 * configuradas no painel sejam usadas corretamente.
 *
 * Executado automaticamente via: npm run prebuild
 */

const fs = require('fs')
const path = require('path')

const ENV_FILE = path.resolve(__dirname, '..', '.env')

const REQUIRED_VARS = [
  'DATABASE_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'ADMIN_API_KEY',
  'ALLOWED_ORIGINS',
]

const OPTIONAL_VARS = ['PORT']

// Verificar se estamos em produção
if (process.env.NODE_ENV !== 'production') {
  console.log('generate-env: não é produção, pulando geração do .env')
  process.exit(0)
}

// Verificar variáveis obrigatórias
const missing = REQUIRED_VARS.filter((v) => !process.env[v])
if (missing.length > 0) {
  console.warn(`generate-env: variáveis não encontradas no ambiente: ${missing.join(', ')}`)
  console.warn('generate-env: o .env existente será mantido')
  process.exit(0)
}

// Gerar conteúdo do .env
const lines = ['# Gerado automaticamente pelo script generate-env.js', '']

for (const key of [...REQUIRED_VARS, ...OPTIONAL_VARS]) {
  const value = process.env[key]
  if (value !== undefined) {
    lines.push(`${key}=${value}`)
  }
}

lines.push('')

const content = lines.join('\n')

fs.writeFileSync(ENV_FILE, content, 'utf8')
console.log('generate-env: .env gerado com sucesso a partir das variáveis do ambiente')
console.log(`generate-env: DATABASE_URL=${process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@')}`)

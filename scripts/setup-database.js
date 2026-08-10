#!/usr/bin/env node
/**
 * Setup do banco de dados para produção (Hostinger).
 * Executa a migration do Prisma usando a DATABASE_URL configurada.
 *
 * Uso via SSH na Hostinger:
 *   node scripts/setup-database.js
 *
 * Ou pelo npm:
 *   npm run db:setup
 */

const { execSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

function run(cmd, label) {
  console.log(`\n▶ ${label}`)
  console.log(`  $ ${cmd}\n`)
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
    console.log(`✓ ${label} — concluído\n`)
  } catch (err) {
    console.error(`✗ ${label} — falhou`)
    console.error(err.message)
    process.exit(1)
  }
}

console.log('============================================')
console.log('  EMAIL API — Setup do banco de dados')
console.log('============================================')

// 1. Verificar se DATABASE_URL está definida
if (!process.env.DATABASE_URL) {
  console.error('\n✗ DATABASE_URL não está definida.')
  console.error('  Configure a variável de ambiente antes de executar este script.')
  console.error('  Exemplo: export DATABASE_URL="mysql://user:pass@localhost:3306/db"\n')
  process.exit(1)
}

const dbUrl = process.env.DATABASE_URL
// Ocultar senha no log
const safeUrl = dbUrl.replace(/:([^:@]+)@/, ':***@')
console.log(`\n  DATABASE_URL: ${safeUrl}`)

// 2. Gerar Prisma Client
run('npx prisma generate', 'Gerando Prisma Client')

// 3. Aplicar migrations
run('npx prisma migrate deploy', 'Aplicando migrations no banco de dados')

console.log('============================================')
console.log('  Banco de dados configurado com sucesso!')
console.log('============================================')
console.log('\nTabelas criadas:')
console.log('  • api_keys')
console.log('  • email_logs')
console.log('  • rate_limits')
console.log('  • _prisma_migrations\n')
console.log('Próximo passo: npm run build && npm start\n')

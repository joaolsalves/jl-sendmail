# Implementation Plan: email-api

## Overview

Implementação incremental da email-api — uma API REST transacional construída com Next.js 14 (App Router) + TypeScript, Prisma ORM + MySQL, autenticação por API Key com hash SHA-256, rate limiting persistido em MySQL e envio de e-mails via SMTP Hostinger. As tarefas seguem a ordem: scaffolding → banco de dados → ambiente → infraestrutura lib → services → validators → middleware → route handlers → página inicial → testes → documentação.

---

## Tasks

- [x] 1. Scaffolding do projeto Next.js
  - [x] 1.1 Inicializar projeto Next.js 14 com TypeScript e App Router
    - Executar `npx create-next-app@latest . --typescript --app --no-src-dir --no-tailwind --eslint --import-alias "@/*"` na raiz do workspace
    - Verificar que a estrutura `app/`, `public/` e `tsconfig.json` foi gerada corretamente
    - _Requirements: 11.1, 11.3_

  - [x] 1.2 Instalar dependências de produção
    - Instalar: `prisma`, `@prisma/client`, `nodemailer`, `zod`
    - Instalar tipos: `@types/nodemailer`
    - Usar versões exatas (ex: `npm install prisma@^5 @prisma/client@^5 nodemailer@^6 zod@^3`)
    - _Requirements: 10.5, 4.1_

  - [x] 1.3 Instalar dependências de desenvolvimento e teste
    - Instalar: `vitest`, `@vitest/coverage-v8`, `fast-check`, `nodemailer-mock`, `@types/node`
    - Criar `vitest.config.ts` configurando alias `@/` para a raiz e separando os diretórios `tests/unit`, `tests/property` e `tests/integration`
    - _Requirements: (suporte a testes — design Testing Strategy)_

  - [x] 1.4 Configurar `tsconfig.json` e scripts do `package.json`
    - Garantir `paths: { "@/*": ["./*"] }` no `tsconfig.json`
    - Adicionar scripts: `"dev"`, `"build"`, `"start"`, `"test"`, `"test:unit"`, `"test:property"`, `"test:integration"`, `"prisma:migrate"`, `"prisma:generate"`
    - _Requirements: 11.3_

- [x] 2. Configuração do Prisma e banco de dados
  - [x] 2.1 Inicializar Prisma e criar `prisma/schema.prisma`
    - Executar `npx prisma init --datasource-provider mysql`
    - Escrever o schema completo: models `ApiKey`, `EmailLog`, `RateLimit` e enum `EmailStatus` conforme o design
    - Incluir todos os índices especificados: `@@index([keyHash])`, `@@index([active])`, `@@index([apiKeyId, createdAt(sort: Desc)])`, `@@index([apiKeyId, id])` e PK composta `@@id([apiKeyId, windowStart])` em `RateLimit`
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 2.2 Criar migration inicial
    - Executar `npx prisma migrate dev --name init` para gerar a migration SQL e o Prisma Client
    - Verificar que as tabelas `api_keys`, `email_logs`, `rate_limits` e o enum `EmailStatus` foram criados corretamente
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 2.3 Gerar mock do Prisma para testes
    - Criar `tests/__mocks__/prisma.ts` exportando `prismaMock` usando `vitest-mock-extended` ou implementação manual de mock para todos os métodos usados nos testes
    - _Requirements: (suporte aos property tests — design Testing Strategy)_

- [x] 3. Configuração de variáveis de ambiente
  - [x] 3.1 Criar `src/lib/env.ts` com validação de variáveis de ambiente
    - Implementar `loadConfig()` usando Zod que valida: `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT` (coerce number), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_API_KEY`, `ALLOWED_ORIGINS` (split por vírgula em array), `PORT` (opcional, padrão 3000)
    - Exportar `config` como singleton; se qualquer variável obrigatória faltar, chamar `process.exit(1)` e registrar no `stderr` quais estão ausentes
    - Implementar a interface `AppConfig` conforme o design
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 2.5_

  - [x] 3.2 Criar `.env.example` na raiz do projeto
    - Listar todas as variáveis com valores de exemplo (sem valores reais): `DATABASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_API_KEY`, `ALLOWED_ORIGINS`, `PORT`
    - Adicionar `.env` e `.env.local` ao `.gitignore` se ainda não estiverem
    - _Requirements: 11.1, 12.2_

- [x] 4. Infraestrutura lib
  - [x] 4.1 Criar `src/lib/prisma.ts` — Prisma Client Singleton
    - Implementar padrão singleton para evitar múltiplas conexões em hot-reload do Next.js
    - Usar `globalThis` para armazenar a instância em desenvolvimento
    - Exportar `prisma: PrismaClient`
    - _Requirements: 10.5_

  - [x] 4.2 Criar `src/lib/mailer.ts` — transporte SMTP Nodemailer
    - Implementar singleton do Nodemailer com `config.smtp`
    - Configurar `connectionTimeout: 30_000`, `greetingTimeout: 30_000`, `socketTimeout: 30_000`
    - Definir `secure: config.smtp.port === 465`
    - Exportar `sendMail(options: SendMailOptions): Promise<SendMailResult>` conforme o design
    - _Requirements: 4.1, 4.6, 4.9, 4.12_

  - [x] 4.3 Criar `src/lib/auth.ts` — autenticação por API Key e admin
    - Implementar `authenticateRequest(req: NextRequest): Promise<AuthResult>` — hash SHA-256 do Bearer token, lookup no banco, verificação de `active` e `expiresAt`, update de `lastUsedAt`
    - Implementar `authenticateAdmin(req: NextRequest): Promise<AuthResult>` — comparação via `crypto.timingSafeEqual()` contra `config.auth.adminApiKey`
    - Retornar `{ status: 503 }` se DB indisponível; nunca expor detalhes internos
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4_

  - [x] 4.4 Criar `src/lib/rate-limit.ts` — rate limiting com MySQL
    - Implementar `checkRateLimit(apiKeyId: string): Promise<RateLimitResult>`
    - Algoritmo de janela fixa: `windowStart = floor(now / 60_000) * 60_000`
    - UPSERT atômico na tabela `RateLimit` com `count += 1` via `prisma.$transaction`
    - Retornar `{ allowed, limit: 30, remaining, resetAt }` conforme o design
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.5 Criar `src/lib/responses.ts` — helpers de resposta padronizados
    - Implementar `errorResponse(status, code, message, fields?)`, `successResponse(data, status?, headers?)`, `rateLimitResponse(rl)`, `validationErrorResponse(error: ZodError)`
    - Todas as respostas de erro seguem o formato `{ success: false, error: { code, message, fields? } }`
    - Todas as respostas de sucesso seguem o formato `{ success: true, ...data }`
    - _Requirements: 7.8, 9.2, 9.3_

- [x] 5. Services
  - [x] 5.1 Criar `src/services/api-key.service.ts`
    - Implementar `createApiKey(input): Promise<CreateApiKeyOutput>` — gerar `crypto.randomBytes(32).toString('hex')`, calcular `keyHash = sha256(rawKey)`, persistir via Prisma, retornar com `key` em texto puro
    - Implementar `listApiKeys(): Promise<ApiKeyPublic[]>` — retornar todos os campos públicos (sem `keyHash`)
    - Implementar `revokeApiKey(id): Promise<ApiKeyPublic | null>` — setar `active = false` de forma idempotente; retornar `null` se ID não existir
    - Exportar interfaces `CreateApiKeyInput`, `CreateApiKeyOutput`, `ApiKeyPublic`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 6.9, 1.9, 10.1, 10.3_

  - [x] 5.2 Criar `src/services/email.service.ts`
    - Implementar `sendEmail(input: SendEmailInput): Promise<SendEmailOutput>` — chamar `sendMail`, persistir `EmailLog` com `status = "SENT"` ou `"FAILED"` conforme resultado SMTP
    - Sanitizar mensagens de erro SMTP (extrair apenas código, ex: `"SMTP 550"`) antes de persistir e nunca expor na resposta pública; retornar HTTP 502 para falhas
    - Implementar `getEmailLogs(apiKeyId, page, limit)` — retornar logs paginados em ordem `createdAt DESC, id DESC`
    - Implementar `getEmailLogById(id, apiKeyId)` — retornar `null` se não encontrado ou se pertencer a outra API Key
    - Exportar interfaces `SendEmailInput`, `SendEmailOutput`
    - _Requirements: 4.1, 4.4, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 5.1, 5.2, 5.4, 5.6, 5.7, 10.2_

- [x] 6. Validators (Zod schemas)
  - [x] 6.1 Criar `src/validators/email.validator.ts`
    - Implementar `sendEmailSchema` com `.strict()`: campos `to` (email, máx 254), `subject` (1–255), `html` (máx 50.000, opcional), `text` (máx 10.000, opcional), `replyTo` (email, opcional)
    - Adicionar `.refine(d => d.html || d.text)` para exigir ao menos um campo de conteúdo
    - Implementar `emailLogsQuerySchema`: `page` (coerce int ≥ 1, padrão 1) e `limit` (coerce int 1–100, padrão 20)
    - _Requirements: 4.2, 4.3, 4.5, 4.13, 5.2, 5.3_

  - [x] 6.2 Criar `src/validators/api-key.validator.ts`
    - Implementar `createApiKeySchema`: `name` (1–100 chars), `expiresAt` (ISO 8601 datetime, opcional, deve ser data futura)
    - _Requirements: 6.4, 6.5_

- [x] 7. Middleware de segurança
  - [x] 7.1 Criar `middleware.ts` na raiz do projeto (Next.js middleware)
    - Aplicar headers de segurança em todas as respostas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
    - Implementar verificação CORS: ler `ALLOWED_ORIGINS`, comparar com `req.headers.get('origin')`, retornar HTTP 403 se não permitida
    - Verificar `Content-Type: application/json` para requisições com corpo (POST/PATCH/PUT) nos endpoints `/api/v1/*`; retornar HTTP 415 se diferente
    - Verificar tamanho do body: retornar HTTP 413 se `Content-Length` > 100.000 bytes
    - Aplicar validações na ordem: CORS → Content-Type → tamanho do body (conforme Requirements 7.7)
    - Excluir `/api/health` da autenticação, mas incluir nos security headers
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.3_

- [x] 8. Route Handlers
  - [x] 8.1 Criar `app/api/v1/email/send/route.ts`
    - Implementar `POST`: autenticação (`authenticateRequest`) → rate limit (`checkRateLimit`) → validação body (`sendEmailSchema.safeParse`) → envio (`sendEmail`) → resposta com `rateLimitHeaders`
    - Capturar IP do cliente via `x-forwarded-for` header ou `req.ip`
    - Retornar `{ success: true, messageId, logId }` com headers de rate limit em caso de sucesso
    - _Requirements: 1.1, 3.1, 3.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.9, 4.10, 4.11_

  - [x] 8.2 Criar `app/api/v1/email/logs/route.ts`
    - Implementar `GET`: autenticação → parse de query params via `emailLogsQuerySchema` → `getEmailLogs(apiKeyId, page, limit)` → retornar com paginação
    - _Requirements: 1.1, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.3 Criar `app/api/v1/email/logs/[id]/route.ts`
    - Implementar `GET`: autenticação → `getEmailLogById(id, apiKeyId)` → retornar 404 se `null` (sem distinguir "não existe" de "de outra key")
    - _Requirements: 1.1, 5.6, 5.7, 5.8_

  - [x] 8.4 Criar `app/api/v1/api-keys/route.ts`
    - Implementar `GET`: autenticação admin → `listApiKeys()` → retornar array de `ApiKeyPublic` (sem `keyHash`)
    - Implementar `POST`: autenticação admin → validação body (`createApiKeySchema`) → `createApiKey()` → retornar HTTP 201 com `{ id, name, key, createdAt }`
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 8.5 Criar `app/api/v1/api-keys/[id]/route.ts`
    - Implementar `DELETE`: autenticação admin → `revokeApiKey(id)` → retornar HTTP 200 com `{ id, active: false }` ou HTTP 404 se `null`
    - _Requirements: 2.1, 6.7, 6.8, 6.9_

  - [x] 8.6 Criar `app/api/health/route.ts`
    - Implementar `GET` sem autenticação: retornar HTTP 200 `{ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" }`
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.7 Criar handler de rota não encontrada e método não permitido
    - Criar `app/not-found.tsx` ou configurar `next.config.ts` para retornar `{ error: "Not found" }` em rotas inexistentes
    - Garantir que métodos HTTP não suportados nos route handlers retornem HTTP 405 `{ error: "Method not allowed" }`
    - _Requirements: 9.2, 9.3_

- [x] 9. Página inicial
  - [x] 9.1 Criar `app/page.tsx` — página de status da API
    - Implementar página minimalista exibindo nome da API, versão e link para documentação
    - Não requer autenticação nem acesso ao banco
    - _Requirements: (boa prática de projeto)_

- [x] 10. Checkpoint — verificar compilação e estrutura
  - Executar `npm run build` e garantir que compila sem erros TypeScript ou de lint
  - Verificar que todas as rotas estão registradas e que `prisma generate` foi executado
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Testes unitários
  - [x] 11.1 Criar `tests/unit/lib/env.test.ts`
    - Testar que `loadConfig()` lança/encerra quando variáveis estão ausentes
    - Testar que `config` é populado corretamente quando todas as variáveis estão presentes
    - _Requirements: 11.1, 11.2_

  - [x] 11.2 Criar `tests/unit/lib/auth.test.ts`
    - Testar: token ausente → 401; formato inválido → 401; hash não encontrado → 401; `active = false` → 403; `expiresAt` no passado → 403; válido → sucesso + `lastUsedAt` atualizado; DB indisponível → 503
    - Testar `authenticateAdmin`: token correto → sucesso; token errado → 403; ausente → 401
    - _Requirements: 1.1–1.8, 2.1–2.4_

  - [x] 11.3 Criar `tests/unit/lib/rate-limit.test.ts`
    - Testar: exatamente 30 requisições → `allowed: true`; 31ª → `allowed: false`; nova janela → contador reiniciado
    - Verificar valores corretos de `remaining` e `resetAt`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 11.4 Criar `tests/unit/lib/mailer.test.ts`
    - Testar: envio bem-sucedido retorna `messageId`; timeout SMTP capturado como erro; configuração `multipart/alternative` quando `html` e `text` presentes
    - _Requirements: 4.1, 4.6, 4.12_

  - [x] 11.5 Criar `tests/unit/services/email.service.test.ts`
    - Testar: envio com sucesso → log `SENT` + `messageId`; falha SMTP → log `FAILED` + `errorMessage` sanitizado; timeout → log `FAILED`; `ipAddress` registrado; erro de DB no log não propaga para cliente
    - _Requirements: 4.7, 4.8, 4.9, 4.11, 4.12_

  - [x] 11.6 Criar `tests/unit/services/api-key.service.test.ts`
    - Testar: `createApiKey` gera 64 chars hex, persiste somente `keyHash`, retorna `key` em texto puro; `listApiKeys` não expõe `keyHash`; `revokeApiKey` seta `active = false`; `revokeApiKey` em key já inativa → idempotente; ID inexistente → `null`
    - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 6.9_

  - [x] 11.7 Criar `tests/unit/validators/email.validator.test.ts`
    - Testar: campos proibidos (`cc`, `bcc`, `from`, `attachments`) → erro com campo indicado; `replyTo` inválido → 422; ausência de `html` e `text` → erro; e-mail `to` > 254 chars → erro; `subject` vazio → erro
    - _Requirements: 4.2, 4.3, 4.5, 4.13_

  - [x] 11.8 Criar `tests/unit/validators/api-key.validator.test.ts`
    - Testar: `expiresAt` no passado → erro; `expiresAt` com formato inválido → erro; `name` vazio → erro; `name` > 100 chars → erro; `expiresAt` no futuro → válido
    - _Requirements: 6.4, 6.5_

- [x] 12. Testes property-based (fast-check)
  - [x] 12.1 Criar `tests/property/auth.property.test.ts`
    - **Property 1: Hash de API Key é determinístico e o valor em texto puro nunca é persistido**
    - Para qualquer `name` aleatório, verificar que `prismaMock.apiKey.create` recebeu `keyHash = sha256(result.key)` e que `keyHash !== result.key`
    - `numRuns: 100`; usar mock do Prisma
    - **Validates: Requirements 1.3, 1.9, 6.2**

  - [x] 12.2 Criar `tests/property/rate-limit.property.test.ts`
    - **Property 2: Rate limit respeita o limite máximo por janela e bloqueia excedentes**
    - Para qualquer `apiKeyId` (uuid) e N ∈ [1,29]: primeiras N chamadas → `allowed: true` com `remaining` decrescente; chamada N+31 → `allowed: false`
    - **Property 3: Janela de rate limit é reiniciada e contadores são isolados por API Key**
    - Para qualquer par (K1, K2) distintos: contador de K1 não influencia K2; após nova janela, contador reiniciado a zero
    - `numRuns: 100` por property; usar mock do Prisma
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

  - [x] 12.3 Criar `tests/property/email.property.test.ts`
    - **Property 4: Log de e-mail sempre reflete o resultado real do envio SMTP**
    - Para qualquer payload válido, mock SMTP sucesso → log `SENT` + `messageId`; mock SMTP falha → log `FAILED` + `errorMessage`; nunca estados intermediários
    - **Property 6: Campos proibidos no body são sempre rejeitados com HTTP 400**
    - Para qualquer subconjunto não vazio de `{from, cc, bcc, attachments}` combinado com campos válidos → sempre HTTP 400 com campo indicado
    - **Property 7: Validação de endereço de e-mail é consistente para `to` e `replyTo`**
    - Para qualquer string em `to` ou `replyTo`: aceitar ↔ é endereço válido com ≤ 254 chars; caso contrário → HTTP 422 com campo específico
    - `numRuns: 100` por property; usar mock do Prisma e Nodemailer
    - **Validates: Requirements 4.7, 4.8, 4.12, 4.5, 4.2, 4.3, 4.13**

  - [x] 12.4 Criar `tests/property/logs.property.test.ts`
    - **Property 5: Isolamento completo de logs entre API Keys distintas**
    - Para qualquer par (K1, K2) distintos e conjunto de logs criados por K1: busca por ID com K2 → 404; listagem com K2 → array vazio (mesmo comportamento de inexistente)
    - `numRuns: 100`; usar mock do Prisma
    - **Validates: Requirements 5.1, 5.6, 5.7**

  - [x] 12.5 Criar `tests/property/api-key.property.test.ts`
    - **Property 8: Revogação de API Key é idempotente**
    - Para qualquer ID existente e N ≥ 1 chamadas a `revokeApiKey(id)`: resultado sempre `active = false`; chamadas subsequentes não lançam erro
    - `numRuns: 100`; usar mock do Prisma
    - **Validates: Requirements 6.7, 6.9**

  - [x] 12.6 Criar `tests/property/security.property.test.ts`
    - **Property 9: Security headers obrigatórios presentes em todas as respostas**
    - Para qualquer endpoint e qualquer requisição (autenticada ou não, sucesso ou erro): resposta contém `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
    - **Property 10: Respostas de erro nunca expõem detalhes internos**
    - Para qualquer input que cause erro interno (DB falha, SMTP timeout, exceção): corpo da resposta não contém stack trace, caminhos de arquivo, mensagens internas do Node/Prisma/Nodemailer, nem valores de env vars sensíveis
    - `numRuns: 100`; usar mock do Prisma e Nodemailer
    - **Validates: Requirements 7.1, 7.2, 7.3, 8.3, 4.9, 7.8, 11.4**

- [x] 13. Checkpoint — todos os testes passando
  - Executar `npm run test:unit` e `npm run test:property` e garantir que todos os testes passam
  - Verificar cobertura: validators 100%, auth e rate-limit 95%, services 90%
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Documentação
  - [x] 14.1 Criar `README.md` na raiz do projeto
    - Documentar todos os endpoints (`/api/v1/email/send`, `/api/v1/email/logs`, `/api/v1/email/logs/:id`, `/api/v1/api-keys`, `/api/v1/api-keys/:id`, `/api/health`) com parâmetros, headers obrigatórios, exemplos de requisição/resposta para cada status HTTP possível
    - Documentar todas as variáveis de ambiente obrigatórias e opcionais com descrição, tipo e exemplo
    - Incluir instruções de instalação, configuração e execução local
    - Descrever restrições da V1 (sem anexos, CC, BCC, múltiplos destinatários)
    - Incluir seção de deploy na Hostinger (PM2, Nginx reverse proxy, limpeza de rate_limits)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

---

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para MVP mais rápido
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- Os checkpoints (10 e 13) garantem validação incremental antes de avançar para a próxima fase
- O design usa TypeScript/Next.js — nenhuma escolha adicional de linguagem foi necessária
- Os property tests usam `fast-check` com `numRuns: 100` e mocks do Prisma/Nodemailer para não depender de banco ou SMTP real
- Os testes de integração (não incluídos como tarefas de código aqui) requerem `TEST_DATABASE_URL` com banco MySQL separado
- A ordem das tarefas garante que nenhum módulo seja escrito antes de suas dependências

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.1", "3.2"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.5"] },
    { "id": 5, "tasks": ["4.3", "4.4"] },
    { "id": 6, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 7, "tasks": ["5.2"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7"] },
    { "id": 10, "tasks": ["9.1"] },
    { "id": 11, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 12, "tasks": ["11.5", "11.6", "11.7", "11.8"] },
    { "id": 13, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6"] },
    { "id": 14, "tasks": ["14.1"] }
  ]
}
```

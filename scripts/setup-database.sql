-- ============================================================
-- EMAIL API — Script de criação do banco de dados
-- Banco: u436946109_db_sendmail
-- Execute via phpMyAdmin ou MySQL CLI
-- ============================================================

-- Tabela de API Keys
CREATE TABLE IF NOT EXISTS `api_keys` (
    `id`         VARCHAR(191)  NOT NULL,
    `name`       VARCHAR(100)  NOT NULL,
    `keyHash`    CHAR(64)      NOT NULL,
    `active`     BOOLEAN       NOT NULL DEFAULT true,
    `createdAt`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3)   NULL,
    `expiresAt`  DATETIME(3)   NULL,

    UNIQUE INDEX `api_keys_keyHash_key` (`keyHash`),
    INDEX        `api_keys_active_idx` (`active`),
    PRIMARY KEY  (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tabela de logs de e-mail
CREATE TABLE IF NOT EXISTS `email_logs` (
    `id`           VARCHAR(191)            NOT NULL,
    `apiKeyId`     VARCHAR(191)            NOT NULL,
    `recipient`    VARCHAR(254)            NOT NULL,
    `subject`      VARCHAR(255)            NOT NULL,
    `status`       ENUM('SENT', 'FAILED')  NOT NULL,
    `messageId`    VARCHAR(255)            NULL,
    `ipAddress`    VARCHAR(45)             NOT NULL,
    `errorMessage` TEXT                    NULL,
    `createdAt`    DATETIME(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX       `email_logs_apiKeyId_createdAt_idx` (`apiKeyId`, `createdAt` DESC),
    INDEX       `email_logs_apiKeyId_id_idx`        (`apiKeyId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tabela de rate limiting
CREATE TABLE IF NOT EXISTS `rate_limits` (
    `apiKeyId`    VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3)  NOT NULL,
    `count`       INTEGER      NOT NULL DEFAULT 0,

    PRIMARY KEY (`apiKeyId`, `windowStart`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tabela de controle de migrations do Prisma
CREATE TABLE IF NOT EXISTS `_prisma_migrations` (
    `id`                  VARCHAR(36)   NOT NULL,
    `checksum`            VARCHAR(64)   NOT NULL,
    `finished_at`         DATETIME(3)   NULL,
    `migration_name`      VARCHAR(255)  NOT NULL,
    `logs`                TEXT          NULL,
    `rolled_back_at`      DATETIME(3)   NULL,
    `started_at`          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_steps_count` INTEGER       NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Chaves estrangeiras
ALTER TABLE `email_logs`
    ADD CONSTRAINT `email_logs_apiKeyId_fkey`
    FOREIGN KEY (`apiKeyId`) REFERENCES `api_keys`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rate_limits`
    ADD CONSTRAINT `rate_limits_apiKeyId_fkey`
    FOREIGN KEY (`apiKeyId`) REFERENCES `api_keys`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Registrar migration no Prisma para evitar re-execução
INSERT IGNORE INTO `_prisma_migrations`
    (`id`, `checksum`, `finished_at`, `migration_name`, `applied_steps_count`)
VALUES (
    UUID(),
    'manual-setup',
    NOW(),
    '20260810170017_init',
    1
);

-- ============================================================
-- Verificação final — deve mostrar as 4 tabelas criadas
-- ============================================================
SHOW TABLES;

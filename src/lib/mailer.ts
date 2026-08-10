import nodemailer from 'nodemailer'
import { config } from '@/src/lib/env'

export interface SendMailOptions {
  to: string
  subject: string
  html?: string
  text?: string
  replyTo?: string
  from?: string
}

export interface SendMailResult {
  messageId: string
}

// Singleton transporter — created once, reused across requests
let _transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter

  _transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 30_000,
  })

  return _transporter
}

/**
 * Send an email via SMTP.
 * The `from` address is always set from SMTP_FROM env var — never from the caller.
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const transporter = getTransporter()

  const info = await transporter.sendMail({
    from: options.from ?? config.smtp.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    replyTo: options.replyTo,
  })

  return { messageId: info.messageId }
}

/** Reset transporter singleton — used in tests */
export function _resetTransporter(): void {
  _transporter = null
}

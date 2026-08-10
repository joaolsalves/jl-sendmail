import { NextRequest } from 'next/server'

/**
 * Create a mock NextRequest for use in unit tests.
 */
export function createMockNextRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown
): NextRequest {
  const url = `http://localhost:3000${path}`
  const headersInit: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: headersInit,
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return new NextRequest(url, init)
}

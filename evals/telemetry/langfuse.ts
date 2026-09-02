import { Langfuse } from 'langfuse'
import {
  createLangfuseHandler as createBaseLangfuseHandler,
  flushTelemetry as flushBaseTelemetry,
  LangfuseCallbackHandler
} from '../../src/collaragent/telemetry/langfuse'
import type { CreateLangfuseHandlerOptions } from './types'

/**
 * Creates a Langfuse CallbackHandler for non-invasive LangChain/LangGraph execution tracing.
 * Returns undefined if environment credentials are not present (Zero-Lock-in / Fail-Safe Mode).
 */
export function createLangfuseHandler(
  options?: CreateLangfuseHandlerOptions
): LangfuseCallbackHandler | undefined {
  return createBaseLangfuseHandler(options)
}

/**
 * Creates a Langfuse SDK client instance if credentials are present.
 * Returns undefined if environment credentials are not present.
 */
export function createLangfuseClient(): Langfuse | undefined {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const baseUrl =
    process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST ?? 'http://localhost:3000'

  if (!publicKey || !secretKey) {
    return undefined
  }

  return new Langfuse({
    publicKey,
    secretKey,
    baseUrl
  })
}

/**
 * Flushes pending telemetry events to guarantee zero dropped traces in short-lived processes (CLI / Vitest).
 */
export async function flushTelemetry(client?: unknown): Promise<void> {
  await flushBaseTelemetry(client)
}

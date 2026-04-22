import { WebSocket } from 'ws'
import { config } from './config'
import { getDetectedGatewayToken } from './gateway-runtime'
import { logger } from './logger'

const GATEWAY_CLIENT_ID = 'openclaw-tui'
const GATEWAY_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
]

/**
 * Maps legacy CLI method names (underscore notation) to gateway RPC method names
 * (dot notation) and transforms params accordingly.
 */
function translateMethod(
  method: string,
  params: Record<string, unknown>,
): { rpcMethod: string; rpcParams: Record<string, unknown> } {
  // Rename sessionKey → key for all session operations
  const withKey = (p: Record<string, unknown>): Record<string, unknown> => {
    if ('sessionKey' in p) {
      const { sessionKey, ...rest } = p
      return { key: sessionKey, ...rest }
    }
    return p
  }

  switch (method) {
    case 'sessions_spawn': {
      // sessions.create only accepts: task, label, model, agentId — strip CLI-only fields
      const { runTimeoutSeconds: _rts, tools: _tools, ...createParams } = params as Record<string, unknown>
      logger.debug({ stripped: { runTimeoutSeconds: _rts, tools: _tools }, createParams }, 'translateMethod: sessions_spawn → sessions.create')
      return { rpcMethod: 'sessions.create', rpcParams: createParams }
    }

    case 'session_setThinking': {
      const { sessionKey, level, ...rest } = params as Record<string, unknown>
      return { rpcMethod: 'sessions.patch', rpcParams: { key: sessionKey, thinkingLevel: level, ...rest } }
    }
    case 'session_setVerbose': {
      const { sessionKey, level, ...rest } = params as Record<string, unknown>
      return { rpcMethod: 'sessions.patch', rpcParams: { key: sessionKey, verboseLevel: level, ...rest } }
    }
    case 'session_setReasoning': {
      const { sessionKey, level, ...rest } = params as Record<string, unknown>
      return { rpcMethod: 'sessions.patch', rpcParams: { key: sessionKey, reasoningLevel: level, ...rest } }
    }
    case 'session_setLabel': {
      const { sessionKey, label, ...rest } = params as Record<string, unknown>
      return { rpcMethod: 'sessions.patch', rpcParams: { key: sessionKey, label, ...rest } }
    }
    case 'session_delete':
      return { rpcMethod: 'sessions.delete', rpcParams: withKey(params) }
    case 'sessions_kill':
      return { rpcMethod: 'sessions.abort', rpcParams: withKey(params) }
    case 'sessions_send':
      return { rpcMethod: 'sessions.send', rpcParams: withKey(params) }

    default:
      // dot-notation methods (web.login.start, device.pair.*, channels.logout, etc.) pass through
      return { rpcMethod: method, rpcParams: params }
  }
}

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
): Promise<T> {
  const host = config.gatewayHost || '127.0.0.1'
  const port = config.gatewayPort || 18789
  const token = getDetectedGatewayToken()

  const protocol = (String(host).startsWith('wss://') || port === 443) ? 'wss' : 'ws'
  const gatewayUrl = `${protocol}://${host}:${port}`

  const { rpcMethod, rpcParams } = translateMethod(method, (params ?? {}) as Record<string, unknown>)

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate() } catch {}
      reject(new Error(`Gateway method ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const ws = new WebSocket(gatewayUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    })

    let connected = false

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'req',
        id: 'connect',
        method: 'connect',
        params: {
          auth: { token },
          client: { id: GATEWAY_CLIENT_ID, mode: 'backend', version: '1.0.0', platform: 'linux' },
          role: 'operator',
          minProtocol: 3,
          maxProtocol: 3,
          scopes: GATEWAY_SCOPES,
        },
      }))
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      const msgType = msg.type as string
      const msgEvent = msg.event as string | undefined

      // Skip challenge and health events
      if (msgType === 'event' && (msgEvent === 'connect.challenge' || msgEvent === 'health')) {
        return
      }

      if (msg.id === 'connect') {
        if (!msg.ok) {
          clearTimeout(timer)
          ws.terminate()
          reject(new Error(`Gateway connect failed: ${JSON.stringify(msg.error)}`))
          return
        }
        connected = true
        ws.send(JSON.stringify({ type: 'req', id: 'call', method: rpcMethod, params: rpcParams }))
        return
      }

      if (msg.id === 'call') {
        clearTimeout(timer)
        ws.terminate()
        if (!msg.ok) {
          const err = msg.error as Record<string, unknown> | undefined
          reject(new Error(
            err?.message
              ? String(err.message)
              : `Gateway method ${method} failed: ${JSON.stringify(msg.error)}`,
          ))
          return
        }
        resolve((msg.payload ?? msg.result ?? {}) as T)
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      if (connected) {
        try { ws.terminate() } catch {}
      }
      logger.warn({ err, method }, 'Gateway WebSocket error')
      reject(new Error(`Gateway connection error for ${method}: ${err.message}`))
    })

    ws.on('close', (code: number) => {
      clearTimeout(timer)
      // If we haven't resolved or rejected yet, the connection closed unexpectedly
      reject(new Error(`Gateway connection closed unexpectedly (code ${code}) for method ${method}`))
    })
  })
}

/**
 * Invoke a gateway agent and wait for its final response.
 * Equivalent to CLI `openclaw gateway call agent --expect-final`.
 */
export async function callGatewayAgent(
  params: {
    message: string
    agentId: string
    idempotencyKey: string
    deliver?: boolean
    model?: string
  },
  timeoutMs = 300_000,
): Promise<{ text: string | null; sessionId: string | null }> {
  const host = config.gatewayHost || '127.0.0.1'
  const port = config.gatewayPort || 18789
  const token = getDetectedGatewayToken()
  const protocol = port === 443 ? 'wss' : 'ws'
  const gatewayUrl = `${protocol}://${host}:${port}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate() } catch {}
      reject(new Error(`Gateway agent call timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const ws = new WebSocket(gatewayUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    })

    let step: 'connect' | 'agent' | 'wait' = 'connect'
    let runId: string | null = null

    const done = (result: { text: string | null; sessionId: string | null }) => {
      clearTimeout(timer)
      try { ws.terminate() } catch {}
      resolve(result)
    }
    const fail = (err: Error) => {
      clearTimeout(timer)
      try { ws.terminate() } catch {}
      reject(err)
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'req', id: 'connect', method: 'connect',
        params: {
          auth: { token },
          client: { id: GATEWAY_CLIENT_ID, mode: 'backend', version: '1.0.0', platform: 'linux' },
          role: 'operator', minProtocol: 3, maxProtocol: 3, scopes: GATEWAY_SCOPES,
        },
      }))
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'event') return // skip health, challenge, session events

      if (msg.id === 'connect') {
        if (!msg.ok) { fail(new Error(`Gateway connect failed: ${JSON.stringify(msg.error)}`)); return }
        step = 'agent'
        ws.send(JSON.stringify({ type: 'req', id: 'agent', method: 'agent', params }))
        return
      }

      if (msg.id === 'agent') {
        if (!msg.ok) { fail(new Error(`Gateway agent call failed: ${(msg.error as any)?.message ?? JSON.stringify(msg.error)}`)); return }
        const p = msg.payload as Record<string, unknown>
        runId = String(p.runId ?? '')
        if (!runId) { fail(new Error('Gateway agent returned no runId')); return }
        step = 'wait'
        ws.send(JSON.stringify({ type: 'req', id: 'wait', method: 'agent.wait', params: { runId, timeoutMs: timeoutMs - 5000 } }))
        return
      }

      if (msg.id === 'wait') {
        if (!msg.ok) { fail(new Error(`agent.wait failed: ${(msg.error as any)?.message ?? JSON.stringify(msg.error)}`)); return }
        const p = msg.payload as Record<string, unknown>
        logger.warn({ waitPayload: p }, 'callGatewayAgent: agent.wait raw payload')

        // Handle agent failure signalled in the payload itself
        if (p.error || (p as any).isError === true) {
          const errMsg = (p.error as any)?.message || JSON.stringify(p.error)
          fail(new Error(`Agent run failed: ${errMsg}`))
          return
        }

        const result = p.result as Record<string, unknown> | undefined
        const text: string | null =
          // Standard: result.payloads[0].text
          (result?.payloads as any)?.[0]?.text ??
          // Alt: result.output string
          (typeof result?.output === 'string' ? result.output : null) ??
          // Alt: result.text directly
          (typeof result?.text === 'string' ? result.text : null) ??
          // Alt: payloads at payload root level
          (p?.payloads as any)?.[0]?.text ??
          (typeof p?.output === 'string' ? p.output : null) ??
          (typeof p?.text === 'string' ? p.text : null) ??
          // Last resort: stringify result if present
          (result ? JSON.stringify(result) : null)
        const sessionId: string | null =
          typeof (result?.meta as any)?.agentMeta?.sessionId === 'string'
            ? (result!.meta as any).agentMeta.sessionId
            : typeof p.sessionId === 'string' ? p.sessionId : null
        done({ text, sessionId })
      }
    })

    ws.on('error', (err: Error) => {
      fail(new Error(`Gateway WebSocket error: ${err.message}`))
    })
    ws.on('close', (code: number) => {
      // Only fail if we haven't yet got a wait response
      if (step !== 'wait' || !runId) {
        fail(new Error(`Gateway closed unexpectedly (${code}) during ${step}`))
      } else {
        // If connection closed while waiting, the agent.wait may have timed out server-side
        fail(new Error(`Gateway closed while waiting for agent.wait response (runId=${runId})`))        
      }
    })
  })
}

/**
 * Call openclaw gateway via HTTP /v1/chat/completions (OpenAI-compatible).
 * Uses model "openclaw/<agentId>" to route to the correct agent.
 * This is the preferred method as it returns the LLM text directly.
 */
export async function callGatewayAgentHTTP(
  params: {
    message: string
    agentId: string
    model?: string
  },
  timeoutMs = 300_000,
): Promise<{ text: string | null; sessionId: string | null }> {
  const http = await import('http')
  const host = config.gatewayHost || '127.0.0.1'
  const port = config.gatewayPort || 18789
  const token = getDetectedGatewayToken()

  // openclaw chat completions model format: "openclaw/<agentId>"
  const ocModel = `openclaw/${params.agentId}`

  const body = JSON.stringify({
    model: ocModel,
    messages: [{ role: 'user', content: params.message }],
    stream: false,
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error(`Gateway HTTP chat completions timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const req = http.request(
      {
        hostname: host,
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk: Buffer) => { raw += chunk.toString() })
        res.on('end', () => {
          clearTimeout(timer)
          try {
            const parsed = JSON.parse(raw)
            if (parsed.error) {
              reject(new Error(`Gateway chat completions error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`))
              return
            }
            const text: string | null = parsed.choices?.[0]?.message?.content ?? null
            const sessionId: string | null = parsed.id ?? null
            logger.debug({ model: ocModel, statusCode: res.statusCode, textLen: text?.length }, 'callGatewayAgentHTTP: response received')
            resolve({ text, sessionId })
          } catch (e: any) {
            reject(new Error(`Gateway chat completions parse error: ${e.message} — body: ${raw.substring(0, 200)}`))
          }
        })
      },
    )

    req.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(new Error(`Gateway HTTP request error: ${err.message}`))
    })

    req.write(body)
    req.end()
  })
}

// Keep parseGatewayJsonOutput exported so existing tests that import it don't break
export function parseGatewayJsonOutput(raw: string): unknown | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const objectStart = trimmed.indexOf('{')
  const arrayStart = trimmed.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0
  let start = -1
  let end = -1
  if (hasObject && hasArray) {
    start = objectStart < arrayStart ? objectStart : arrayStart
    end = objectStart < arrayStart ? trimmed.lastIndexOf('}') : trimmed.lastIndexOf(']')
  } else if (hasObject) {
    start = objectStart; end = trimmed.lastIndexOf('}')
  } else if (hasArray) {
    start = arrayStart; end = trimmed.lastIndexOf(']')
  }
  if (start < 0 || end < start) return null
  try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { return null }
}

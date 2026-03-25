'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

interface RuntimeSetupModalProps {
  runtime: 'openclaw' | 'hermes'
  onClose: () => void
  onComplete: () => void
}

export function RuntimeSetupModal({ runtime, onClose, onComplete }: RuntimeSetupModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-card border border-border rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl shadow-black/30">
        {runtime === 'openclaw' ? (
          <OpenClawSetup onClose={onClose} onComplete={onComplete} />
        ) : (
          <HermesSetup onClose={onClose} onComplete={onComplete} />
        )}
      </div>
    </div>
  )
}

// ─── OpenClaw Setup ──────────────────────────────────────────────────────

function OpenClawSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'onboard' | 'verify' | 'done'>('onboard')
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [healthStatus, setHealthStatus] = useState<any>(null)

  const runOnboard = useCallback(async () => {
    setRunning(true)
    setError(null)
    setOutput('')
    try {
      const res = await fetch('/api/agent-runtimes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install', runtime: 'openclaw', mode: 'local' }),
      })
      // The onboard command runs as part of post-install in agent-runtimes.ts
      // Let's use the doctor endpoint to check health instead
      const doctorRes = await fetch('/api/openclaw/doctor')
      if (doctorRes.ok) {
        const data = await doctorRes.json()
        setHealthStatus(data)
        if (data.healthy) {
          setStep('done')
        } else {
          setStep('verify')
          setOutput(data.issues?.join('\n') || 'Some issues detected')
        }
      } else {
        setStep('verify')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setRunning(false)
    }
  }, [])

  const runDoctorFix = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/openclaw/doctor', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          setStep('done')
          setOutput('All issues resolved')
        } else {
          setOutput(data.output || 'Fix attempt completed with warnings')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doctor fix failed')
    } finally {
      setRunning(false)
    }
  }, [])

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/doctor')
      if (res.ok) {
        const data = await res.json()
        setHealthStatus(data)
        if (data.healthy) setStep('done')
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { checkHealth() }, [checkHealth])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up OpenClaw</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure the gateway and verify connectivity</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['onboard', 'verify', 'done'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              step === s ? 'bg-primary text-primary-foreground' :
              (['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/20 text-green-400' :
              'bg-secondary text-muted-foreground'
            }`}>
              {(['onboard', 'verify', 'done'].indexOf(step) > i) ? (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
              ) : i + 1}
            </div>
            {i < 2 && <div className={`w-8 h-px ${(['onboard', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/40' : 'bg-border/30'}`} />}
          </div>
        ))}
      </div>

      {step === 'onboard' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-lg">1</span>
              <div>
                <p className="text-sm font-medium">Health Check</p>
                <p className="text-xs text-muted-foreground">Run OpenClaw doctor to check gateway configuration and connectivity.</p>
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {healthStatus?.healthy && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
              OpenClaw is healthy and properly configured.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            <Button size="sm" onClick={runOnboard} disabled={running}>
              {running ? 'Checking...' : 'Run Health Check'}
            </Button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-2">
            <p className="text-sm font-medium text-amber-400">Issues Detected</p>
            {healthStatus?.issues?.map((issue: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground">- {issue}</p>
            ))}
            {output && <pre className="text-xs text-muted-foreground/70 whitespace-pre-wrap mt-2">{output}</pre>}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip for now</Button>
            <Button size="sm" onClick={runDoctorFix} disabled={running}>
              {running ? 'Fixing...' : 'Auto-Fix Issues'}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">OpenClaw is ready</p>
            <p className="text-xs text-muted-foreground">Gateway is configured and healthy. Agents can now connect.</p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Hermes Setup ────────────────────────────────────────────────────────

function HermesSetup({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState<'hook' | 'verify' | 'done'>('hook')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hermesStatus, setHermesStatus] = useState<any>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/hermes')
      if (res.ok) {
        const data = await res.json()
        setHermesStatus(data)
        if (data.hookInstalled) {
          setStep(data.gatewayRunning ? 'done' : 'verify')
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  const installHook = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/hermes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install-hook' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to install hook')
      }
      await fetchStatus()
      setStep('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install hook')
    } finally {
      setRunning(false)
    }
  }, [fetchStatus])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Set Up Hermes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Connect Hermes agent to Mission Control</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {(['hook', 'verify', 'done'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
              step === s ? 'bg-primary text-primary-foreground' :
              (['hook', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/20 text-green-400' :
              'bg-secondary text-muted-foreground'
            }`}>
              {(['hook', 'verify', 'done'].indexOf(step) > i) ? (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M3 8.5l3.5 3.5 6.5-8" /></svg>
              ) : i + 1}
            </div>
            {i < 2 && <div className={`w-8 h-px ${(['hook', 'verify', 'done'].indexOf(step) > i) ? 'bg-green-500/40' : 'bg-border/30'}`} />}
          </div>
        ))}
      </div>

      {step === 'hook' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <p className="text-sm font-medium">Install Mission Control Hook</p>
            <p className="text-xs text-muted-foreground">
              This installs a hook in <code className="text-[11px] bg-black/20 px-1 rounded">~/.hermes/hooks/mission-control/</code> that
              reports agent activity, session events, and status updates to Mission Control.
            </p>
            <div className="text-xs text-muted-foreground/60 space-y-1">
              <p>The hook will:</p>
              <ul className="list-disc list-inside pl-2 space-y-0.5">
                <li>Register Hermes agents automatically on start</li>
                <li>Report session lifecycle events</li>
                <li>Enable task dispatching from Mission Control</li>
              </ul>
            </div>
          </div>

          {hermesStatus && !hermesStatus.hookInstalled && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-400">
              Hook is not installed yet.
            </div>
          )}

          {hermesStatus?.hookInstalled && (
            <div className="p-3 rounded-lg border border-green-500/30 bg-green-500/5 text-xs text-green-400">
              Hook is already installed.
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Skip</Button>
            {hermesStatus?.hookInstalled ? (
              <Button size="sm" onClick={() => setStep('verify')}>Next</Button>
            ) : (
              <Button size="sm" onClick={installHook} disabled={running}>
                {running ? 'Installing...' : 'Install Hook'}
              </Button>
            )}
          </div>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-border/30 bg-secondary/20 space-y-3">
            <p className="text-sm font-medium">Verify Connection</p>
            <p className="text-xs text-muted-foreground">
              Check that Hermes can communicate with Mission Control.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatusCard label="Installed" ok={hermesStatus?.installed} />
            <StatusCard label="Hook Active" ok={hermesStatus?.hookInstalled} />
            <StatusCard label="Gateway Running" ok={hermesStatus?.gatewayRunning} />
            <StatusCard label="Sessions" value={hermesStatus?.activeSessions || 0} ok={true} />
          </div>

          <div className="p-3 rounded-lg border border-border/20 bg-secondary/10 text-xs text-muted-foreground space-y-1.5">
            <p className="font-medium text-foreground/80">Provider Configuration</p>
            <p>
              Hermes uses LLM providers configured via environment variables or its config file.
              Set up your provider keys in <code className="text-[11px] bg-black/20 px-1 rounded">~/.hermes/config.yaml</code> or via environment:
            </p>
            <div className="mt-2 bg-black/20 rounded p-2 font-mono text-[11px] space-y-0.5">
              <p><span className="text-muted-foreground/50">$</span> export ANTHROPIC_API_KEY=sk-ant-...</p>
              <p><span className="text-muted-foreground/50">$</span> export OPENAI_API_KEY=sk-...</p>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('hook')}>Back</Button>
            <Button size="sm" onClick={() => { fetchStatus(); setStep('done') }}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-500/5 text-center space-y-2">
            <div className="text-2xl">+</div>
            <p className="text-sm font-medium text-green-400">Hermes is connected</p>
            <p className="text-xs text-muted-foreground">
              Hook installed. Hermes agents will now report to Mission Control.
              {hermesStatus?.cronJobCount > 0 && ` ${hermesStatus.cronJobCount} cron jobs detected.`}
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={onComplete}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusCard({ label, ok, value }: { label: string; ok?: boolean; value?: number }) {
  return (
    <div className={`p-2.5 rounded-lg border text-xs ${
      ok ? 'border-green-500/20 bg-green-500/5' : 'border-border/20 bg-secondary/10'
    }`}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        {value !== undefined ? (
          <span className="font-mono text-foreground">{value}</span>
        ) : (
          <span className={ok ? 'text-green-400' : 'text-muted-foreground/40'}>
            {ok ? '+' : '-'}
          </span>
        )}
      </div>
    </div>
  )
}

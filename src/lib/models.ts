export interface ModelConfig {
  alias: string
  name: string
  provider: string
  description: string
  costPer1k: number
}

export const MODEL_CATALOG: ModelConfig[] = [
  // Anthropic
  { alias: 'haiku', name: 'anthropic/claude-haiku-4-5', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 0.25 },
  { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0 },
  { alias: 'opus', name: 'anthropic/claude-opus-4-6', provider: 'anthropic', description: 'Premium quality', costPer1k: 15.0 },
  // OpenAI
  { alias: 'gpt-4.1', name: 'openai/gpt-4.1', provider: 'openai', description: 'GPT-4.1 flagship', costPer1k: 2.0 },
  { alias: 'gpt-4.1-mini', name: 'openai/gpt-4.1-mini', provider: 'openai', description: 'GPT-4.1 Mini, fast + cheap', costPer1k: 0.4 },
  { alias: 'gpt-4.1-nano', name: 'openai/gpt-4.1-nano', provider: 'openai', description: 'GPT-4.1 Nano, ultra-fast', costPer1k: 0.1 },
  { alias: 'codex-mini', name: 'openai/codex-mini-latest', provider: 'openai', description: 'Codex Mini, optimized for code', costPer1k: 1.5 },
  // Google
  { alias: 'gemini-2.5-pro', name: 'google/gemini-2.5-pro', provider: 'google', description: 'Gemini 2.5 Pro', costPer1k: 1.25 },
  { alias: 'gemini-2.5-flash', name: 'google/gemini-2.5-flash', provider: 'google', description: 'Gemini 2.5 Flash, fast', costPer1k: 0.15 },
  // Local Ollama models (must match openclaw config whitelist)
  { alias: 'qwen7b', name: 'ollama/qwen2.5:7b', provider: 'ollama', description: 'Qwen 2.5 7B (local, fast)', costPer1k: 0.0 },
  { alias: 'qwen14b', name: 'ollama/qwen2.5:14b', provider: 'ollama', description: 'Qwen 2.5 14B (local, quality)', costPer1k: 0.0 },
  { alias: 'llama8b', name: 'ollama/llama3.1:8b', provider: 'ollama', description: 'Llama 3.1 8B (local)', costPer1k: 0.0 },
  { alias: 'mistral7b', name: 'ollama/mistral:7b', provider: 'ollama', description: 'Mistral 7B (local)', costPer1k: 0.0 },
  // Other providers
  { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1k: 1.0 },
  { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective, strong coding', costPer1k: 0.3 },
]

export function getModelByAlias(alias: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.alias === alias)
}

export function getModelByName(name: string): ModelConfig | undefined {
  return MODEL_CATALOG.find(m => m.name === name)
}

export function getAllModels(): ModelConfig[] {
  return [...MODEL_CATALOG]
}

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const REASONING_PLACEHOLDER_VALUES = new Set(['auto', 'none', 'concise', 'detailed', 'low', 'medium', 'high'])
function isReasoningPlaceholderValue(value: string) {
  const normalized = value.toLowerCase()
  return (
    REASONING_PLACEHOLDER_VALUES.has(normalized) ||
    /^(summary|reasoning|thinking)\s*:\s*(auto|none|concise|detailed|low|medium|high)$/i.test(value)
  )
}

export function normalizeReasoningText(value: unknown) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return ''
  if (isReasoningPlaceholderValue(text)) return ''
  return text
}

export function normalizeReasoningFragment(value: unknown) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n')
  if (!text) return ''
  const trimmed = text.trim()
  if (isReasoningPlaceholderValue(trimmed)) return ''
  return text
}

export function joinReasoningText(parts: Array<unknown>) {
  return normalizeReasoningText(parts.map((part) => normalizeReasoningFragment(part)).filter(Boolean).join(''))
}

export function pickBestReasoningText(...values: Array<unknown>) {
  for (const value of values) {
    const normalized = normalizeReasoningText(value)
    if (!normalized) continue
    return normalized
  }

  return ''
}

export function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { name?: unknown }
  return candidate.name === 'AbortError'
}

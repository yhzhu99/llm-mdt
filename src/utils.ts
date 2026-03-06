import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const REASONING_PLACEHOLDER_VALUES = new Set(['auto', 'none', 'concise', 'detailed', 'low', 'medium', 'high'])

export function normalizeReasoningText(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return ''

  const normalized = text.toLowerCase()
  if (REASONING_PLACEHOLDER_VALUES.has(normalized)) return ''
  if (/^(summary|reasoning|thinking)\s*:\s*(auto|none|concise|detailed|low|medium|high)$/i.test(text)) {
    return ''
  }

  return text
}

export function pickBestReasoningText(...values: Array<unknown>) {
  for (const value of values) {
    const normalized = normalizeReasoningText(value)
    if (!normalized) continue
    return normalized
  }

  return ''
}

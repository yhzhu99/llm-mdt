import type { ConversationSummary, ProviderSettings, RuntimeConfig } from '@/types'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const normalizeDateKey = (iso: string) => {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

const getRelativeLabel = (iso: string) => {
  const date = new Date(iso)
  const today = new Date()
  const todayKey = normalizeDateKey(today.toISOString())
  const targetKey = normalizeDateKey(iso)

  if (targetKey === todayKey) return 'Today'

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (targetKey === normalizeDateKey(yesterday.toISOString())) return 'Yesterday'

  return dateFormatter.format(date)
}

export function groupConversationsByDate(conversations: ConversationSummary[]) {
  const sorted = [...(conversations || [])].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )

  return sorted.reduce<Record<string, ConversationSummary[]>>((groups, conversation) => {
    const label = getRelativeLabel(conversation.created_at)
    if (!groups[label]) {
      groups[label] = []
    }
    groups[label]?.push(conversation)
    return groups
  }, {})
}

export function toRuntimeConfig(settings: ProviderSettings | null): RuntimeConfig {
  return {
    configured: Boolean(
      settings?.baseUrl &&
        settings?.apiKey &&
        settings?.chairmanModel &&
        Array.isArray(settings?.councilModels) &&
        settings.councilModels.length > 0,
    ),
    council_models: settings?.councilModels || [],
    chairman_model: settings?.chairmanModel || '',
    title_model: settings?.titleModel || settings?.chairmanModel || '',
    base_url: settings?.baseUrl || '',
  }
}

export function getProviderHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return ''
  }
}

export function getProviderStatusText(
  status: 'ready' | 'running' | 'error' | 'unconfigured',
  settings: ProviderSettings | null,
  errorMessage: string,
) {
  if (status === 'running') return 'Running MDT locally'
  if (status === 'error') return errorMessage || 'Provider error'
  if (status === 'ready') {
    const host = getProviderHost(settings?.baseUrl || '')
    return host ? `Ready · ${host}` : 'Ready'
  }
  return 'Configure local provider'
}

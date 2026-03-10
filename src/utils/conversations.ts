import { translate } from '@/i18n'
import type {
  AppLocale,
  ChatRunPreferences,
  ConversationSummary,
  MdtRunConfig,
  MdtTargetStage,
  ProviderSettings,
  RuntimeConfig,
} from '@/types'

const normalizeDateKey = (iso: string) => {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

const getRelativeLabel = (iso: string, locale: AppLocale) => {
  const date = new Date(iso)
  const today = new Date()
  const todayKey = normalizeDateKey(today.toISOString())
  const targetKey = normalizeDateKey(iso)
  const dateFormatter = new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  if (targetKey === todayKey) return translate(locale, 'dateToday')

  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (targetKey === normalizeDateKey(yesterday.toISOString())) return translate(locale, 'dateYesterday')

  return dateFormatter.format(date)
}

const uniqueModels = (models: string[]) => [...new Set((models || []).map((model) => String(model || '').trim()).filter(Boolean))]

const stageRank: Record<MdtTargetStage, number> = {
  stage1: 1,
  stage2: 2,
  stage3: 3,
}

export function normalizeTargetStage(value: unknown): MdtTargetStage {
  return value === 'stage1' || value === 'stage2' ? value : 'stage3'
}

export function reconcileSelectedCouncilModels(selectedModels: string[] | null | undefined, availableModels: string[]) {
  const available = uniqueModels(availableModels || [])
  if (available.length === 0) return []
  if (selectedModels == null) return available

  const availableSet = new Set(available)
  const selected = uniqueModels(selectedModels).filter((model) => availableSet.has(model))
  return selected.length > 0 ? selected : available
}

export function reconcileChatRunPreferences(
  input: Partial<ChatRunPreferences> | null | undefined,
  availableModels: string[],
): ChatRunPreferences {
  return {
    targetStage: normalizeTargetStage(input?.targetStage),
    selectedCouncilModels: reconcileSelectedCouncilModels(input?.selectedCouncilModels, availableModels),
  }
}

export function createRunConfig(
  settings: Pick<ProviderSettings, 'councilModels' | 'chairmanModel'> | null | undefined,
  input?: Partial<ChatRunPreferences> | Partial<MdtRunConfig> | null,
): MdtRunConfig {
  if (input && 'councilModels' in input) {
    return {
      targetStage: normalizeTargetStage(input.targetStage),
      councilModels: uniqueModels(input.councilModels || []),
      chairmanModel: String(input.chairmanModel || settings?.chairmanModel || '').trim(),
    }
  }

  const availableModels = uniqueModels(settings?.councilModels || [])
  const reconciled = reconcileChatRunPreferences(
    {
      targetStage: input?.targetStage,
      selectedCouncilModels:
        input && 'selectedCouncilModels' in input ? input.selectedCouncilModels ?? availableModels : availableModels,
    },
    availableModels,
  )

  return {
    targetStage: reconciled.targetStage,
    councilModels: reconciled.selectedCouncilModels,
    chairmanModel: String(settings?.chairmanModel || '').trim(),
  }
}

export function stageIncludes(targetStage: MdtTargetStage, stage: MdtTargetStage) {
  return stageRank[stage] <= stageRank[targetStage]
}

export function groupConversationsByDate(conversations: ConversationSummary[], locale: AppLocale) {
  const sorted = [...(conversations || [])].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  )

  return sorted.reduce<Record<string, ConversationSummary[]>>((groups, conversation) => {
    const label = getRelativeLabel(conversation.created_at, locale)
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
    request_mode: settings?.requestMode || 'auto',
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
  locale: AppLocale,
) {
  if (status === 'running') return translate(locale, 'statusRunning')
  if (status === 'error') return errorMessage || translate(locale, 'statusProviderError')
  if (status === 'ready') {
    const host = getProviderHost(settings?.baseUrl || '')
    return host
      ? translate(locale, 'statusReadyHost', { host })
      : translate(locale, 'statusReady')
  }
  return translate(locale, 'statusConfigureProvider')
}

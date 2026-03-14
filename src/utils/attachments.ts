import type {
  AppLocale,
  ChatCompletionContentPart,
  UserAttachment,
  UserInputPayload,
} from '@/types'

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
])
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'ndjson',
  'log',
  'yaml',
  'yml',
  'xml',
])

export const ATTACHMENT_INPUT_ACCEPT = [
  ...SUPPORTED_IMAGE_MIME_TYPES,
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/x-ndjson',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.ndjson',
  '.log',
  '.yaml',
  '.yml',
  '.xml',
].join(',')

function createId(prefix = 'attachment') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getFileExtension(name: string) {
  const parts = String(name || '').trim().toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() || '' : ''
}

function inferMimeType(name: string, mimeType: string) {
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase()
  if (normalizedMimeType) return normalizedMimeType

  const extension = getFileExtension(name)
  if (extension === 'md' || extension === 'markdown') return 'text/markdown'
  if (extension === 'csv') return 'text/csv'
  if (extension === 'json' || extension === 'ndjson') return 'application/json'
  if (extension === 'yaml' || extension === 'yml' || extension === 'xml' || extension === 'txt' || extension === 'log') {
    return 'text/plain'
  }

  return ''
}

function isTextLikeMimeType(name: string, mimeType: string) {
  const normalizedMimeType = inferMimeType(name, mimeType)
  if (!normalizedMimeType) return false
  return normalizedMimeType.startsWith('text/') || SUPPORTED_TEXT_MIME_TYPES.has(normalizedMimeType)
}

function isSupportedFile(name: string, mimeType: string) {
  const normalizedMimeType = inferMimeType(name, mimeType)
  if (SUPPORTED_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return true
  }

  if (normalizedMimeType === 'application/pdf') {
    return true
  }

  if (isTextLikeMimeType(name, normalizedMimeType)) {
    return true
  }

  return SUPPORTED_TEXT_EXTENSIONS.has(getFileExtension(name))
}

function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function readFileAsText(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function normalizeAttachment(input: Partial<UserAttachment> | null | undefined): UserAttachment | null {
  if (!input || typeof input !== 'object') return null

  const mimeType = inferMimeType(String(input.name || ''), String(input.mimeType || ''))
  const kind = input.kind === 'image' || mimeType.startsWith('image/') ? 'image' : 'file'
  const dataUrl = String(input.dataUrl || '').trim()
  if (!dataUrl) return null

  return {
    id: String(input.id || createId()),
    kind,
    name: String(input.name || '').trim() || 'attachment',
    mimeType,
    size: Number.isFinite(input.size) ? Number(input.size) : 0,
    dataUrl,
    textContent: input.textContent == null ? null : String(input.textContent),
  }
}

export function createEmptyUserInput(): UserInputPayload {
  return {
    text: '',
    attachments: [],
  }
}

export function normalizeUserInputPayload(input: unknown): UserInputPayload {
  if (typeof input === 'string') {
    return {
      text: input,
      attachments: [],
    }
  }

  if (!input || typeof input !== 'object') {
    return createEmptyUserInput()
  }

  const record = input as Record<string, unknown>
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map((attachment) => normalizeAttachment(attachment as UserAttachment)).filter(Boolean)
    : []

  return {
    text: String(record.text ?? record.content ?? ''),
    attachments: attachments as UserAttachment[],
  }
}

export function cloneUserInputPayload(input: unknown): UserInputPayload {
  const normalized = normalizeUserInputPayload(input)

  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(normalized)
  }

  return JSON.parse(JSON.stringify(normalized)) as UserInputPayload
}

export function hasUserInputContent(input: unknown) {
  const normalized = normalizeUserInputPayload(input)
  return Boolean(normalized.text.trim()) || normalized.attachments.length > 0
}

export function hasUserInputAttachments(input: unknown) {
  return normalizeUserInputPayload(input).attachments.length > 0
}

export function isImageAttachment(attachment: UserAttachment) {
  return attachment.kind === 'image'
}

export function isPdfAttachment(attachment: UserAttachment) {
  return attachment.mimeType === 'application/pdf'
}

export function isTextAttachment(attachment: UserAttachment) {
  return !isImageAttachment(attachment) && !isPdfAttachment(attachment)
}

export function isDeepSeekModel(model: string) {
  return String(model || '').trim().toLowerCase().includes('deepseek')
}

export function hasDeepSeekModel(models: string[]) {
  return (models || []).some((model) => isDeepSeekModel(model))
}

export function buildAttachmentConstraintMessage(locale: AppLocale, modelCount: number) {
  if (locale === 'zh-CN') {
    return modelCount > 1
      ? '当前选择中包含 DeepSeek。DeepSeek 仅支持文本输入，请移除 DeepSeek 后再上传图片或文件。'
      : 'DeepSeek 仅支持文本输入，请移除图片或文件后再发送。'
  }

  return modelCount > 1
    ? 'The current selection includes DeepSeek. DeepSeek only supports text input, so remove DeepSeek before sending images or files.'
    : 'DeepSeek only supports text input. Remove the attached images or files before sending.'
}

export function getAttachmentValidationMessage(input: UserInputPayload, models: string[], locale: AppLocale) {
  if (!hasUserInputAttachments(input)) return ''
  if (!hasDeepSeekModel(models)) return ''
  return buildAttachmentConstraintMessage(locale, models.length)
}

export function summarizeAttachments(attachments: UserAttachment[], locale: AppLocale) {
  if (!attachments.length) return ''
  const names = attachments.map((attachment) => attachment.name).join(', ')

  if (locale === 'zh-CN') {
    return `附件：${names}`
  }

  return `Attachments: ${names}`
}

export function summarizeUserInputForTitle(input: UserInputPayload, locale: AppLocale) {
  const normalized = normalizeUserInputPayload(input)
  const text = normalized.text.trim()
  const attachmentSummary = summarizeAttachments(normalized.attachments, locale)

  if (text && attachmentSummary) {
    return `${text}\n${attachmentSummary}`
  }

  if (text) return text
  if (attachmentSummary) return attachmentSummary

  return locale === 'zh-CN' ? '附件会诊' : 'Attachment review'
}

export function serializeUserInputForClipboard(input: UserInputPayload, locale: AppLocale) {
  const normalized = normalizeUserInputPayload(input)
  const sections = [normalized.text.trim()].filter(Boolean)
  const attachmentSummary = summarizeAttachments(normalized.attachments, locale)
  if (attachmentSummary) {
    sections.push(attachmentSummary)
  }

  return sections.join('\n\n').trim()
}

export function buildChatCompletionContentParts(
  text: string,
  attachments: UserAttachment[] = [],
): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = []
  const trimmedText = String(text || '').trim()

  if (trimmedText) {
    parts.push({
      type: 'text',
      text: trimmedText,
    })
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      parts.push({
        type: 'image',
        imageUrl: attachment.dataUrl,
        mimeType: attachment.mimeType,
        name: attachment.name,
      })
      continue
    }

    parts.push({
      type: 'file',
      fileName: attachment.name,
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      textContent: attachment.textContent || null,
    })
  }

  return parts
}

export async function readFilesAsAttachments(files: File[]) {
  const accepted: UserAttachment[] = []
  const rejected: string[] = []

  for (const file of files || []) {
    const name = String(file.name || '').trim() || 'attachment'
    const mimeType = inferMimeType(name, file.type)

    if (!isSupportedFile(name, mimeType)) {
      rejected.push(name)
      continue
    }

    const dataUrl = await readFileAsDataUrl(file)
    const attachment: UserAttachment = {
      id: createId(),
      kind: mimeType.startsWith('image/') ? 'image' : 'file',
      name,
      mimeType,
      size: file.size || 0,
      dataUrl,
      textContent: null,
    }

    if (isTextLikeMimeType(name, mimeType) || SUPPORTED_TEXT_EXTENSIONS.has(getFileExtension(name))) {
      attachment.textContent = await readFileAsText(file)
    }

    accepted.push(attachment)
  }

  return {
    accepted,
    rejected,
  }
}

import DOMPurify from 'dompurify'
import katex from 'katex'
import { Marked, Renderer, type TokenizerAndRendererExtension, type Tokens } from 'marked'
import markedKatex from 'marked-katex-extension'

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  yml: 'yaml',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  vue3: 'vue',
  html5: 'html',
  md: 'markdown',
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const normalizeLanguage = (lang?: string): string | null => {
  const raw = (lang || '').trim().toLowerCase()
  if (!raw) return null
  return LANGUAGE_ALIASES[raw] || raw
}

const INLINE_PAREN_MATH_RULE = /^\\\(((?:\\.|[^\\\n])+?)\\\)/
const INLINE_BRACKET_MATH_RULE = /^\\\[(([^\n\\]|\\.)+?)\\\]/
const BLOCK_BRACKET_MATH_RULE = /^\\\[(?:[ \t]*\n)?([\s\S]+?)(?:\n[ \t]*)?\\\](?:\n|$)/

const findMathDelimiter = (src: string, delimiter: string) => {
  const index = src.indexOf(delimiter)
  return index >= 0 ? index : undefined
}

const renderMathToken = (token: Tokens.Generic, displayMode: boolean, trailingNewline = false) => {
  const html = katex.renderToString(String(token.text || ''), {
    throwOnError: false,
    displayMode,
  })

  return trailingNewline ? `${html}\n` : html
}

const inlineParenMathExtension: TokenizerAndRendererExtension = {
  name: 'inlineParenMath',
  level: 'inline',
  start(src) {
    return findMathDelimiter(src, '\\(')
  },
  tokenizer(src) {
    const match = src.match(INLINE_PAREN_MATH_RULE)
    if (!match) return undefined

    return {
      type: 'inlineParenMath',
      raw: match[0],
      text: match[1],
    }
  },
  renderer(token) {
    return renderMathToken(token, false)
  },
}

const inlineBracketMathExtension: TokenizerAndRendererExtension = {
  name: 'inlineBracketMath',
  level: 'inline',
  start(src) {
    return findMathDelimiter(src, '\\[')
  },
  tokenizer(src) {
    const match = src.match(INLINE_BRACKET_MATH_RULE)
    if (!match) return undefined

    return {
      type: 'inlineBracketMath',
      raw: match[0],
      text: match[1],
    }
  },
  renderer(token) {
    return renderMathToken(token, true)
  },
}

const blockBracketMathExtension: TokenizerAndRendererExtension = {
  name: 'blockBracketMath',
  level: 'block',
  start(src) {
    return findMathDelimiter(src, '\\[')
  },
  tokenizer(src) {
    const match = src.match(BLOCK_BRACKET_MATH_RULE)
    if (!match) return undefined

    return {
      type: 'blockBracketMath',
      raw: match[0],
      text: match[1],
    }
  },
  renderer(token) {
    return renderMathToken(token, true, true)
  },
}

const createRenderer = ({
  codeLabel,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
}: {
  codeLabel: string
  copyLabel: string
  copiedLabel: string
  copyFailedLabel: string
}) => {
  const renderer = new Renderer()
  renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
    const normalizedLang = normalizeLanguage(lang)
    const encodedCode = encodeURIComponent(text)

    return `
      <div class="md-codeblock not-prose overflow-hidden rounded-xl border border-border/80 bg-muted/40">
        <div class="flex items-center justify-between gap-3 border-b border-border/80 bg-muted/70 px-3 py-2">
          <span class="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">${escapeHtml(normalizedLang || codeLabel)}</span>
          <span class="copy-feedback-anchor shrink-0">
            <button
              type="button"
              class="copy-trigger md-copy-trigger"
              data-copy-code="${encodedCode}"
              data-copy-success="${copiedLabel}"
              data-copy-error="${copyFailedLabel}"
              data-copy-state="idle"
            >
              ${copyLabel}
            </button>
            <span class="copy-feedback-badge" data-copy-feedback data-visible="false" data-state="idle" role="status" aria-live="polite"></span>
          </span>
        </div>
        <pre class="overflow-x-auto bg-transparent p-4 text-sm leading-6 text-foreground"><code>${escapeHtml(text)}</code></pre>
      </div>
    `
  }

  return renderer
}

const rewriteExternalLinks = (html: string) =>
  html.replace(
    /<a(\s[^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi,
    (_match, before, href, after) =>
      `<a${before}href="${href}"${after} target="_blank" rel="noreferrer noopener">`,
  )

export const parseMarkdown = (
  content: string,
  labels: {
    code?: string
    copy?: string
    copied?: string
    copyFailed?: string
  } = {},
) => {
  if (!content) return ''
  const codeLabel = escapeHtml(labels.code || 'code')
  const copyLabel = escapeHtml(labels.copy || 'Copy')
  const copiedLabel = escapeHtml(labels.copied || 'Copied')
  const copyFailedLabel = escapeHtml(labels.copyFailed || 'Copy failed')
  const markdownParser = new Marked({
    gfm: true,
    breaks: true,
    renderer: createRenderer({
      codeLabel,
      copyLabel,
      copiedLabel,
      copyFailedLabel,
    }),
  })

  markdownParser.use({
    extensions: [
      blockBracketMathExtension,
      inlineBracketMathExtension,
      inlineParenMathExtension,
    ],
  })

  markdownParser.use(
    markedKatex({
      throwOnError: false,
      nonStandard: true,
    }),
  )

  return markdownParser.parse(content) as string
}

export const sanitizeMarkdownHtml = (html: string) => {
  if (!html) return ''
  return DOMPurify.sanitize(rewriteExternalLinks(html), {
    ADD_ATTR: [
      'target',
      'rel',
      'style',
      'data-copy-code',
      'data-copy-success',
      'data-copy-error',
      'data-copy-state',
      'data-copy-feedback',
      'data-visible',
    ],
  })
}

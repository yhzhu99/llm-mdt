import DOMPurify from 'dompurify'
import { Marked, Renderer } from 'marked'
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

const renderer = new Renderer()
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const normalizedLang = normalizeLanguage(lang)
  const encodedCode = encodeURIComponent(text)

  return `
    <div class="md-codeblock not-prose overflow-hidden rounded-xl border border-border/80 bg-muted/40">
      <div class="flex items-center justify-between gap-3 border-b border-border/80 bg-muted/70 px-3 py-2">
        <span class="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">${escapeHtml(normalizedLang || 'code')}</span>
        <button type="button" class="md-copy-trigger inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground" data-copy-code="${encodedCode}">
          Copy
        </button>
      </div>
      <pre class="overflow-x-auto bg-transparent p-4 text-sm leading-6 text-foreground"><code>${escapeHtml(text)}</code></pre>
    </div>
  `
}

const markdownParser = new Marked({
  gfm: true,
  breaks: true,
  renderer,
})

markdownParser.use(
  markedKatex({
    throwOnError: false,
    nonStandard: true,
  }),
)

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
  } = {},
) => {
  if (!content) return ''
  const codeLabel = escapeHtml(labels.code || 'code')
  const copyLabel = escapeHtml(labels.copy || 'Copy')
  renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
    const normalizedLang = normalizeLanguage(lang)
    const encodedCode = encodeURIComponent(text)

    return `
      <div class="md-codeblock not-prose overflow-hidden rounded-xl border border-border/80 bg-muted/40">
        <div class="flex items-center justify-between gap-3 border-b border-border/80 bg-muted/70 px-3 py-2">
          <span class="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">${escapeHtml(normalizedLang || codeLabel)}</span>
          <button type="button" class="md-copy-trigger inline-flex items-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground" data-copy-code="${encodedCode}">
            ${copyLabel}
          </button>
        </div>
        <pre class="overflow-x-auto bg-transparent p-4 text-sm leading-6 text-foreground"><code>${escapeHtml(text)}</code></pre>
      </div>
    `
  }
  return markdownParser.parse(content) as string
}

export const sanitizeMarkdownHtml = (html: string) => {
  if (!html) return ''
  return DOMPurify.sanitize(rewriteExternalLinks(html), {
    ADD_ATTR: ['target', 'rel', 'style', 'data-copy-code'],
  })
}

import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '@/utils/markdown'

describe('parseMarkdown latex delimiters', () => {
  it('renders inline math delimited by \\( and \\)', () => {
    const html = parseMarkdown('勾股定理：\\(a^2 + b^2 = c^2\\)。')

    expect(html).toContain('class="katex"')
    expect(html).toContain('application/x-tex">a^2 + b^2 = c^2<')
    expect(html).not.toContain('\\(a^2 + b^2 = c^2\\)')
  })

  it('renders display math delimited by \\[ and \\]', () => {
    const html = parseMarkdown('\\[\na^2 + b^2 = c^2\n\\]')

    expect(html).toContain('class="katex-display"')
    expect(html).toContain('application/x-tex">a^2 + b^2 = c^2<')
  })

  it('renders single-line display math inside paragraphs', () => {
    const html = parseMarkdown('Before \\[a^2 + b^2 = c^2\\] after')

    expect(html).toContain('Before')
    expect(html).toContain('after')
    expect(html).toContain('class="katex-display"')
  })

  it('does not transform inline code math delimiters', () => {
    const html = parseMarkdown('`\\(a^2 + b^2 = c^2\\)`')

    expect(html).toContain('<code>\\(a^2 + b^2 = c^2\\)</code>')
    expect(html).not.toContain('class="katex"')
  })

  it('does not transform fenced code block math delimiters', () => {
    const html = parseMarkdown('```tex\n\\[\na^2 + b^2 = c^2\n\\]\n```')

    expect(html).toContain('\\[\na^2 + b^2 = c^2\n\\]')
    expect(html).not.toContain('class="katex"')
  })

  it('leaves unclosed delimiters as plain text', () => {
    const html = parseMarkdown('未闭合公式：\\(a^2 + b^2 = c^2')

    expect(html).toContain('(a^2 + b^2 = c^2')
    expect(html).not.toContain('class="katex"')
  })
})

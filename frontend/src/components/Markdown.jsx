import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CopyButton from './CopyButton';
import './Markdown.css';

function normalizeLanguage(className) {
  const match = /language-(\S+)/.exec(className || '');
  return match?.[1] || '';
}

export default function Markdown({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        code({ className, children: codeChildren, inline, ...props }) {
          const code = String(codeChildren ?? '');

          if (inline) {
            return (
              <code className={className} {...props}>
                {code}
              </code>
            );
          }

          const language = normalizeLanguage(className);
          const copyText = code.replace(/\n$/, '');
          return (
            <div className="md-codeblock">
              <div className="md-codeblock__header">
                <div className="md-codeblock__lang">{language || 'code'}</div>
                <CopyButton
                  className="md-codeblock__copy"
                  label="Copy code"
                  successLabel="Copied"
                  getText={() => copyText}
                />
              </div>
              <pre className="md-codeblock__pre">
                <code className={className} {...props}>
                  {code}
                </code>
              </pre>
            </div>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}


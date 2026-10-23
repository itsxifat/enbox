/**
 * A fenced code block's `<code>`: highlighted for the languages of highlight.ts, plain text
 * until highlight.js and the language have loaded (never blocking the row). Colours for the
 * light and dark themes: codeTheme.css.
 */
import { memo, useEffect, useState } from 'react';
import { codeLanguage, highlightNow, loadLanguage, type CodeToken } from './highlight';
import './codeTheme.css';

function Tokens({ tokens }: { tokens: CodeToken[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        typeof t === 'string' ? (
          t
        ) : (
          <span key={i} className={t.cls}>
            <Tokens tokens={t.children} />
          </span>
        ),
      )}
    </>
  );
}

export const HighlightedCode = memo(function HighlightedCode({
  code,
  lang,
}: {
  code: string;
  /** The block's tag (```ts): highlighted when it names a language we know. */
  lang: string | null;
}) {
  const language = codeLanguage(lang);
  // Cached once the language is in: rows the list re-mounts highlight at once.
  const tokens = language ? highlightNow(code, language) : null;
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!language || tokens) return;
    let live = true;
    loadLanguage(language)
      .then(() => {
        if (live) setLoaded((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [language, tokens]);
  return (
    <code className="msg-code" data-language={tokens ? language! : undefined}>
      {tokens ? <Tokens tokens={tokens} /> : code}
    </code>
  );
});

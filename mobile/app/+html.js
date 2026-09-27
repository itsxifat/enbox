/**
 * The web preview's HTML shell (expo-router): the standard reset plus no browser focus
 * outline on text fields (the fields draw their own focus ring, as in the Android app).
 */
import { ScrollViewStyleReset } from 'expo-router/html';

const css = `input, textarea { outline: none; }`;

export default function Root({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

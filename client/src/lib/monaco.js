// Import the editor core only — NOT the `monaco-editor` barrel, which drags in
// all ~90 language definitions and their web workers (several megabytes).
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Syntax highlighting for exactly the languages this platform allows.
// `cpp.contribution` registers both `c` and `cpp`.
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution';

/**
 * Bundle Monaco with the app instead of pulling it from a CDN at runtime.
 *
 * An exam must not fail because a college network blocks or throttles jsdelivr.
 * Once the page has loaded, the editor is guaranteed to be available.
 */

// The languages above are tokenizer-only, so the base worker is all that is
// needed — the TS/JSON/CSS/HTML language services are deliberately left out.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

export default monaco;

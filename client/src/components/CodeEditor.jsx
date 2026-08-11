import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import '../lib/monaco.js'; // bundles Monaco locally — no CDN fetch at runtime

/**
 * Monaco wrapper used both for solving (editable, paste-reporting) and for the
 * teacher's submission viewer (read-only).
 */
export default function CodeEditor({
  value,
  onChange,
  language = 'python',
  readOnly = false,
  onPaste,
  height = '100%',
  minimap = false,
}) {
  const editorRef = useRef(null);
  const onPasteRef = useRef(onPaste);
  const [theme, setTheme] = useState('vs');

  useEffect(() => {
    onPasteRef.current = onPaste;
  }, [onPaste]);

  // Follow the page's light/dark theme.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      const dark = attr ? attr === 'dark' : mq.matches;
      setTheme(dark ? 'vs-dark' : 'vs');
    };
    resolve();
    mq.addEventListener('change', resolve);
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', resolve);
      observer.disconnect();
    };
  }, []);

  const handleMount = (editor, monaco) => {
    editorRef.current = editor;

    if (onPasteRef.current) {
      // Monaco fires this for every paste into the model — the size of the
      // pasted range is the cheating signal we care about (§9).
      editor.onDidPaste((e) => {
        const model = editor.getModel();
        if (!model) return;
        const text = model.getValueInRange(e.range);
        onPasteRef.current?.(text);
      });
    }

    if (!readOnly) {
      // Ctrl/Cmd+S should save the draft, not open the browser's save dialog.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {});
    }
  };

  return (
    <Editor
      height={height}
      language={language}
      theme={theme}
      value={value}
      onChange={readOnly ? undefined : (v) => onChange?.(v ?? '')}
      onMount={handleMount}
      loading={
        <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
          Loading editor…
        </div>
      }
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: minimap },
        fontSize: 14,
        fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        renderWhitespace: 'selection',
        smoothScrolling: true,
        padding: { top: 12, bottom: 12 },
        contextmenu: false,
        quickSuggestions: !readOnly,
        wordWrap: 'on',
      }}
    />
  );
}

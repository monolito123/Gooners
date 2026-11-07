/** CodeMirror 6 editor for generated HTML; follows streamed content and reports manual edits. */
import { html } from '@codemirror/lang-html';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: '#070a11' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
    '.cm-gutters': { backgroundColor: '#090c14', borderRight: '1px solid #182030', color: '#5b6884' },
    '.cm-activeLine': { backgroundColor: 'rgb(34 230 255 / 0.05)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgb(34 230 255 / 0.08)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#22e6ff' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgb(255 43 214 / 0.25) !important' },
  },
  { dark: true },
);

export default function CodeEditor({ value, onChange, readOnly, follow }: { value: string; onChange: (value: string) => void; readOnly?: boolean; follow?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const editable = useRef(new Compartment());
  const external = useRef(false);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          html(),
          oneDark,
          theme,
          EditorView.lineWrapping,
          editable.current.of([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !external.current) changeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is created once; value/readOnly changes are applied below.
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const current = v.state.doc.toString();
    if (current === value) return;
    external.current = true;
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    external.current = false;
    if (follow) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.length, { y: 'end' }) });
  }, [value, follow]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

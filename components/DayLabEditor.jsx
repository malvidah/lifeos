'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Suggestion } from '@tiptap/suggestion';

// ── Constants (kept in sync with Dashboard.jsx) ───────────────────────────────
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const F = { lg: 18, md: 15, sm: 12 };

const PROJECT_PALETTE = [
  '#C17B4A', '#7A9E6E', '#6B8EB8', '#A07AB0',
  '#B08050', '#5E9E8A', '#B06878', '#8A8A50',
];
function projectColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// Inject ProseMirror base styles once
function injectEditorStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('daylab-editor-styles')) return;
  const s = document.createElement('style');
  s.id = 'daylab-editor-styles';
  s.textContent = `
    .dl-editor .ProseMirror { outline: none; white-space: pre-wrap; word-break: break-word; min-height: 1.7em; }
    .dl-editor .ProseMirror p { margin: 0; padding: 0; }
    .dl-editor .ProseMirror p.is-empty:first-child::before { content: attr(data-placeholder); pointer-events: none; float: left; height: 0; color: var(--dl-muted); }
    .dl-editor .ProseMirror-selectednode img { outline: 2px solid #D08828; border-radius: 8px; }
  `;
  document.head.appendChild(s);
}

// ── HashTag decoration plugin ─────────────────────────────────────────────────
const HashTagExtension = Extension.create({
  name: 'hashtag',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('hashtag'),
      props: {
        decorations(state) {
          const decos = [];
          const re = /#([A-Za-z][A-Za-z0-9]+)/g;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            let m; re.lastIndex = 0;
            while ((m = re.exec(node.text)) !== null) {
              const col = projectColor(m[1]);
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                style: `color:${col};background:${col}20;border:1px solid ${col}40;border-radius:4px;padding:0 5px;font-family:${mono};font-size:0.82em;line-height:1.6;vertical-align:middle;display:inline-block`,
              }));
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// ── URL decoration plugin ─────────────────────────────────────────────────────
const URLExtension = Extension.create({
  name: 'urlDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('urlDecoration'),
      props: {
        decorations(state) {
          const decos = [];
          const re = /(?<!\[img:)(https?:\/\/[^\s<>"')]+)/g;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            let m; re.lastIndex = 0;
            while ((m = re.exec(node.text)) !== null) {
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                nodeName: 'a', href: m[0], target: '_blank', rel: 'noreferrer',
                style: `color:#C8820A;text-decoration:underline;cursor:pointer`,
              }));
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// ── NoteLink decoration plugin ────────────────────────────────────────────────
// {Note Name} stays as plain text; this plugin adds visual styling only.
// noteNamesRef: React ref to string[] so it stays fresh without recreating plugin.
function createNoteLinkExtension(noteNamesRef) {
  return Extension.create({
    name: 'noteLink',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('noteLink'),
        props: {
          decorations(state) {
            const names = noteNamesRef.current;
            if (!names || !names.length) return DecorationSet.empty;
            const decos = [];
            // Build a regex that matches any {known name}
            const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const re = new RegExp(`\\{(${escaped.join('|')})\\}`, 'g');
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; re.lastIndex = 0;
              while ((m = re.exec(node.text)) !== null) {
                decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                  style: `color:#9A9088;background:rgba(154,144,136,0.12);border:1px solid rgba(154,144,136,0.25);border-radius:4px;padding:0 5px;font-family:${mono};font-size:0.82em;line-height:1.6;vertical-align:middle;display:inline-block;cursor:pointer`,
                  class: 'dl-note-link',
                }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      })];
    },
  });
}

// ── NoteLinkSuggestion Extension ──────────────────────────────────────────────
// Uses @tiptap/suggestion to trigger on `{`, shows dropdown, inserts {name}.
// renderRef: React ref to { onStart, onUpdate, onExit, onKeyDown } callbacks.
function createNoteLinkSuggestion(noteNamesRef, renderRef, onCreateNote) {
  return Extension.create({
    name: 'noteLinkSuggestion',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion({
          editor,
          char: '{',
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }) => {
            const names = noteNamesRef.current || [];
            const q = query.toLowerCase();
            const matches = names.filter(n => n.toLowerCase().includes(q));
            // If query is non-empty and no exact match, offer "Create {query}" option
            if (q && !names.some(n => n.toLowerCase() === q)) {
              matches.push(`__create__:${query}`);
            }
            return matches;
          },
          command: ({ editor, range, props }) => {
            const isCreate = typeof props === 'string' && props.startsWith('__create__:');
            const name = isCreate ? props.slice('__create__:'.length) : props;
            // Delete the {query text and insert {name}
            editor.chain().focus().deleteRange(range).insertContent(`{${name}}`).run();
            if (isCreate && onCreateNote) onCreateNote(name);
          },
          render: () => ({
            onStart: p => renderRef.current?.onStart?.(p),
            onUpdate: p => renderRef.current?.onUpdate?.(p),
            onExit:   p => renderRef.current?.onExit?.(p),
            onKeyDown: p => renderRef.current?.onKeyDown?.(p) ?? false,
          }),
        }),
      ];
    },
  });
}

// ── ImageBlock node ───────────────────────────────────────────────────────────
const ImageBlock = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() { return { src: { default: null } }; },
  parseHTML() { return [{ tag: 'div[data-imageblock]' }]; },
  renderHTML({ node }) {
    return ['div', { 'data-imageblock': node.attrs.src, style: 'margin:4px 0;line-height:0' },
      ['img', { src: node.attrs.src, style: 'max-width:100%;max-height:320px;border-radius:8px;display:block;cursor:default', contenteditable: 'false', draggable: 'false' }]
    ];
  },
  addKeyboardShortcuts() {
    const del = () => {
      if (this.editor.state.selection?.node?.type.name === 'imageBlock') {
        this.editor.commands.deleteSelection(); return true;
      }
      return false;
    };
    return { Backspace: del, Delete: del };
  },
});

// ── Serialisation ─────────────────────────────────────────────────────────────
export function docToText(docJson) {
  const lines = [];
  (docJson?.content || []).forEach(node => {
    if (node.type === 'imageBlock') {
      lines.push(`[img:${node.attrs?.src}]`);
    } else if (node.type === 'paragraph') {
      let text = '';
      (node.content || []).forEach(c => {
        if (c.type === 'text') text += c.text ?? '';
        else if (c.type === 'hardBreak') text += '\n';
      });
      lines.push(text);
    }
  });
  const result = lines.join('\n');
  return result.endsWith('\n') ? result.slice(0, -1) : result;
}

export function textToContent(text) {
  if (!text) return [{ type: 'paragraph' }];
  return text.split('\n').map(line => {
    const m = line.match(/\[img:(https?:\/\/[^\]]+)\]/);
    if (m) return { type: 'imageBlock', attrs: { src: m[1] } };
    return { type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined };
  });
}

// ── DayLabEditor ──────────────────────────────────────────────────────────────
// Props:
//   value           — plain text string (Day Lab format)
//   onBlur          — (text) => void — called on blur with serialised text
//   onEnterCommit   — (text) => void — singleLine: Enter commits + clears editor
//   onEnterSplit    — ({before,after}) => void — singleLine: Enter splits at caret
//   onImageUpload   — async (File) => url — enables image paste/drop
//   noteNames       — string[] — enables {note} autocomplete + decoration
//   onCreateNote    — (name) => void — called when user creates note via {name}
//   placeholder     — string
//   singleLine      — boolean: suppress multiline Enter
//   style           — style object for outer wrapper
//   color           — caret/accent colour (default #D08828)
//   editable        — boolean (default true)
export function DayLabEditor({
  value,
  onBlur,
  onEnterCommit,
  onEnterSplit,
  onBackspaceEmpty,
  onImageUpload,
  noteNames,
  onCreateNote,
  placeholder,
  singleLine = false,
  autoFocus = false,
  style,
  color = '#D08828',
  textColor,
  mutedColor,
  editable = true,
}) {
  useEffect(injectEditorStyles, []);

  // Refs for callbacks — avoids stale closures in TipTap plugins
  const lastExternalValue   = useRef(value);
  const editorRef           = useRef(null);
  const onBlurRef           = useRef(onBlur);
  const onEnterCommitRef    = useRef(onEnterCommit);
  const onEnterSplitRef     = useRef(onEnterSplit);
  const onBackspaceEmptyRef = useRef(onBackspaceEmpty);
  const onImageUploadRef    = useRef(onImageUpload);
  const noteNamesRef        = useRef(noteNames || []);
  const onCreateNoteRef     = useRef(onCreateNote);

  useEffect(() => { onBlurRef.current           = onBlur; },           [onBlur]);
  useEffect(() => { onEnterCommitRef.current     = onEnterCommit; },    [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current      = onEnterSplit; },     [onEnterSplit]);
  useEffect(() => { onBackspaceEmptyRef.current  = onBackspaceEmpty; }, [onBackspaceEmpty]);
  useEffect(() => { onImageUploadRef.current     = onImageUpload; },    [onImageUpload]);
  useEffect(() => { noteNamesRef.current         = noteNames || []; },  [noteNames]);
  useEffect(() => { onCreateNoteRef.current      = onCreateNote; },     [onCreateNote]);

  // ── Suggestion dropdown state ────────────────────────────────────────────
  const [suggState, setSuggState] = useState(null); // null | { items, selectedIndex, clientRect, command }
  const suggStateRef = useRef(null);
  useEffect(() => { suggStateRef.current = suggState; }, [suggState]);

  // renderRef bridges TipTap suggestion lifecycle → React state
  const renderRef = useRef({
    onStart(props) {
      setSuggState({
        items: props.items,
        selectedIndex: 0,
        clientRect: props.clientRect,
        command: props.command,
      });
    },
    onUpdate(props) {
      setSuggState(s => s ? {
        ...s,
        items: props.items,
        selectedIndex: 0,
        clientRect: props.clientRect,
        command: props.command,
      } : null);
    },
    onExit() { setSuggState(null); },
    onKeyDown({ event }) {
      const s = suggStateRef.current;
      if (!s) return false;
      if (event.key === 'ArrowDown') {
        setSuggState(prev => ({ ...prev, selectedIndex: (prev.selectedIndex + 1) % Math.max(prev.items.length, 1) }));
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSuggState(prev => ({ ...prev, selectedIndex: (prev.selectedIndex - 1 + Math.max(prev.items.length, 1)) % Math.max(prev.items.length, 1) }));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = s.items[s.selectedIndex];
        if (item != null) { s.command(item); setSuggState(null); }
        return true;
      }
      if (event.key === 'Escape') { setSuggState(null); return true; }
      return false;
    },
  });

  textColor  = textColor  || 'inherit';
  mutedColor = mutedColor || '#9A9088';

  // Build extensions once — note: noteNamesRef and renderRef are stable refs
  const noteLinkDecoration = useRef(createNoteLinkExtension(noteNamesRef));
  const noteLinkSuggestion = useRef(null);
  if (noteNames !== undefined && noteLinkSuggestion.current === null) {
    // Will be set after editor is available, below
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, codeBlock: false, code: false, horizontalRule: false,
        strike: false, bold: false, italic: false,
      }),
      HashTagExtension,
      URLExtension,
      noteLinkDecoration.current,
      ...(singleLine ? [] : [ImageBlock]),
      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),
      // Suggestion extension — only added when noteNames prop is provided
      ...(noteNames !== undefined ? [createNoteLinkSuggestion(
        noteNamesRef,
        renderRef,
        name => onCreateNoteRef.current?.(name),
      )] : []),
    ],
    content: { type: 'doc', content: textToContent(value || '') },
    editable,
    editorProps: {
      handleKeyDown(view, e) {
        if (e.key === 'Enter' && !e.shiftKey && singleLine) {
          e.preventDefault();
          const text = docToText(view.state.doc.toJSON());
          if (onEnterCommitRef.current) {
            onEnterCommitRef.current(text);
            setTimeout(() => editorRef.current?.commands.setContent(
              { type: 'doc', content: [{ type: 'paragraph' }] }
            ), 0);
          } else if (onEnterSplitRef.current) {
            const { from } = view.state.selection;
            let caretTextPos = 0;
            view.state.doc.descendants((node, nodePos) => {
              if (!node.isText) return;
              if (from > nodePos + node.text.length) caretTextPos += node.text.length;
              else if (from > nodePos)               caretTextPos += from - nodePos;
            });
            onEnterSplitRef.current({ before: text.slice(0, caretTextPos), after: text.slice(caretTextPos) });
          }
          return true;
        }
        if (e.key === 'Escape') { view.dom.blur(); return true; }
        return false;
      },
      handleDOMEvents: {
        paste(view, e) {
          if (!onImageUploadRef.current) return false;
          const img = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
          if (!img) return false;
          e.preventDefault();
          onImageUploadRef.current(img.getAsFile()).then(url => {
            if (url) editorRef.current?.commands.insertContent({ type: 'imageBlock', attrs: { src: url } });
          });
          return true;
        },
        drop(view, e) {
          if (!onImageUploadRef.current) return false;
          const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
          if (!files.length) return false;
          e.preventDefault();
          onImageUploadRef.current(files[0]).then(url => {
            if (url) editorRef.current?.commands.insertContent({ type: 'imageBlock', attrs: { src: url } });
          });
          return true;
        },
      },
    },
    onBlur({ editor }) {
      onBlurRef.current?.(docToText(editor.getJSON()));
    },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    const id = setTimeout(() => editor.commands.focus('end'), 0);
    return () => clearTimeout(id);
  }, [editor, autoFocus]);

  useEffect(() => {
    if (!editor || !singleLine) return;
    const dom = editor.view.dom;
    const handler = (e) => {
      if (e.key !== 'Backspace' || !onBackspaceEmptyRef.current) return;
      const text = docToText(editor.view.state.doc.toJSON());
      if (text) return;
      e.preventDefault();
      e.stopPropagation();
      onBackspaceEmptyRef.current();
    };
    dom.addEventListener('keydown', handler, true);
    return () => dom.removeEventListener('keydown', handler, true);
  }, [editor, singleLine]);

  useEffect(() => {
    if (!editor || value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    if (!editor.isFocused) {
      editor.commands.setContent({ type: 'doc', content: textToContent(value || '') });
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  // ── Suggestion dropdown position ─────────────────────────────────────────
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!suggState?.clientRect) return;
    const rect = suggState.clientRect();
    if (!rect || !wrapRef.current) return;
    const wrect = wrapRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom - wrect.top + 4, left: rect.left - wrect.left });
  }, [suggState]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div className="dl-editor" style={{
        fontFamily: serif, fontSize: F.md, lineHeight: '1.7',
        color: textColor, caretColor: color,
        '--dl-muted': mutedColor,
        ...style,
      }}>
        <EditorContent editor={editor} />
      </div>

      {/* Note link suggestion dropdown */}
      {suggState && suggState.items.length > 0 && (
        <div style={{
          position: 'absolute', top: dropPos.top, left: dropPos.left, zIndex: 300,
          background: 'var(--dl-surface, #1E1C1A)',
          border: '1px solid var(--dl-border, #272422)',
          borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
          padding: '4px 0', minWidth: 180, maxWidth: 280, maxHeight: 200, overflowY: 'auto',
        }}>
          {suggState.items.map((item, i) => {
            const isCreate = typeof item === 'string' && item.startsWith('__create__:');
            const label = isCreate ? `+ Create "${item.slice('__create__:'.length)}"` : item;
            return (
              <button key={i}
                onMouseDown={e => { e.preventDefault(); suggState.command(item); setSuggState(null); }}
                style={{
                  display: 'block', width: '100%', background: i === suggState.selectedIndex
                    ? 'rgba(255,255,255,0.07)' : 'none',
                  border: 'none', textAlign: 'left', padding: '5px 12px', cursor: 'pointer',
                  fontFamily: mono, fontSize: 12, letterSpacing: '0.05em',
                  color: isCreate ? '#9A9088' : '#EFDFC3',
                }}
                onMouseEnter={() => setSuggState(s => s ? { ...s, selectedIndex: i } : s)}
              >{label}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}

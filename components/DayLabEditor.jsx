'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import { useEffect, useRef, useState } from 'react';
import { Suggestion } from '@tiptap/suggestion';

// ── Constants (kept in sync with Dashboard.jsx) ───────────────────────────────
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const F = { lg: 18, md: 15, sm: 12 };
const ACCENT  = '#D08828';  // note link colour
const WARM    = '#C8A87A';  // URL colour — warmer than text, cooler than accent

const PROJECT_PALETTE = [
  '#C17B4A', '#7A9E6E', '#6B8EB8', '#A07AB0',
  '#B08050', '#5E9E8A', '#B06878', '#8A8A50',
];
function projectColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// ── Base styles ───────────────────────────────────────────────────────────────
function injectEditorStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('daylab-editor-styles')) return;
  const s = document.createElement('style');
  s.id = 'daylab-editor-styles';
  s.textContent = `
    .dl-editor .ProseMirror { outline: none; white-space: pre-wrap; word-break: break-word; min-height: 1.7em; }
    .dl-editor .ProseMirror p { margin: 0; padding: 0; }
    .dl-editor .ProseMirror p.is-empty:first-child::before { content: attr(data-placeholder); pointer-events: none; float: left; height: 0; color: var(--dl-muted); }
    .dl-editor .ProseMirror-selectednode img { outline: 2px solid ${ACCENT}; border-radius: 8px; }
  `;
  document.head.appendChild(s);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Escape a string for use in a RegExp
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Decoration: @note name → orange accent chip ───────────────────────────────
// Text stays as `@note name` in the doc; visual chip strips the `@`.
function createNoteLinkDecoration(noteNamesRef) {
  return Extension.create({
    name: 'noteLinkDecoration',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('noteLinkDeco'),
        props: {
          decorations(state) {
            const names = noteNamesRef.current;
            if (!names?.length) return DecorationSet.empty;
            const decos = [];
            const escaped = names.map(reEsc);
            // Match @name — longest first so "Portland Planning" wins over "Portland"
            const sorted = escaped.slice().sort((a, b) => b.length - a.length);
            const re = new RegExp(`@(${sorted.join('|')})(?=[^A-Za-z0-9]|$)`, 'g');
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; re.lastIndex = 0;
              while ((m = re.exec(node.text)) !== null) {
                // Decorate full `@name` range but display as just `name`
                decos.push(Decoration.inline(
                  pos + m.index,
                  pos + m.index + m[0].length,
                  {
                    style: `color:${ACCENT};font-family:${serif};cursor:pointer`,
                    class: 'dl-note-link',
                    'data-note': m[1],
                  }
                ));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      })];
    },
  });
}

// ── Decoration: #project name → project pill ─────────────────────────────────
// Handles multi-word project names when projectNamesRef is provided,
// falls back to single-word #tags otherwise.
function createProjectTagDecoration(projectNamesRef) {
  return Extension.create({
    name: 'projectTagDecoration',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('projectTagDeco'),
        props: {
          decorations(state) {
            const decos = [];
            const names = projectNamesRef.current || [];

            // Multi-word known project names — longest first
            if (names.length) {
              const sorted = names.slice().sort((a, b) => b.length - a.length);
              const re = new RegExp(`#(${sorted.map(reEsc).join('|')})(?=[^A-Za-z0-9]|$)`, 'gi');
              state.doc.descendants((node, pos) => {
                if (!node.isText) return;
                let m; re.lastIndex = 0;
                while ((m = re.exec(node.text)) !== null) {
                  const col = projectColor(m[1].toLowerCase());
                  decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                    style: `color:${col};background:${col}18;border:1px solid ${col}50;border-radius:4px;padding:0 5px;font-family:${mono};font-size:0.82em;letter-spacing:0.06em;text-transform:uppercase;line-height:1.6;vertical-align:middle;display:inline-block;cursor:pointer`,
                  }));
                }
              });
            }

            // Single-word fallback for unrecognised #tags
            const knownLower = new Set(names.map(n => n.toLowerCase()));
            const reWord = /#([A-Za-z][A-Za-z0-9]+)/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; reWord.lastIndex = 0;
              while ((m = reWord.exec(node.text)) !== null) {
                if (knownLower.has(m[1].toLowerCase())) continue; // already handled above
                const col = projectColor(m[1]);
                decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                  style: `color:${col};background:${col}18;border:1px solid ${col}50;border-radius:4px;padding:0 5px;font-family:${mono};font-size:0.82em;letter-spacing:0.06em;text-transform:uppercase;line-height:1.6;vertical-align:middle;display:inline-block`,
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

// ── Decoration: URLs → warm underline ────────────────────────────────────────
const URLExtension = Extension.create({
  name: 'urlDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('urlDecoration'),
      props: {
        decorations(state) {
          const decos = [];
          const re = /(?<!\[img:)(https?:\/\/[^\s<>"')[\]]+)/g;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            let m; re.lastIndex = 0;
            while ((m = re.exec(node.text)) !== null) {
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                nodeName: 'a', href: m[0], target: '_blank', rel: 'noreferrer',
                style: `color:${WARM};text-decoration:underline;text-underline-offset:2px;cursor:pointer`,
              }));
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// ── Suggestion factory ────────────────────────────────────────────────────────
// Reusable for both @note and #project triggers.
// char          — trigger character
// itemsFn       — (query) => string[]
// commandFn     — ({ editor, range, name }) => void
// renderRef     — shared renderRef from component
// suggKey       — unique string for PluginKey
function createSuggestion({ char, allowSpaces, itemsFn, commandFn, renderRef, suggKey }) {
  return Extension.create({
    name: `suggestion_${suggKey}`,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [Suggestion({
        editor,
        char,
        allowSpaces: allowSpaces ?? true,
        allowedPrefixes: null,
        pluginKey: new PluginKey(`suggestion_${suggKey}`),
        items: ({ query }) => itemsFn(query),
        command: ({ editor, range, props }) => commandFn({ editor, range, name: props }),
        render: () => ({
          onStart:   p => renderRef.current?.onStart?.(p,   suggKey),
          onUpdate:  p => renderRef.current?.onUpdate?.(p,  suggKey),
          onExit:    p => renderRef.current?.onExit?.(p,    suggKey),
          onKeyDown: p => renderRef.current?.onKeyDown?.(p, suggKey) ?? false,
        }),
      })];
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

// ── Suggestion dropdown component ─────────────────────────────────────────────
function SuggestionDropdown({ state, onSelect, wrapRef }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!state?.clientRect || !wrapRef.current) return;
    const rect = state.clientRect();
    if (!rect) return;
    const wrect = wrapRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom - wrect.top + 4, left: Math.max(0, rect.left - wrect.left) });
  }, [state, wrapRef]);

  if (!state || !state.items.length) return null;

  return (
    <div style={{
      position: 'absolute', top: pos.top, left: pos.left, zIndex: 300,
      background: 'var(--dl-surface, #1E1C1A)',
      border: '1px solid var(--dl-border, #2A2724)',
      borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
      padding: '4px 0', minWidth: 180, maxWidth: 300, maxHeight: 220, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isCreate = item.startsWith?.('__create__:');
        const label = isCreate ? `+ Create "${item.slice(11)}"` : item;
        const isSelected = i === state.selectedIndex;
        return (
          <button key={i}
            onMouseDown={e => { e.preventDefault(); onSelect(item); }}
            onMouseEnter={() => state.setIndex(i)}
            style={{
              display: 'block', width: '100%', border: 'none', textAlign: 'left',
              padding: '6px 12px', cursor: 'pointer',
              background: isSelected ? 'rgba(255,255,255,0.08)' : 'none',
              fontFamily: mono, fontSize: 12, letterSpacing: '0.04em',
              color: isCreate ? '#9A9088' : '#EFDFC3',
            }}
          >{label}</button>
        );
      })}
    </div>
  );
}

// ── DayLabEditor ──────────────────────────────────────────────────────────────
// Props:
//   value           — plain text (Day Lab format)
//   onBlur          — (text) => void
//   onEnterCommit   — singleLine: Enter commits
//   onEnterSplit    — singleLine: Enter splits at caret
//   onBackspaceEmpty— singleLine: Backspace on empty
//   onImageUpload   — async (File) => url
//   noteNames       — string[] — enables @note autocomplete + decoration
//   projectNames    — string[] — enables #project autocomplete + multi-word decoration
//   onCreateNote    — (name) => void — called when user types a new @note
//   placeholder     — string
//   singleLine      — boolean
//   autoFocus       — boolean
//   style           — style object
//   color           — caret colour (default #D08828)
//   textColor       — text colour
//   mutedColor      — placeholder colour
//   editable        — boolean (default true)
export function DayLabEditor({
  value,
  onBlur,
  onEnterCommit,
  onEnterSplit,
  onBackspaceEmpty,
  onImageUpload,
  noteNames,
  projectNames,
  onCreateNote,
  placeholder,
  singleLine = false,
  autoFocus = false,
  style,
  color = ACCENT,
  textColor,
  mutedColor,
  editable = true,
}) {
  useEffect(injectEditorStyles, []);

  // Stable refs for all callbacks
  const editorRef           = useRef(null);
  const lastExternalValue   = useRef(value);
  const onBlurRef           = useRef(onBlur);
  const onEnterCommitRef    = useRef(onEnterCommit);
  const onEnterSplitRef     = useRef(onEnterSplit);
  const onBackspaceEmptyRef = useRef(onBackspaceEmpty);
  const onImageUploadRef    = useRef(onImageUpload);
  const noteNamesRef        = useRef(noteNames || []);
  const projectNamesRef     = useRef(projectNames || []);
  const onCreateNoteRef     = useRef(onCreateNote);

  useEffect(() => { onBlurRef.current           = onBlur; },           [onBlur]);
  useEffect(() => { onEnterCommitRef.current     = onEnterCommit; },    [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current      = onEnterSplit; },     [onEnterSplit]);
  useEffect(() => { onBackspaceEmptyRef.current  = onBackspaceEmpty; }, [onBackspaceEmpty]);
  useEffect(() => { onImageUploadRef.current     = onImageUpload; },    [onImageUpload]);
  useEffect(() => { noteNamesRef.current         = noteNames || []; },  [noteNames]);
  useEffect(() => { projectNamesRef.current      = projectNames || []; },[projectNames]);
  useEffect(() => { onCreateNoteRef.current      = onCreateNote; },     [onCreateNote]);

  // ── Suggestion state — one at a time (@ or # but not both simultaneously) ──
  const [sugg, setSugg]   = useState(null);
  // sugg: { key, items, selectedIndex, clientRect, command, setIndex }
  const suggRef           = useRef(null);
  useEffect(() => { suggRef.current = sugg; }, [sugg]);

  const wrapRef = useRef(null);

  // renderRef bridges TipTap suggestion lifecycle → React state
  const renderRef = useRef({
    onStart(props, key) {
      setSugg({
        key,
        items: props.items,
        selectedIndex: 0,
        clientRect: props.clientRect,
        command: props.command,
        setIndex: i => setSugg(s => s ? { ...s, selectedIndex: i } : s),
      });
    },
    onUpdate(props, key) {
      setSugg(s => !s || s.key !== key ? s : {
        ...s,
        items: props.items,
        selectedIndex: 0,
        clientRect: props.clientRect,
        command: props.command,
      });
    },
    onExit(_, key) {
      setSugg(s => s?.key === key ? null : s);
    },
    onKeyDown({ event }, key) {
      const s = suggRef.current;
      if (!s || s.key !== key) return false;
      if (event.key === 'ArrowDown') {
        setSugg(prev => prev ? { ...prev, selectedIndex: (prev.selectedIndex + 1) % Math.max(prev.items.length, 1) } : prev);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSugg(prev => prev ? { ...prev, selectedIndex: (prev.selectedIndex - 1 + Math.max(prev.items.length, 1)) % Math.max(prev.items.length, 1) } : prev);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = s.items[s.selectedIndex];
        if (item != null) { s.command(item); setSugg(null); }
        return true;
      }
      if (event.key === 'Escape') { setSugg(null); return true; }
      return false;
    },
  });

  textColor  = textColor  || 'inherit';
  mutedColor = mutedColor || '#9A9088';

  // Build stable extension refs — only created once per editor instance
  const noteLinkDeco    = useRef(createNoteLinkDecoration(noteNamesRef));
  const projectTagDeco  = useRef(createProjectTagDecoration(projectNamesRef));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, codeBlock: false, code: false, horizontalRule: false,
        strike: false, bold: false, italic: false,
      }),
      URLExtension,
      noteLinkDeco.current,
      projectTagDeco.current,
      ...(singleLine ? [] : [ImageBlock]),
      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),

      // @note suggestion
      createSuggestion({
        char: '@',
        allowSpaces: true,
        suggKey: 'note',
        renderRef,
        itemsFn: (query) => {
          const names = noteNamesRef.current || [];
          const q = query.toLowerCase();
          const matches = names.filter(n => n.toLowerCase().includes(q));
          if (q && !names.some(n => n.toLowerCase() === q)) {
            matches.push(`__create__:${query}`);
          }
          return matches;
        },
        commandFn: ({ editor, range, name }) => {
          const isCreate = name.startsWith('__create__:');
          const noteName = isCreate ? name.slice(11) : name;
          editor.chain().focus().deleteRange(range).insertContent(`@${noteName} `).run();
          if (isCreate) onCreateNoteRef.current?.(noteName);
        },
      }),

      // #project suggestion
      createSuggestion({
        char: '#',
        allowSpaces: true,
        suggKey: 'project',
        renderRef,
        itemsFn: (query) => {
          const names = projectNamesRef.current || [];
          const q = query.toLowerCase();
          return names.filter(n => n.toLowerCase().includes(q));
        },
        commandFn: ({ editor, range, name }) => {
          editor.chain().focus().deleteRange(range).insertContent(`#${name} `).run();
        },
      }),
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
            let caretPos = 0;
            view.state.doc.descendants((node, nodePos) => {
              if (!node.isText) return;
              if (from > nodePos + node.text.length) caretPos += node.text.length;
              else if (from > nodePos)               caretPos += from - nodePos;
            });
            onEnterSplitRef.current({ before: text.slice(0, caretPos), after: text.slice(caretPos) });
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
      e.preventDefault(); e.stopPropagation();
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

      <SuggestionDropdown
        state={sugg}
        wrapRef={wrapRef}
        onSelect={item => { sugg?.command(item); setSugg(null); }}
      />
    </div>
  );
}

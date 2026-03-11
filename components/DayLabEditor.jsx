'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import { useEffect, useRef } from 'react';

// ── Constants (kept in sync with Dashboard.jsx) ───────────────────────────────
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";
export const F = { lg: 18, md: 15, sm: 12 };

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
    .dl-editor[data-theme="dark"]  .ProseMirror p.is-empty:first-child::before { content: attr(data-placeholder); color: #6A6258; pointer-events: none; float: left; height: 0; }
    .dl-editor[data-theme="light"] .ProseMirror p.is-empty:first-child::before { content: attr(data-placeholder); color: #9A8878; pointer-events: none; float: left; height: 0; }
    .dl-editor .ProseMirror-selectednode img { outline: 2px solid #D08828; border-radius: 8px; }
  `;
  document.head.appendChild(s);
}

// ── HashTag decoration plugin ─────────────────────────────────────────────────
// Visual only — text stays as `#Word` in doc. Zero serialisation overhead.
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
          const re = /(?<!\[img:)(https?:\/\/[^\s<>"')\]]+)/g;
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
//   placeholder     — string
//   singleLine      — boolean: suppress multiline Enter
//   style           — style object for outer wrapper
//   color           — caret/accent colour (default #D08828)
//   theme           — 'light' | 'dark'
//   editable        — boolean (default true)
export function DayLabEditor({
  value,
  onBlur,
  onEnterCommit,
  onEnterSplit,
  onImageUpload,
  placeholder,
  singleLine = false,
  style,
  color = '#D08828',
  theme = 'dark',
  editable = true,
}) {
  useEffect(injectEditorStyles, []);

  const lastExternalValue = useRef(value);
  const editorRef         = useRef(null);
  const onBlurRef         = useRef(onBlur);
  const onEnterCommitRef  = useRef(onEnterCommit);
  const onEnterSplitRef   = useRef(onEnterSplit);
  const onImageUploadRef  = useRef(onImageUpload);

  useEffect(() => { onBlurRef.current        = onBlur; },        [onBlur]);
  useEffect(() => { onEnterCommitRef.current  = onEnterCommit; }, [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current   = onEnterSplit; },  [onEnterSplit]);
  useEffect(() => { onImageUploadRef.current  = onImageUpload; }, [onImageUpload]);

  const textColor = theme === 'light' ? '#3D3028' : '#D8CEC2';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, codeBlock: false, code: false, horizontalRule: false,
        strike: false, bold: false, italic: false,
      }),
      HashTagExtension,
      URLExtension,
      ...(singleLine ? [] : [ImageBlock]),
      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),
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

  // Sync external value only when editor is not focused
  useEffect(() => {
    if (!editor || value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    if (!editor.isFocused) {
      editor.commands.setContent({ type: 'doc', content: textToContent(value || '') });
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  return (
    <div className="dl-editor" data-theme={theme} style={{
      fontFamily: serif, fontSize: F.md, lineHeight: '1.7',
      color: textColor, caretColor: color, ...style,
    }}>
      <EditorContent editor={editor} />
    </div>
  );
}

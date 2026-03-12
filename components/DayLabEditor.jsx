'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import {
  useEffect, useRef, useState,
  forwardRef, useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';
import { Suggestion } from '@tiptap/suggestion';

// ── Shared design tokens ──────────────────────────────────────────────────────
const serif = "Georgia, 'Times New Roman', serif";
const mono  = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const F = { lg: 18, md: 15, sm: 12 };
const ACCENT = '#D08828';
const WARM   = '#C8A87A';

const PROJECT_PALETTE = [
  '#C17B4A', '#7A9E6E', '#6B8EB8', '#A07AB0',
  '#B08050', '#5E9E8A', '#B06878', '#8A8A50',
];
export function projectColor(name) {
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
    /* atom node selection ring — replaces the blue browser default */
    .dl-editor .ProseMirror .ProseMirror-selectednode { outline: 2px solid ${ACCENT}55; outline-offset: 1px; border-radius: 999px; }
  `;
  document.head.appendChild(s);
}

// ── ProjectTag — inline atom node ─────────────────────────────────────────────
// Stored in plain-text as `{projectname}` (lowercase).
// Rendered directly as a colored pill. No CSS tricks — the node IS the pill.
const ProjectTagNode = Node.create({
  name: 'projectTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { name: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-project-tag]', getAttrs: el => ({ name: el.getAttribute('data-project-tag') || '' }) }];
  },
  renderHTML({ node }) {
    const name = node.attrs.name || '';
    const col  = projectColor(name);
    return ['span', {
      'data-project-tag': name,
      style: [
        `color:${col}`,
        `background:${col}1e`,
        `border:1.5px solid ${col}66`,
        `border-radius:999px`,
        `padding:0 7px`,
        `font-family:${mono}`,
        `font-size:11px`,
        `letter-spacing:0.08em`,
        `line-height:1.65`,
        `display:inline-block`,
        `vertical-align:middle`,
        `cursor:pointer`,
        `user-select:none`,
        `white-space:nowrap`,
      ].join(';'),
    }, name.toUpperCase()];
  },
});

// ── NoteLink — inline atom node ───────────────────────────────────────────────
// Stored in plain-text as `[note name]`.
// Rendered as an accent-colored chip.
const NoteLinkNode = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { name: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-note-link]', getAttrs: el => ({ name: el.getAttribute('data-note-link') || '' }) }];
  },
  renderHTML({ node }) {
    const name = node.attrs.name || '';
    return ['span', {
      'data-note-link': name,
      style: [
        `color:${ACCENT}`,
        `background:${ACCENT}1a`,
        `border-radius:999px`,
        `padding:0 6px`,
        `font-family:${serif}`,
        `font-size:14px`,
        `display:inline-block`,
        `vertical-align:middle`,
        `cursor:pointer`,
        `user-select:none`,
        `white-space:nowrap`,
      ].join(';'),
    }, name];
  },
});

// ── ImageBlock — block atom node ──────────────────────────────────────────────
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

// ── URL decoration ────────────────────────────────────────────────────────────
// URLs are decorations (not nodes) because they're pure display — the raw URL
// is the right storage format, and decorations are correct for display-only overlays.
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

// ── Serialisation: doc JSON ↔ plain-text storage format ───────────────────────
// Plain-text format:
//   projectTag node  →  {projectname}
//   noteLink node    →  [note name]
//   imageBlock node  →  [img:url]  (its own line)
//   text node        →  literal text
//   paragraphs       →  joined with \n

export function docToText(docJson) {
  function walkInline(nodes) {
    return (nodes || []).map(c => {
      if (c.type === 'text')        return c.text ?? '';
      if (c.type === 'hardBreak')   return '\n';
      if (c.type === 'projectTag')  return `{${c.attrs?.name ?? ''}}`;
      if (c.type === 'noteLink')    return `[${c.attrs?.name ?? ''}]`;
      return '';
    }).join('');
  }

  const lines = [];
  for (const node of (docJson?.content || [])) {
    if (node.type === 'imageBlock') {
      lines.push(`[img:${node.attrs?.src}]`);
    } else if (node.type === 'paragraph') {
      lines.push(walkInline(node.content));
    }
  }
  const result = lines.join('\n');
  return result.endsWith('\n') ? result.slice(0, -1) : result;
}

// Parse a plain-text line into an array of ProseMirror inline content nodes.
function parseLineContent(line) {
  const content = [];
  // Matches: {project} | [note] | legacy #Tag — all other chars are plain text
  const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}|\[([^\]]+)\]|#([A-Za-z][A-Za-z0-9]+)/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) content.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1] != null) {
      // {project} — new format
      content.push({ type: 'projectTag', attrs: { name: m[1] } });
    } else if (m[2] != null) {
      // [note] — note link
      content.push({ type: 'noteLink', attrs: { name: m[2] } });
    } else if (m[3] != null) {
      // #Legacy — convert to projectTag on load
      content.push({ type: 'projectTag', attrs: { name: m[3].toLowerCase() } });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) content.push({ type: 'text', text: line.slice(last) });
  return content;
}

export function textToContent(text) {
  if (!text) return [{ type: 'paragraph' }];
  return text.split('\n').map(line => {
    // Image blocks are whole-line tokens
    const imgM = line.match(/^\[img:(https?:\/\/[^\]]+)\]$/);
    if (imgM) return { type: 'imageBlock', attrs: { src: imgM[1] } };

    const content = parseLineContent(line);
    return { type: 'paragraph', content: content.length ? content : undefined };
  });
}

// ── Custom suggestion match — supports spaces in multi-word names ─────────────
function makeCustomFindSuggestionMatch(char) {
  return function ({ $position }) {
    const nodeBefore = $position.nodeBefore;
    if (!nodeBefore?.isText) return null;
    const nodeText  = nodeBefore.text;
    const nodeStart = $position.pos - nodeBefore.nodeSize;

    let charIdx = -1;
    for (let i = nodeText.length - 1; i >= 0; i--) {
      if (nodeText[i] === char) {
        const prev = i > 0 ? nodeText[i - 1] : ' ';
        if (/\s/.test(prev) || i === 0) { charIdx = i; break; }
      }
    }
    if (charIdx === -1) return null;

    const from  = nodeStart + charIdx;
    const to    = $position.pos;
    const query = nodeText.slice(charIdx + 1);
    return { range: { from, to }, query, text: char + query };
  };
}

// ── Suggestion extension factory ──────────────────────────────────────────────
function createSuggestion({ char, itemsFn, commandFn, renderRef, suggKey }) {
  return Extension.create({
    name: `suggestion_${suggKey}`,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [Suggestion({
        editor,
        char,
        allowSpaces: true,
        allowedPrefixes: null,
        findSuggestionMatch: makeCustomFindSuggestionMatch(char),
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

// ── Suggestion dropdown ───────────────────────────────────────────────────────
function SuggestionDropdown({ state, onSelect }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!state?.clientRect) return;
    const rect = state.clientRect();
    if (!rect) return;
    setPos({
      top:  rect.bottom + 4,
      left: Math.max(4, Math.min(rect.left, window.innerWidth - 280)),
    });
  }, [state]);

  if (!state?.items.length || typeof document === 'undefined') return null;

  const isProject = state.key === 'project';

  return createPortal(
    <div style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      background: '#1E1C1A', border: '1px solid #2A2724', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      padding: '4px 0', minWidth: 180, maxWidth: 300, maxHeight: 240, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isCreate = typeof item === 'string' && item.startsWith('__create__:');
        const rawLabel = isCreate ? item.slice(11) : item;
        const label    = isCreate ? `+ Create "${rawLabel}"`
                       : isProject ? rawLabel.toUpperCase()
                       : rawLabel;
        const col = isProject && !isCreate ? projectColor(rawLabel) : null;
        const selected = i === state.selectedIndex;
        return (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); onSelect(item); }}
            onMouseEnter={() => state.setIndex(i)}
            style={{
              display: 'block', width: '100%', border: 'none', textAlign: 'left',
              padding: '7px 14px', cursor: 'pointer',
              background: selected ? 'rgba(255,255,255,0.09)' : 'transparent',
              fontFamily: mono, fontSize: 12,
              letterSpacing: isProject && !isCreate ? '0.08em' : '0.04em',
              color: isCreate ? '#9A9088' : col || '#EFDFC3',
              transition: 'background 0.08s',
            }}
          >{label}</button>
        );
      })}
    </div>,
    document.body
  );
}

// ── DayLabEditor ──────────────────────────────────────────────────────────────
// The single text-editing primitive for Day Lab.
// All cards (Journal, Tasks, Meals, Workouts, Notes) use this component.
//
// Props:
//   value            — plain-text storage string
//   onBlur           — (text: string) => void
//   onEnterCommit    — singleLine: fires with text on Enter, then clears editor
//   onEnterSplit     — singleLine: fires {before, after} on Enter (tasks use this)
//   onBackspaceEmpty — singleLine: fires when Backspace pressed in empty editor
//   onImageUpload    — async (File) => url
//   noteNames        — string[] for [ autocomplete
//   projectNames     — string[] for { autocomplete
//   onCreateNote     — (name: string) => void
//   onProjectClick   — (storedName: string) => void  — chip click nav
//   onNoteClick      — (noteName: string) => void    — chip click nav
//   placeholder, singleLine, autoFocus, style, color, textColor, mutedColor, editable
//
// Ref: exposes { focus() } for imperative focus (used by RowList row navigation)

export const DayLabEditor = forwardRef(function DayLabEditor({
  value,
  onBlur,
  onEnterCommit,
  onEnterSplit,
  onBackspaceEmpty,
  onImageUpload,
  noteNames,
  projectNames,
  onCreateNote,
  onProjectClick,
  onNoteClick,
  placeholder,
  singleLine   = false,
  autoFocus    = false,
  style,
  color        = ACCENT,
  textColor,
  mutedColor,
  editable     = true,
}, ref) {
  useEffect(injectEditorStyles, []);

  // Stable refs — avoid stale closures in TipTap plugins / editorProps
  const editorRef            = useRef(null);
  const lastExternalValue    = useRef(value);
  const onBlurRef            = useRef(onBlur);
  const onEnterCommitRef     = useRef(onEnterCommit);
  const onEnterSplitRef      = useRef(onEnterSplit);
  const onBackspaceEmptyRef  = useRef(onBackspaceEmpty);
  const onImageUploadRef     = useRef(onImageUpload);
  const noteNamesRef         = useRef(noteNames || []);
  const projectNamesRef      = useRef(projectNames || []);
  const onCreateNoteRef      = useRef(onCreateNote);
  const onProjectClickRef    = useRef(onProjectClick);
  const onNoteClickRef       = useRef(onNoteClick);

  useEffect(() => { onBlurRef.current          = onBlur; },           [onBlur]);
  useEffect(() => { onEnterCommitRef.current    = onEnterCommit; },    [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current     = onEnterSplit; },     [onEnterSplit]);
  useEffect(() => { onBackspaceEmptyRef.current = onBackspaceEmpty; }, [onBackspaceEmpty]);
  useEffect(() => { onImageUploadRef.current    = onImageUpload; },    [onImageUpload]);
  useEffect(() => { noteNamesRef.current        = noteNames || []; },  [noteNames]);
  useEffect(() => { projectNamesRef.current     = projectNames || []; }, [projectNames]);
  useEffect(() => { onCreateNoteRef.current     = onCreateNote; },     [onCreateNote]);
  useEffect(() => { onProjectClickRef.current   = onProjectClick; },   [onProjectClick]);
  useEffect(() => { onNoteClickRef.current      = onNoteClick; },      [onNoteClick]);

  // Expose focus() imperatively so RowList can programmatically focus rows
  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.commands.focus('end'),
  }), []); // eslint-disable-line

  // ── Suggestion dropdown state ─────────────────────────────────────────────
  const [sugg, setSugg] = useState(null);
  const suggRef = useRef(null);
  useEffect(() => { suggRef.current = sugg; }, [sugg]);

  const renderRef = useRef({
    onStart(props, key) {
      setSugg({
        key, items: props.items, selectedIndex: 0,
        clientRect: props.clientRect, command: props.command,
        setIndex: i => setSugg(s => s ? { ...s, selectedIndex: i } : s),
      });
    },
    onUpdate(props, key) {
      setSugg(s => !s || s.key !== key ? s : {
        ...s, items: props.items, selectedIndex: 0,
        clientRect: props.clientRect, command: props.command,
      });
    },
    onExit(_, key) {
      setSugg(s => s?.key === key ? null : s);
    },
    onKeyDown({ event }, key) {
      const s = suggRef.current;
      if (!s || s.key !== key) return false;
      const len = Math.max(s.items.length, 1);
      if (event.key === 'ArrowDown') {
        setSugg(p => p ? { ...p, selectedIndex: (p.selectedIndex + 1) % len } : p);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSugg(p => p ? { ...p, selectedIndex: (p.selectedIndex - 1 + len) % len } : p);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab' || event.key === ']' || event.key === '}') {
        const item = s.items[s.selectedIndex];
        if (item != null) { s.command(item); setSugg(null); event.preventDefault(); }
        return true;
      }
      if (event.key === 'Escape') { setSugg(null); return true; }
      return false;
    },
  });

  textColor  = textColor  || 'inherit';
  mutedColor = mutedColor || '#9A9088';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false,
        listItem: false, codeBlock: false, code: false, horizontalRule: false,
        strike: false, bold: false, italic: false,
      }),
      URLExtension,
      ProjectTagNode,
      NoteLinkNode,
      ...(singleLine ? [] : [ImageBlock]),
      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),

      // [ → note link
      createSuggestion({
        char: '[',
        suggKey: 'note',
        renderRef,
        itemsFn: (query) => {
          const names = noteNamesRef.current || [];
          const q     = query.toLowerCase().replace(/\s/g, '');
          const matches = names.filter(n => n.toLowerCase().replace(/\s/g, '').includes(q));
          const qTrim   = query.trim();
          if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
            matches.push(`__create__:${qTrim}`);
          }
          return matches;
        },
        commandFn: ({ editor, range, name }) => {
          const isCreate  = name.startsWith('__create__:');
          const noteName  = isCreate ? name.slice(11) : name;
          editor.chain().focus()
            .deleteRange(range)
            .insertContent([
              { type: 'noteLink', attrs: { name: noteName } },
              { type: 'text', text: ' ' },
            ])
            .run();
          if (isCreate) onCreateNoteRef.current?.(noteName);
        },
      }),

      // { → project tag
      createSuggestion({
        char: '{',
        suggKey: 'project',
        renderRef,
        itemsFn: (query) => {
          const names = projectNamesRef.current || [];
          const q     = query.toLowerCase().replace(/\s/g, '');
          return names.filter(n => n.toLowerCase().replace(/\s/g, '').includes(q));
        },
        commandFn: ({ editor, range, name }) => {
          editor.chain().focus()
            .deleteRange(range)
            .insertContent([
              { type: 'projectTag', attrs: { name: name.toLowerCase() } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
      }),
    ],

    content: { type: 'doc', content: textToContent(value || '') },
    editable,

    editorProps: {
      // Chip click → navigate
      handleClick(view, pos, event) {
        const t = event.target;
        const projectEl = t.closest?.('[data-project-tag]');
        if (projectEl && onProjectClickRef.current) {
          onProjectClickRef.current(projectEl.getAttribute('data-project-tag'));
          return true;
        }
        const noteEl = t.closest?.('[data-note-link]');
        if (noteEl && onNoteClickRef.current) {
          onNoteClickRef.current(noteEl.getAttribute('data-note-link'));
          return true;
        }
        return false;
      },

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
            // Calculate char position before split
            const { from } = view.state.selection;
            let cp = 0;
            view.state.doc.descendants((node, nodePos) => {
              if (!node.isText) return;
              if (from > nodePos + node.text.length) cp += node.text.length;
              else if (from > nodePos)               cp += from - nodePos;
            });
            onEnterSplitRef.current({ before: text.slice(0, cp), after: text.slice(cp) });
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

  // Imperative focus for autoFocus prop
  useEffect(() => {
    if (!editor || !autoFocus) return;
    const id = setTimeout(() => editor.commands.focus('end'), 0);
    return () => clearTimeout(id);
  }, [editor, autoFocus]);

  // Capture-phase Backspace for empty singleLine
  useEffect(() => {
    if (!editor || !singleLine) return;
    const dom = editor.view.dom;
    const handler = (e) => {
      if (e.key !== 'Backspace' || !onBackspaceEmptyRef.current) return;
      if (docToText(editor.view.state.doc.toJSON())) return;
      e.preventDefault(); e.stopPropagation();
      onBackspaceEmptyRef.current();
    };
    dom.addEventListener('keydown', handler, true);
    return () => dom.removeEventListener('keydown', handler, true);
  }, [editor, singleLine]);

  // Sync externally-driven value changes (only when editor is not focused)
  useEffect(() => {
    if (!editor || value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    if (!editor.isFocused) {
      editor.commands.setContent({ type: 'doc', content: textToContent(value || '') });
    }
  }, [value, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  return (
    <>
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
        onSelect={item => { sugg?.command(item); setSugg(null); }}
      />
    </>
  );
});

'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
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
    .dl-editor .ProseMirror .ProseMirror-selectednode { outline: 2px solid ${ACCENT}55; outline-offset: 1px; border-radius: 999px; }
  `;
  document.head.appendChild(s);
}

function injectTaskStyles() {
  if (typeof document === 'undefined') return;
  // Always replace so we get fresh styles after deploys
  const existing = document.getElementById('daylab-task-styles');
  if (existing) existing.remove();
  const s = document.createElement('style');
  s.id = 'daylab-task-styles';
  s.textContent = `
    /* Checkbox — inline style can't do appearance:none or ::after */
    .dl-tasks .ProseMirror li[data-type="taskItem"] > label {
      display: flex; align-items: center; flex-shrink: 0;
      margin-top: 0.3em; cursor: pointer; user-select: none;
    }
    .dl-tasks .ProseMirror li[data-type="taskItem"] > label > input[type="checkbox"] {
      appearance: none; -webkit-appearance: none;
      width: 15px; height: 15px; border-radius: 4px; flex-shrink: 0;
      border: 1.5px solid #333028; background: transparent; cursor: pointer;
      transition: background 0.15s, border-color 0.15s; position: relative; margin: 0;
    }
    .dl-tasks .ProseMirror li[data-type="taskItem"] > label > input[type="checkbox"]:checked {
      background: #4878A8; border-color: #4878A8;
    }
    .dl-tasks .ProseMirror li[data-type="taskItem"] > label > input[type="checkbox"]:checked::after {
      content: ''; position: absolute;
      left: 3px; top: 1px; width: 5px; height: 9px;
      border: 1.5px solid #111110; border-top: none; border-left: none;
      transform: rotate(45deg);
    }
    /* Text area next to checkbox */
    .dl-tasks .ProseMirror li[data-type="taskItem"] > div { flex: 1; min-width: 0; }
    .dl-tasks .ProseMirror li[data-type="taskItem"] > div > p { margin: 0; }
    /* Done */
    .dl-tasks .ProseMirror li[data-type="taskItem"][data-checked="true"] > div {
      text-decoration: line-through; opacity: 0.35;
    }
    /* Filter — !important beats the inline display:flex on the <li> */
    [data-task-filter="open"] .dl-tasks .ProseMirror li[data-type="taskItem"][data-checked="true"]  { display: none !important; }
    [data-task-filter="done"] .dl-tasks .ProseMirror li[data-type="taskItem"][data-checked="false"] { display: none !important; }
  `;
  document.head.appendChild(s);
}

export const CHIP_TOKENS = {
  project: (col) => ({
    display: 'inline-block', verticalAlign: 'middle',
    color: col,
    background: col + '22',
    borderRadius: '5px',
    padding: '1px 7px',
    fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap', flexShrink: 0,
  }),
  note: {
    display: 'inline-block', verticalAlign: 'middle',
    color: ACCENT,
    background: ACCENT + '1a',
    borderRadius: '5px',
    padding: '1px 6px',
    fontFamily: serif, fontSize: '14px',
    lineHeight: '1.65',
    whiteSpace: 'nowrap', flexShrink: 0,
  },
};

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
      style: Object.entries({ ...CHIP_TOKENS.project(col), cursor: 'pointer', userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
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
      style: Object.entries({ ...CHIP_TOKENS.note, cursor: 'pointer', userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
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
// Finds the trigger char preceded by whitespace or at position 0.
// Supports multi-word queries (allowSpaces: true in Suggestion config).
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
  const isNote    = state.key === 'note';

  return createPortal(
    <div style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      background: '#1E1C1A', border: '1px solid #2A2724', borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      padding: '4px 0', minWidth: 180, maxWidth: 300, maxHeight: 240, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isCreate = item.startsWith('__create__:');
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
  taskMode     = false,
  autoFocus    = false,
  style,
  color        = ACCENT,
  textColor,
  mutedColor,
  editable     = true,
}, ref) {
  useEffect(injectEditorStyles, []);
  useEffect(() => { if (taskMode) injectTaskStyles(); }, [taskMode]);

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
  // suggRef is updated SYNCHRONOUSLY in onStart/onUpdate/onExit so that
  // editorProps.handleKeyDown can check it in the same event tick.
  // (useState + useEffect would be async — the ref would lag one render behind,
  //  causing Enter to fire the singleLine split while the dropdown is open.)
  const [sugg, setSugg] = useState(null);
  const suggRef = useRef(null);   // kept in sync synchronously below

  const renderRef = useRef({
    onStart(props, key) {
      const s = {
        key, items: props.items, selectedIndex: 0,
        clientRect: props.clientRect, command: props.command,
        setIndex: i => setSugg(p => p ? { ...p, selectedIndex: i } : p),
      };
      suggRef.current = s;
      setSugg(s);
    },
    onUpdate(props, key) {
      setSugg(s => {
        if (!s || s.key !== key) return s;
        const next = { ...s, items: props.items, selectedIndex: 0,
          clientRect: props.clientRect, command: props.command };
        suggRef.current = next;
        return next;
      });
    },
    onExit(_, key) {
      setSugg(s => {
        if (s?.key === key) { suggRef.current = null; return null; }
        return s;
      });
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
      if (event.key === 'Enter' || event.key === 'Tab') {
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
      ...(taskMode ? [
        TaskList.configure({
          HTMLAttributes: { style: 'list-style:none;padding:0;margin:0;' },
        }),
        TaskItem.configure({
          nested: false,
          HTMLAttributes: { style: 'display:flex;align-items:flex-start;gap:10px;padding:3px 0;' },
        }),
        // Structural guard: after every transaction, ensure the doc always has
        // a taskList as its only child. appendTransaction runs AFTER the 
        // transaction is applied — unlike keyboard shortcuts which fire before.
        Extension.create({
          name: 'taskGuard',
          addProseMirrorPlugins() {
            return [new Plugin({
              key: new PluginKey('taskGuard'),
              appendTransaction(_transactions, _oldState, newState) {
                if (newState.doc.firstChild?.type.name === 'taskList') return null;
                // Doc lost its taskList — restore a blank one
                const { schema } = newState;
                const taskList = schema.nodes.taskList.create(null, [
                  schema.nodes.taskItem.create({ checked: false }, [
                    schema.nodes.paragraph.create(),
                  ]),
                ]);
                return newState.tr.replaceWith(0, newState.doc.content.size, taskList);
              },
            })];
          },
        }),
      ] : []),
      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),

      // @ → project tag  (@ is on main mobile keyboard, no ambiguity)
      createSuggestion({
        char: '@',
        suggKey: 'project',
        renderRef,
        itemsFn: (query) => {
          const q = query.toLowerCase().replace(/\s/g, '');
          return (projectNamesRef.current || [])
            .filter(n => n.toLowerCase().replace(/\s/g, '').includes(q));
        },
        commandFn: ({ editor, range, name }) => {
          editor.chain().focus().deleteRange(range).insertContent([
            { type: 'projectTag', attrs: { name: name.toLowerCase() } },
            { type: 'text', text: ' ' },
          ]).run();
        },
      }),

      // # → note link  (# is on main mobile keyboard)
      createSuggestion({
        char: '#',
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
          const isCreate = name.startsWith('__create__:');
          const noteName = isCreate ? name.slice(11) : name;
          editor.chain().focus().deleteRange(range).insertContent([
            { type: 'noteLink', attrs: { name: noteName } },
            { type: 'text', text: ' ' },
          ]).run();
          if (isCreate) onCreateNoteRef.current?.(noteName);
        },
      }),
    ],

    content: taskMode
      ? (value || '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>')
      : { type: 'doc', content: textToContent(value || '') },
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
        // If a suggestion dropdown is open, let the suggestion plugin handle Enter/Tab/]/}
        // The suggestion plugin's onKeyDown fires AFTER editorProps.handleKeyDown in TipTap,
        // so we must defer to it by not consuming those keys when a suggestion is active.
        if (suggRef.current && (e.key === 'Enter' || e.key === 'Tab')) {
          return false;
        }

        if (e.key === 'Enter' && !e.shiftKey && singleLine) {
          e.preventDefault();
          const text = docToText(view.state.doc.toJSON());
          if (onEnterCommitRef.current) {
            onEnterCommitRef.current(text);
            setTimeout(() => editorRef.current?.commands.setContent(
              { type: 'doc', content: [{ type: 'paragraph' }] }
            ), 0);
          } else if (onEnterSplitRef.current) {
            // Split the paragraph at the cursor using ProseMirror Fragment.cut.
            //
            // `from` is an absolute doc position. The singleLine doc is always:
            //   doc(0) → paragraph(1) → ...content... → paragraph-close → doc-close
            // Position 1 is the start of paragraph content, so the content offset
            // within the paragraph = from - 1.
            //
            // IMPORTANT: do NOT use doc.cut(1, from) — that calls Fragment.cut(1, from)
            // on doc.content, which cuts *into* the paragraph's first child at offset 1
            // and drops its first character. Use para.content.cut(0, offset) instead.
            const { from } = view.state.selection;
            const para   = view.state.doc.child(0);           // the only paragraph
            const offset = Math.min(from - 1, para.content.size); // clamp to [0, size]
            const clampedOffset = Math.max(0, offset);

            const leftFrag  = para.content.cut(0, clampedOffset);
            const rightFrag = para.content.cut(clampedOffset);

            const toDoc = (frag) => ({
              type: 'doc',
              content: [{ type: 'paragraph', content: frag.toJSON() ?? [] }],
            });
            const before = docToText(toDoc(leftFrag));
            const after  = docToText(toDoc(rightFrag));
            onEnterSplitRef.current({ before, after });
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
      onBlurRef.current?.(taskMode ? editor.getHTML() : docToText(editor.getJSON()));
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
      if (taskMode) {
        editor.commands.setContent(value || '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>');
      } else {
        editor.commands.setContent({ type: 'doc', content: textToContent(value || '') });
      }
    }
  }, [value, editor]); // eslint-disable-line

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  return (
    <>
      <div className={`dl-editor${taskMode ? ' dl-tasks' : ''}`} style={{
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

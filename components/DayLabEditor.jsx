'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Suggestion } from '@tiptap/suggestion';

// ── Constants (kept in sync with Dashboard.jsx) ───────────────────────────────
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

// ── Hex → rgba helper ─────────────────────────────────────────────────────────
function hexAlpha(hex, alpha) {
  // Expand shorthand (#abc → #aabbcc)
  const full = hex.length === 4
    ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
    : hex;
  const r = parseInt(full.slice(1,3),16);
  const g = parseInt(full.slice(3,5),16);
  const b = parseInt(full.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
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

    /* Project tag chip — hides raw {text}, shows ::before pill */
    .dl-project-tag {
      font-size: 0 !important;
      display: inline-block;
      vertical-align: middle;
      cursor: pointer;
      line-height: 0;
    }
    .dl-project-tag::before {
      content: attr(data-label);
      display: inline-block;
      font-size: 11px;
      font-family: ${mono};
      letter-spacing: 0.08em;
      line-height: 1.65;
      vertical-align: middle;
      padding: 0 7px;
      border-radius: 999px;
      color: var(--tag-color);
      background: var(--tag-bg);
      border: 1.5px solid var(--tag-border);
      cursor: pointer;
    }

    /* Note link chip — hides raw [text], shows ::before in accent */
    .dl-note-link {
      font-size: 0 !important;
      display: inline-block;
      vertical-align: middle;
      cursor: pointer;
      line-height: 0;
    }
    .dl-note-link::before {
      content: attr(data-label);
      display: inline-block;
      font-size: 14px;
      font-family: ${serif};
      letter-spacing: 0;
      line-height: 1.65;
      vertical-align: middle;
      padding: 0 5px;
      border-radius: 999px;
      color: ${ACCENT};
      background: ${hexAlpha(ACCENT, 0.1)};
      cursor: pointer;
    }
  `;
  document.head.appendChild(s);
}

// Escape a string for use in a RegExp
function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Decoration: [note name] → clean note chip ─────────────────────────────────
// Text stored as `[note name]`, displayed as clean "note name" chip via ::before CSS.
function createNoteLinkDecoration(noteNamesRef) {
  return Extension.create({
    name: 'noteLinkDecoration',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('noteLinkDeco'),
        props: {
          decorations(state) {
            const decos = [];
            const re = /\[([^\]]+)\]/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; re.lastIndex = 0;
              while ((m = re.exec(node.text)) !== null) {
                const noteName = m[1];
                decos.push(Decoration.inline(
                  pos + m.index,
                  pos + m.index + m[0].length,
                  {
                    nodeName: 'span',
                    class: 'dl-note-link',
                    'data-name': noteName,       // stored value — for navigation
                    'data-label': noteName,       // display value — shown by ::before
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

// ── Decoration: {projectname} → clean project pill ───────────────────────────
// Text stored as `{projectname}` (lowercase). Displayed as "PROJECT NAME" pill via ::before CSS.
// Legacy #ProjectName also decorated during migration window.
function createProjectTagDecoration(projectNamesRef) {
  return Extension.create({
    name: 'projectTagDecoration',
    addProseMirrorPlugins() {
      return [new Plugin({
        key: new PluginKey('projectTagDeco'),
        props: {
          decorations(state) {
            const decos = [];

            const makeAttrs = (storedName, displayLabel) => {
              const col = projectColor(storedName);
              return {
                nodeName: 'span',
                class: 'dl-project-tag',
                'data-name': storedName,           // lowercase stored name — for navigation
                'data-label': displayLabel,         // display label — shown by ::before
                style: `--tag-color:${col};--tag-bg:${hexAlpha(col,0.12)};--tag-border:${hexAlpha(col,0.4)}`,
              };
            };

            // New format: {projectname}
            const reNew = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; reNew.lastIndex = 0;
              while ((m = reNew.exec(node.text)) !== null) {
                const stored  = m[1];                         // e.g. "big think"
                const display = stored.toUpperCase();          // e.g. "BIG THINK"
                decos.push(Decoration.inline(
                  pos + m.index,
                  pos + m.index + m[0].length,
                  makeAttrs(stored, display)
                ));
              }
            });

            // Legacy format: #ProjectName
            const reLegacy = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
            state.doc.descendants((node, pos) => {
              if (!node.isText) return;
              let m; reLegacy.lastIndex = 0;
              while ((m = reLegacy.exec(node.text)) !== null) {
                const stored  = m[1].toLowerCase();
                const display = m[1].toUpperCase();
                decos.push(Decoration.inline(
                  pos + m.index,
                  pos + m.index + m[0].length,
                  makeAttrs(stored, display)
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

// ── Custom findSuggestionMatch ────────────────────────────────────────────────
function makeCustomFindSuggestionMatch(char) {
  return function customFind({ $position }) {
    const nodeBefore = $position.nodeBefore;
    if (!nodeBefore?.isText) return null;
    const nodeText = nodeBefore.text;
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

// ── Suggestion factory ────────────────────────────────────────────────────────
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

// ── Suggestion dropdown ───────────────────────────────────────────────────────
function SuggestionDropdown({ state, onSelect }) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!state?.clientRect) return;
    const rect = state.clientRect();
    if (!rect) return;
    const left = Math.min(rect.left, window.innerWidth - 280);
    const top  = rect.bottom + 4;
    setPos({ top, left: Math.max(4, left) });
  }, [state]);

  if (!state || !state.items.length) return null;
  if (typeof document === 'undefined') return null;

  const isProject = state.key === 'project';

  const dropdown = (
    <div style={{
      position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
      background: '#1E1C1A',
      border: '1px solid #2A2724',
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      padding: '4px 0',
      minWidth: 180, maxWidth: 300, maxHeight: 240, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isCreate = typeof item === 'string' && item.startsWith('__create__:');
        const rawLabel = isCreate ? item.slice(11) : item;
        // Projects show ALL CAPS; notes show as-is (lowercase)
        const label = isCreate
          ? `+ Create "${rawLabel}"`
          : isProject ? rawLabel.toUpperCase() : rawLabel;
        const selected = i === state.selectedIndex;
        const col = isProject && !isCreate ? projectColor(rawLabel) : null;
        return (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); onSelect(item); }}
            onMouseEnter={() => state.setIndex(i)}
            style={{
              display: 'block', width: '100%', border: 'none', textAlign: 'left',
              padding: '7px 14px', cursor: 'pointer',
              background: selected ? 'rgba(255,255,255,0.09)' : 'transparent',
              fontFamily: mono, fontSize: 12, letterSpacing: isProject ? '0.08em' : '0.04em',
              color: isCreate ? '#9A9088' : col || '#EFDFC3',
              transition: 'background 0.08s',
            }}
          >{label}</button>
        );
      })}
    </div>
  );

  return createPortal(dropdown, document.body);
}

// ── DayLabEditor ──────────────────────────────────────────────────────────────
// Props:
//   value           — plain text (Day Lab storage format)
//   onBlur          — (text) => void
//   onEnterCommit   — singleLine: Enter commits + clears
//   onEnterSplit    — singleLine: Enter splits at caret
//   onBackspaceEmpty— singleLine: Backspace when empty
//   onImageUpload   — async (File) => url
//   noteNames       — string[] — enables [ note autocomplete + decoration
//   projectNames    — string[] — enables { project autocomplete + decoration
//   onCreateNote    — (name) => void
//   onProjectClick  — (storedName: string) => void — called when project chip clicked
//   onNoteClick     — (noteName: string) => void   — called when note chip clicked
//   placeholder     — string
//   singleLine      — boolean
//   autoFocus       — boolean
//   style           — style object for outer wrapper
//   color           — caret colour (default ACCENT)
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
  onProjectClick,
  onNoteClick,
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

  // Stable callback refs
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
  useEffect(() => {
    noteNamesRef.current = noteNames || [];
    if (editorRef.current?.view) {
      const { view } = editorRef.current;
      view.dispatch(view.state.tr.setMeta('forceRedecorate', true));
    }
  }, [noteNames]);
  useEffect(() => { projectNamesRef.current     = projectNames || []; }, [projectNames]);
  useEffect(() => { onCreateNoteRef.current     = onCreateNote; },     [onCreateNote]);
  useEffect(() => { onProjectClickRef.current   = onProjectClick; },   [onProjectClick]);
  useEffect(() => { onNoteClickRef.current      = onNoteClick; },      [onNoteClick]);

  // ── Suggestion state ──────────────────────────────────────────────────────
  const [sugg, setSugg]   = useState(null);
  const suggRef           = useRef(null);
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
        if (item != null) {
          s.command(item); setSugg(null);
          event.preventDefault();
        }
        return true;
      }
      if (event.key === 'Escape') { setSugg(null); return true; }
      return false;
    },
  });

  textColor  = textColor  || 'inherit';
  mutedColor = mutedColor || '#9A9088';

  const noteLinkDeco   = useRef(createNoteLinkDecoration(noteNamesRef));
  const projectTagDeco = useRef(createProjectTagDecoration(projectNamesRef));

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

      // [ → note link autocomplete
      createSuggestion({
        char: '[',
        suggKey: 'note',
        renderRef,
        itemsFn: (query) => {
          const names = noteNamesRef.current || [];
          const q = query.toLowerCase().replace(/\s/g, '');
          const matches = names.filter(n => n.toLowerCase().replace(/\s/g, '').includes(q));
          const qTrim = query.trim();
          if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
            matches.push(`__create__:${qTrim}`);
          }
          return matches;
        },
        commandFn: ({ editor, range, name }) => {
          const isCreate = name.startsWith('__create__:');
          const noteName = isCreate ? name.slice(11) : name;
          editor.chain().focus().deleteRange(range).insertContent(`[${noteName}] `).run();
          if (isCreate) onCreateNoteRef.current?.(noteName);
        },
      }),

      // { → project tag autocomplete
      createSuggestion({
        char: '{',
        suggKey: 'project',
        renderRef,
        itemsFn: (query) => {
          const names = projectNamesRef.current || [];
          const q = query.toLowerCase().replace(/\s/g, '');
          return names.filter(n => n.toLowerCase().replace(/\s/g, '').includes(q));
        },
        commandFn: ({ editor, range, name }) => {
          editor.chain().focus().deleteRange(range).insertContent(`{${name.toLowerCase()}} `).run();
        },
      }),
    ],
    content: { type: 'doc', content: textToContent(value || '') },
    editable,
    editorProps: {
      handleClick(view, pos, event) {
        // Chip clicks — navigate to project or note
        const target = event.target;
        const projectChip = target.closest?.('.dl-project-tag');
        if (projectChip && onProjectClickRef.current) {
          const name = projectChip.getAttribute('data-name');
          if (name) { onProjectClickRef.current(name); return true; }
        }
        const noteChip = target.closest?.('.dl-note-link');
        if (noteChip && onNoteClickRef.current) {
          const name = noteChip.getAttribute('data-name');
          if (name) { onNoteClickRef.current(name); return true; }
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
      if (docToText(editor.view.state.doc.toJSON())) return;
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
}

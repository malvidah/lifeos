'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension, Node } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import {
  useEffect, useLayoutEffect, useRef, useState,
  forwardRef, useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';
import { Suggestion } from '@tiptap/suggestion';
import { serif, mono, F, projectColor, CHIP_TOKENS, THEMES } from '@/lib/tokens';

const ACCENT = THEMES.dark.accent;
const WARM   = 'var(--dl-accent)';

// ── CSS injection ─────────────────────────────────────────────────────────────
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

// ── TipTap custom nodes ───────────────────────────────────────────────────────

// ProjectTag: stored as {projectname}, rendered as colored pill atom node.
const ProjectTagNode = Node.create({
  name: 'projectTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() { return { name: { default: '' } }; },
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

// NoteLink: stored as [note name], rendered as accent chip atom node.
const NoteLinkNode = Node.create({
  name: 'noteLink', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() { return { name: { default: '' } }; },
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

// ImageBlock: stored as [img:url], rendered as block image atom node.
const ImageBlock = Node.create({
  name: 'imageBlock', group: 'block', atom: true, selectable: true, draggable: false,
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

// URLExtension: decoration-only — URLs stay as plain text in storage.
const URLExtension = Extension.create({
  name: 'urlDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('urlDecoration'),
      props: {
        decorations(state) {
          const decos = [];
          const re = /(?<!\[img:)(https?:\/\/[^\s<>"')[  \]]+)/g;
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

// ── Serialisation ─────────────────────────────────────────────────────────────
// Storage format (plain text):
//   projectTag → {projectname}
//   noteLink   → [note name]
//   imageBlock → [img:url]  (its own paragraph line)
//   paragraphs → joined with \n

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
    if (node.type === 'imageBlock') lines.push(`[img:${node.attrs?.src}]`);
    else if (node.type === 'paragraph') lines.push(walkInline(node.content));
  }
  const result = lines.join('\n');
  return result.endsWith('\n') ? result.slice(0, -1) : result;
}

function parseLineContent(line) {
  const content = [];
  // {project} | [note] | legacy #Tag
  const re = /\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}|\[([^\]]+)\]|#([A-Za-z][A-Za-z0-9]+)/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) content.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1] != null)      content.push({ type: 'projectTag', attrs: { name: m[1] } });
    else if (m[2] != null) content.push({ type: 'noteLink',   attrs: { name: m[2] } });
    else if (m[3] != null) content.push({ type: 'projectTag', attrs: { name: m[3].toLowerCase() } });
    last = m.index + m[0].length;
  }
  if (last < line.length) content.push({ type: 'text', text: line.slice(last) });
  return content;
}

export function textToContent(text) {
  if (!text) return [{ type: 'paragraph' }];
  return text.split('\n').map(line => {
    const imgM = line.match(/^\[img:(https?:\/\/[^\]]+)\]$/);
    if (imgM) return { type: 'imageBlock', attrs: { src: imgM[1] } };
    const content = parseLineContent(line);
    return { type: 'paragraph', content: content.length ? content : undefined };
  });
}

// ── Slash command suggestion ──────────────────────────────────────────────────
// Triggers on /p (project) or /n (note) when preceded by whitespace or line start.
// Safe against: URLs (https://), fractions (1/2), bare slash (/ ), unknown commands (/x).
//
// Query format passed to itemsFn: "p" | "p query" | "n" | "n query"
// Item format returned:  "__project__:name" | "__note__:name" | "__create__:name"

function makeSlashSuggestionMatch() {
  return function({ $position }) {
    const nodeBefore = $position.nodeBefore;
    if (!nodeBefore?.isText) return null;
    const nodeText  = nodeBefore.text;
    const nodeStart = $position.pos - nodeBefore.nodeSize;

    // Scan backward for /p or /n preceded by whitespace or at paragraph start
    for (let i = nodeText.length - 1; i >= 0; i--) {
      if (nodeText[i] !== '/') continue;
      const prev = i > 0 ? nodeText[i - 1] : ' ';
      if (!/\s/.test(prev) && i !== 0) continue; // require space-before or line start
      const after = nodeText.slice(i + 1);
      if (!/^[pn]/i.test(after)) continue;        // require p or n immediately after /
      return {
        range: { from: nodeStart + i, to: $position.pos },
        query: after,           // e.g. "p", "p big think", "n", "n my note"
        text:  '/' + after,
      };
    }
    return null;
  };
}

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
        findSuggestionMatch: makeSlashSuggestionMatch(),
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
  // Compute position synchronously on every render from the live clientRect —
  // avoids the one-frame-late flash that useEffect+setState caused.
  if (!state?.items.length || typeof document === 'undefined') return null;
  // clientRect() returns a live DOMRect from the caret position — viewport-relative,
  // correct for position:fixed. Returns null when editor isn't mounted or has no selection.
  const rect = state.clientRect?.();
  if (!rect || (rect.top === 0 && rect.left === 0)) return null;
  const MENU_W = 290;
  const itemH = 36;
  const MENU_H = Math.min(240, state.items.length * itemH + 8);
  // Use visualViewport height when available — on mobile this reflects the actual
  // visible area above the software keyboard. window.innerHeight includes the
  // area behind the keyboard, causing the dropdown to be placed off-screen.
  const vvH = (typeof window !== 'undefined' && window.visualViewport)
    ? window.visualViewport.height
    : window.innerHeight;
  const spaceBelow = vvH - rect.bottom - 8;
  // Always prefer showing above the caret on mobile (safer for keyboard clearance)
  const top = spaceBelow >= MENU_H
    ? rect.bottom + 6
    : Math.max(8, rect.top - MENU_H - 6);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8));

  return createPortal(
    <div style={{
      position: 'fixed', top, left, zIndex: 9999,
      background: 'var(--dl-surface)', border: '1px solid var(--dl-border)', borderRadius: 10,
      boxShadow: 'var(--dl-shadow)',
      padding: '4px 0', minWidth: 180, maxWidth: 300, maxHeight: 240, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isExistingProject  = item.startsWith('__project__:');
        const isNewProject       = item.startsWith('__create_project__:');
        const isProject          = isExistingProject || isNewProject;
        const isCreate           = item.startsWith('__create__:') || isNewProject;
        const rawLabel           = isNewProject ? item.slice(19)
                                 : isExistingProject ? item.slice(12)
                                 : item.startsWith('__create__:') ? item.slice(11)
                                 : item.slice(9); // __note__: = 9
        const label              = isCreate ? `+ Create "${rawLabel}"` : isProject ? rawLabel.toUpperCase() : rawLabel;
        const col                = isProject ? projectColor(rawLabel) : null;
        const selected  = i === state.selectedIndex;
        return (
          <button
            key={i}
            onMouseDown={e => { e.preventDefault(); onSelect(item); }}
            onMouseEnter={() => state.setIndex(i)}
            style={{
              display: 'block', width: '100%', border: 'none', textAlign: 'left',
              padding: '7px 14px', cursor: 'pointer',
              background: selected ? 'var(--dl-border)' : 'transparent',
              fontFamily: mono, fontSize: 12,
              letterSpacing: isProject && !isCreate ? '0.08em' : '0.04em',
              color: isCreate ? 'var(--dl-muted)' : col || 'var(--dl-text)',
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
// The single editing primitive for Day Lab.
//
// Slash commands:
//   /p <query>  →  insert {project} chip   (@ was previous trigger)
//   /n <query>  →  insert [note] chip      (# was previous trigger)
//   Trigger requires a space before / (or line start). /p and /n must be
//   the immediate chars after /. Bare /, /x, URLs, fractions — no trigger.
//
// Props:
//   value, onBlur, onEnterCommit, onEnterSplit, onBackspaceEmpty
//   onImageUpload, noteNames, projectNames
//   onProjectClick, onNoteClick
//   placeholder, singleLine, autoFocus
//   style, color, textColor, mutedColor, editable

export const DayLabEditor = forwardRef(function DayLabEditor({
  value,
  onBlur,
  onEnterCommit,
  onEnterSplit,
  onBackspaceEmpty,
  onImageUpload,
  noteNames,
  projectNames,
  onProjectClick,
  onNoteClick,
  onCreateNote,      // (name, {silent}) — called when /n creates a new note
  onCreateProject,   // (name) — called when /p creates a new project
  placeholder,
  singleLine   = false,
  taskList     = false,
  autoFocus    = false,
  style,
  color        = ACCENT,
  textColor,
  mutedColor,
  editable     = true,
  onUpdate,
}, ref) {
  useEffect(injectEditorStyles, []);

  // Stable refs — avoid stale closures in TipTap plugins
  const editorRef           = useRef(null);
  const lastExternalValue   = useRef(value);
  const onBlurRef           = useRef(onBlur);
  const onEnterCommitRef    = useRef(onEnterCommit);
  const onEnterSplitRef     = useRef(onEnterSplit);
  const onBackspaceEmptyRef = useRef(onBackspaceEmpty);
  const onImageUploadRef    = useRef(onImageUpload);
  const noteNamesRef        = useRef(noteNames || []);
  const projectNamesRef     = useRef(projectNames || []);
  const onProjectClickRef   = useRef(onProjectClick);
  const onNoteClickRef      = useRef(onNoteClick);
  const onCreateNoteRef     = useRef(onCreateNote);
  const onCreateProjectRef  = useRef(onCreateProject);
  const onUpdateRef         = useRef(onUpdate);
  const taskListRef         = useRef(taskList);

  useEffect(() => { onBlurRef.current           = onBlur; },           [onBlur]);
  useEffect(() => { onEnterCommitRef.current     = onEnterCommit; },    [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current      = onEnterSplit; },     [onEnterSplit]);
  useEffect(() => { onBackspaceEmptyRef.current  = onBackspaceEmpty; }, [onBackspaceEmpty]);
  useEffect(() => { onImageUploadRef.current     = onImageUpload; },    [onImageUpload]);
  useEffect(() => { noteNamesRef.current         = noteNames || []; },  [noteNames]);
  useEffect(() => { projectNamesRef.current      = projectNames || []; }, [projectNames]);
  useEffect(() => { onProjectClickRef.current    = onProjectClick; },   [onProjectClick]);
  useEffect(() => { onNoteClickRef.current       = onNoteClick; },      [onNoteClick]);
  useEffect(() => { onCreateNoteRef.current      = onCreateNote; },     [onCreateNote]);
  useEffect(() => { onCreateProjectRef.current   = onCreateProject; },  [onCreateProject]);
  useEffect(() => { onUpdateRef.current          = onUpdate; },         [onUpdate]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.commands.focus('end'),
  }), []); // eslint-disable-line

  // Suggestion state — suggRef kept in sync synchronously so handleKeyDown
  // can read the current state in the same event tick (useState is async).
  const [sugg, setSugg] = useState(null);
  const suggRef = useRef(null);
  // Blocks handleClick for 150ms after chip insertion so the trailing mouse-click
  // event (from dropdown selection) does not immediately navigate away.
  const justInsertedRef = useRef(false);

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
  mutedColor = mutedColor || 'var(--dl-muted)';

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
      ...(taskList ? [TaskList, TaskItem.configure({ nested: false })] : []),

      Placeholder.configure({ placeholder: placeholder || '', emptyEditorClass: 'is-empty' }),

      // Unified slash command: /p → project chip, /n → note chip
      createSuggestion({
        char: '/',
        suggKey: 'slash',
        renderRef,
        itemsFn: (query) => {
          const cmd    = query[0]?.toLowerCase();              // 'p' or 'n'
          const search = query.slice(1).replace(/^\s+/, '');  // text after /p or /n

          if (cmd === 'p') {
            const q      = search.toLowerCase().replace(/\s/g, '');
            const qTrim  = search.trim();
            const names  = projectNamesRef.current || [];
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__project__:${n}`);
            // Allow creating a new project that doesn't exist yet
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create_project__:${qTrim}`);
            }
            return matches;
          }
          if (cmd === 'n') {
            const names   = noteNamesRef.current || [];
            const q       = search.toLowerCase().replace(/\s/g, '');
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__note__:${n}`);
            const qTrim = search.trim();
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create__:${qTrim}`);
            }
            return matches;
          }
          return [];
        },
        commandFn: ({ editor, range, name }) => {
          justInsertedRef.current = true;
          setTimeout(() => { justInsertedRef.current = false; }, 150);

          if (name.startsWith('__project__:') || name.startsWith('__create_project__:')) {
            // Existing project: "__project__:name"  |  New project: "__create_project__:name"
            const isNew = name.startsWith('__create_project__:');
            const pName = (isNew ? name.slice(19) : name.slice(12)).toLowerCase();
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'projectTag', attrs: { name: pName } },
              { type: 'text', text: ' ' },
            ]).run();
            if (isNew) {
              window.dispatchEvent(new CustomEvent('daylab:create-project', { detail: { name: pName } }));
              onCreateProjectRef.current?.(pName);
            }
          } else {
            // Note chip: "__note__:name" (existing) or "__create__:name" (new)
            const noteName = name.startsWith('__create__:') ? name.slice(11) : name.slice(9); // __note__: = 9 (7+prefix)
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'noteLink', attrs: { name: noteName } },
              { type: 'text', text: ' ' },
            ]).run();
            if (name.startsWith('__create__:')) {
              onCreateNoteRef.current?.(noteName, { silent: true });
              window.dispatchEvent(new CustomEvent('daylab:create-note', { detail: { name: noteName } }));
            }
          }
        },
      }),
    ],

    content: taskList ? (value || '') : { type: 'doc', content: textToContent(value || '') },
    editable,

    editorProps: {
      handleClick(view, pos, event) {
        // Skip navigation if a chip was just inserted (dropdown mouse-click leaks a click event)
        if (justInsertedRef.current) return false;
        const t = event.target;
        const projectEl = t.closest?.('[data-project-tag]');
        if (projectEl && onProjectClickRef.current) {
          // Flush editor content BEFORE navigating. Chip clicks stay inside the editor,
          // so TipTap's onBlur never fires. Without this explicit flush the useDbSave
          // 200ms debounce timer never executes and the entry is lost on unmount.
          if (onBlurRef.current && editorRef.current) {
            const serialised = docToText(editorRef.current.getJSON());
            // Call onBlur synchronously — this writes to MEM and starts the 200ms
            // debounce timer. We then also fire a synthetic blur on the DOM element
            // so any outer focus-tracking (useDbSave DIRTY flag etc.) sees the blur.
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onProjectClickRef.current(projectEl.getAttribute('data-project-tag'));
          return true;
        }
        const noteEl = t.closest?.('[data-note-link]');
        if (noteEl && onNoteClickRef.current) {
          // Same flush before navigating to a note
          if (onBlurRef.current && editorRef.current) {
            const serialised = docToText(editorRef.current.getJSON());
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onNoteClickRef.current(noteEl.getAttribute('data-note-link'));
          return true;
        }
        return false;
      },

      handleKeyDown(view, e) {
        // Defer to suggestion plugin when dropdown is open
        if (suggRef.current && (e.key === 'Enter' || e.key === 'Tab')) return false;

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
            const para   = view.state.doc.child(0);
            const offset = Math.max(0, Math.min(from - 1, para.content.size));
            const before = docToText({ type: 'doc', content: [{ type: 'paragraph', content: para.content.cut(0, offset).toJSON() ?? [] }] });
            const after  = docToText({ type: 'doc', content: [{ type: 'paragraph', content: para.content.cut(offset).toJSON()  ?? [] }] });
            onEnterSplitRef.current({ before, after });
          }
          return true;
        }
        if (e.key === 'Backspace' && taskListRef.current) {
          const { selection } = view.state;
          // Prevent deleting the first task item — cursor at start of first task's paragraph (pos ≤ 3)
          if (selection.empty && selection.$from.pos <= 3) return true;
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
      if (!taskListRef.current) onBlurRef.current?.(docToText(editor.getJSON()));
    },

    onUpdate({ editor }) {
      if (taskListRef.current) onUpdateRef.current?.(editor.getHTML());
    },
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    const id = setTimeout(() => editor.commands.focus('end'), 0);
    return () => clearTimeout(id);
  }, [editor, autoFocus]);

  // ── Unmount flush — save editor content before React destroys this instance.
  // When a chip click triggers navigation (setActiveProject), React unmounts the
  // editor synchronously. TipTap destroys its editor in a useEffect cleanup which
  // runs BEFORE the DOM is removed in React 18, so the native blur event never fires
  // and the last unsaved text is silently dropped.
  // Fix: explicitly flush on unmount via a cleanup with an empty deps array.
  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      try {
        if (taskListRef.current) {
          onUpdateRef.current?.(ed.getHTML());
        } else if (onBlurRef.current) {
          onBlurRef.current(docToText(ed.getJSON()));
        }
      } catch (_) { /* editor already destroyed — ignore */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture-phase Backspace for empty singleLine rows
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

  // Sync externally-driven value changes (only when editor not focused)
  useEffect(() => {
    if (!editor || value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    if (!editor.isFocused) {
      if (taskList) {
        editor.commands.setContent(value || '');
      } else {
        editor.commands.setContent({ type: 'doc', content: textToContent(value || '') });
      }
    }
  }, [value, editor]); // eslint-disable-line

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

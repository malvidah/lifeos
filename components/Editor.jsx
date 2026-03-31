'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Extension, Node, Mark } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';
import {
  useEffect, useLayoutEffect, useRef, useState,
  forwardRef, useImperativeHandle,
} from 'react';
import { createPortal } from 'react-dom';
import { Suggestion } from '@tiptap/suggestion';
import { serif, mono, F, projectColor, CHIP_TOKENS } from '@/lib/tokens';
import { generateDateSuggestions, dateChipColor, MONTHS_SHORT } from '@/lib/dates';
import { getRecurrenceSuggestions } from '@/lib/recurrence';
import { useTip } from '@/lib/useTip';
import Tip from './ui/Tip.jsx';

const ACCENT = '#D08828'; // must match --dl-accent; used for CSS alpha concatenation only
const WARM   = 'var(--dl-accent)';
const EMPTY_TASK_LIST = '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
// ── CSS injection ─────────────────────────────────────────────────────────────
function injectEditorStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('daylab-editor-styles')) return;
  const s = document.createElement('style');
  s.id = 'daylab-editor-styles';
  s.textContent = `
    .dl-editor .ProseMirror { outline: none; white-space: pre-wrap; word-break: break-word; min-height: 1.7em; }
    .dl-editor .ProseMirror p { margin: 0; padding: 0; }
    .dl-editor .ProseMirror > p:only-child.is-empty::before { content: attr(data-placeholder); pointer-events: none; float: left; height: 0; color: var(--dl-middle); }
    .dl-editor .ProseMirror h1.is-empty::before { content: attr(data-placeholder); pointer-events: none; float: left; height: 0; color: var(--dl-middle); font-weight: 400; }
    .dl-tasklist .ProseMirror ul[data-type="taskList"] li > div > p.is-empty::before { content: none !important; }
    .dl-tasklist .ProseMirror ul[data-type="taskList"] > li:only-child > div > p.is-empty::before { content: attr(data-placeholder) !important; pointer-events: none; float: left; height: 0; color: var(--dl-middle); font-style: normal; opacity: 0.6; }
    .dl-tasklist .ProseMirror ul + p:last-child { display: none; }
    .dl-editor .ProseMirror h1 { font-family: ${mono}; font-size: 0.8em; font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px; padding: 0; }
    .dl-editor .ProseMirror a[href] { color: var(--dl-accent) !important; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .dl-editor .ProseMirror a[href]:visited { color: var(--dl-accent) !important; }
    .dl-editor .ProseMirror-selectednode img { outline: 2px solid ${ACCENT}; border-radius: 8px; }
    .dl-editor .ProseMirror .ProseMirror-selectednode { outline: 2px solid ${ACCENT}55; outline-offset: 1px; border-radius: 999px; }
    .dl-hide-images .ProseMirror div[data-imageblock] { display: none; }
    .dl-editor .ProseMirror { counter-reset: imgchip; }
    .dl-img-chip-num::before { content: counter(imgchip); }
    .dl-editor .ProseMirror table { border-collapse: collapse; width: 100% !important; margin: 8px 0; table-layout: auto; min-width: 100% !important; }
    .dl-editor .ProseMirror .tableWrapper { overflow-x: auto; margin: 8px 0; }
    .dl-editor .ProseMirror .column-resize-handle { position: absolute; right: -1px; top: 0; bottom: 0; width: 3px; background: var(--dl-accent); opacity: 0; pointer-events: none; cursor: col-resize; }
    .dl-editor .ProseMirror .resize-cursor { cursor: col-resize; }
    .dl-editor .ProseMirror td:hover .column-resize-handle,
    .dl-editor .ProseMirror th:hover .column-resize-handle { opacity: 0.5; pointer-events: auto; }
    .dl-editor .ProseMirror th,
    .dl-editor .ProseMirror td {
      border-bottom: 1px solid var(--dl-border);
      border-right: 1px solid var(--dl-border);
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
      font-size: inherit;
      line-height: 1.5;
    }
    .dl-editor .ProseMirror th {
      font-family: ${mono};
      font-size: 0.85em;
      letter-spacing: 0.04em;
      color: var(--dl-highlight);
      font-weight: 400;
      text-transform: uppercase;
      border-bottom: 1px solid var(--dl-border2);
    }
    .dl-editor .ProseMirror td { color: var(--dl-strong); }
    .dl-editor .ProseMirror tr:last-child td { border-bottom: none; }
    .dl-editor .ProseMirror td:last-child,
    .dl-editor .ProseMirror th:last-child { border-right: none; }
    .dl-editor .ProseMirror .selectedCell { background: var(--dl-accent-10); }
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
    }, '\u26F0\uFE0F ' + name.toUpperCase()];
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

// PlaceTag: stored as <span data-place-tag="name">, rendered as blue pin chip.
const PlaceTagNode = Node.create({
  name: 'placeTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() { return { name: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'span[data-place-tag]', getAttrs: el => ({ name: el.getAttribute('data-place-tag') || '' }) }];
  },
  renderHTML({ node }) {
    const name = node.attrs.name || '';
    return ['span', {
      'data-place-tag': name,
      style: Object.entries({ ...CHIP_TOKENS.place, cursor: 'pointer', userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
    }, '\u{1F4CD} ' + name.toUpperCase()];
  },
});

// DateTag: stored as @YYYY-MM-DD, rendered as urgency-colored chip.
const DateTagNode = Node.create({
  name: 'dateTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() { return { date: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'span[data-date-tag]', getAttrs: el => ({ date: el.getAttribute('data-date-tag') || '' }) }];
  },
  renderHTML({ node }) {
    const date = node.attrs.date || '';
    const col  = dateChipColor(date);
    const d    = new Date(date + 'T12:00:00');
    const label = MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
    return ['span', {
      'data-date-tag': date,
      style: Object.entries({ ...CHIP_TOKENS.date(col), userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
    }, '\u{23F3} ' + label];
  },
});

// ImageChip: inline atom node displayed as a small pill in text flow.
// Source of truth for the photos section — deleting a chip removes the image.
// Shows "📷 Mar 16 · 1" with auto-numbering via CSS counter.
// onImageDeleteRef is set by DayLabEditor to call the orphan-cleanup API.
let onImageDeleteRef = { current: null };
const ImageChip = Node.create({
  name: 'imageChip', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: el => el.getAttribute('data-image-chip'),
      },
      label: {
        default: '',
        parseHTML: el => el.getAttribute('data-chip-label') || '',
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-image-chip]' }]; },
  renderHTML({ node }) {
    return ['span', {
      'data-image-chip': node.attrs.src,
      'data-chip-label': node.attrs.label,
      class: 'dl-img-chip',
      style: [
        'display:inline-flex', 'align-items:center', 'gap:3px',
        'vertical-align:middle',
        'background:var(--dl-border)', 'border-radius:4px',
        'padding:1px 7px', 'font-family:var(--dl-mono,' + mono + ')',
        'font-size:11px', 'letter-spacing:0.04em', 'line-height:1.65',
        'color:var(--dl-highlight)', 'white-space:nowrap', 'cursor:pointer',
        'user-select:none', 'flex-shrink:0',
        'counter-increment:imgchip',
      ].join(';'),
    },
      ['span', { style: 'pointer-events:none' }, '\u{1F4F7}'],
      ['span', { class: 'dl-img-chip-label', style: 'pointer-events:none' },
        node.attrs.label ? ` ${node.attrs.label} \u00B7 ` : ' \u00B7 ',
      ],
      ['span', { class: 'dl-img-chip-num', style: 'pointer-events:none' }],
    ];
  },
  addKeyboardShortcuts() {
    const del = () => {
      const sel = this.editor.state.selection;
      if (sel?.node?.type.name === 'imageChip') {
        const src = sel.node.attrs.src;
        this.editor.commands.deleteSelection();
        if (src && onImageDeleteRef.current) onImageDeleteRef.current(src);
        return true;
      }
      return false;
    };
    return { Backspace: del, Delete: del };
  },
});

// RecurrenceTag: stored as {r:key:label}, rendered as M·W·F chip (date tag style).
const RecurrenceTagNode = Node.create({
  name: 'recurrenceTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      key: { default: '' },
      label: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-recurrence]', getAttrs: el => ({
      key: el.getAttribute('data-recurrence') || '',
      label: el.getAttribute('data-recurrence-label') || el.textContent || '',
    }) }];
  },
  renderHTML({ node }) {
    const label = node.attrs.label || node.attrs.key || '';
    const col = 'var(--dl-green, #4A9A68)';
    return ['span', {
      'data-recurrence': node.attrs.key,
      'data-recurrence-label': label,
      style: Object.entries({ ...CHIP_TOKENS.date(col), userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
    }, '\u21BB ' + label];
  },
});

// HabitTag: stored as {h:key:label} or {h:key:label:count}, rendered as 🎯 M·W·F chip.
// Similar to RecurrenceTag but implies the task shows in the Habits card.
// Optional count attribute for count-limited habits (e.g. "do this 10 times").
const HabitTagNode = Node.create({
  name: 'habitTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      key: { default: '' },
      label: { default: '' },
      count: { default: null },
      days: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-habit]', getAttrs: el => ({
      key: el.getAttribute('data-habit') || '',
      label: el.getAttribute('data-habit-label') || el.textContent || '',
      count: el.getAttribute('data-habit-count') ? parseInt(el.getAttribute('data-habit-count'), 10) : null,
      days: el.getAttribute('data-habit-days') ? parseInt(el.getAttribute('data-habit-days'), 10) : null,
    }) }];
  },
  renderHTML({ node }) {
    const label = node.attrs.label || node.attrs.key || '';
    const count = node.attrs.count;
    const days = node.attrs.days;
    const displayLabel = count ? `${label} ×${count}` : days ? `${label} ${days}d` : label;
    const col = 'var(--dl-accent, #D08828)';
    const attrs = {
      'data-habit': node.attrs.key,
      'data-habit-label': label,
      style: Object.entries({ ...CHIP_TOKENS.date(col), userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
    };
    if (count) attrs['data-habit-count'] = String(count);
    if (days) attrs['data-habit-days'] = String(days);
    return ['span', attrs, '\u{1F3AF} ' + displayLabel];
  },
});

// GoalTag: stored as {g:name}, rendered as 🏁 NAME chip.
const GoalTagNode = Node.create({
  name: 'goalTag', group: 'inline', inline: true,
  atom: true, selectable: true, draggable: false,
  addAttributes() { return { name: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'span[data-goal]', getAttrs: el => ({ name: el.getAttribute('data-goal') || '' }) }];
  },
  renderHTML({ node }) {
    const name = node.attrs.name || '';
    const col = 'var(--dl-teal, #5BA89D)';
    return ['span', {
      'data-goal': name,
      style: Object.entries({ ...CHIP_TOKENS.project(col), cursor: 'pointer', userSelect: 'none' })
        .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
        .join(';'),
    }, '\u{1F3C1} ' + name.toUpperCase()];
  },
});

// ImageBlock: stored as [img:url], rendered as block image atom node.
const ImageBlock = Node.create({
  name: 'imageBlock', group: 'block', atom: true, selectable: true, draggable: false,
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: el => el.getAttribute('data-imageblock'),
      },
    };
  },
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
const URL_RE = /(?<!\[img:)(https?:\/\/[^\s<>"')[  \]]+)/g;
const URLExtension = Extension.create({
  name: 'urlDecoration',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('urlDecoration'),
      props: {
        decorations(state) {
          const decos = [];
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            let m; URL_RE.lastIndex = 0;
            while ((m = URL_RE.exec(node.text)) !== null) {
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                nodeName: 'span',
                'data-href': m[0],
                class: 'dl-url-link',
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

// ── HyperlinkMark: stored as [display text](url), rendered as <a> ────────────
// Allows display text to differ from the URL (e.g. "Cauliflower Recipe" → href).
// Bare https:// URLs with no custom display text still use the URLExtension
// decoration so the storage format stays as plain URL text.
const HyperlinkMark = Mark.create({
  name: 'hyperlink',
  addAttributes() {
    return { href: { default: null } };
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', {
      href: HTMLAttributes.href,
      target: '_blank',
      rel: 'noreferrer noopener',
      class: 'dl-hyperlink',
      style: `color:${WARM};text-decoration:underline;text-underline-offset:2px;cursor:pointer`,
    }, 0];
  },
  parseHTML() {
    return [{ tag: 'a.dl-hyperlink[href]', getAttrs: el => ({ href: el.getAttribute('href') }) }];
  },
});

// ── Format toolbar (appears on text selection in noteTitle mode) ──────────────
function FormatToolbar({ editor }) {
  const [pos, setPos] = useState(null);
  const toolbarRef = useRef(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || !editor.isFocused) { setPos(null); return; }
      const coords = editor.view.coordsAtPos(from);
      const endCoords = editor.view.coordsAtPos(to);
      const editorRect = editor.view.dom.getBoundingClientRect();
      setPos({
        top: coords.top - editorRect.top - 38,
        left: (coords.left + endCoords.left) / 2 - editorRect.left,
      });
    };
    editor.on('selectionUpdate', update);
    editor.on('blur', () => setPos(null));
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('blur', () => setPos(null));
    };
  }, [editor]);

  if (!pos || !editor) return null;

  const btn = (label, cmd, isActive) => (
    <button
      key={label}
      onMouseDown={e => { e.preventDefault(); cmd(); }}
      style={{
        background: isActive ? 'var(--dl-accent-20, rgba(208,136,40,0.2))' : 'transparent',
        border: 'none', cursor: 'pointer', borderRadius: 4,
        padding: '2px 7px', fontFamily: serif, fontSize: 13,
        color: 'var(--dl-strong)', lineHeight: 1.4,
        fontWeight: label === 'B' ? 700 : 400,
        fontStyle: label === 'I' ? 'italic' : 'normal',
        textDecoration: label === 'U' ? 'underline' : 'none',
      }}
    >{label}</button>
  );

  return (
    <div ref={toolbarRef} style={{
      position: 'absolute', top: pos.top, left: pos.left, transform: 'translateX(-50%)',
      display: 'flex', gap: 2, padding: '3px 4px',
      background: 'var(--dl-card, #1a1a1a)', border: '1px solid var(--dl-border)',
      borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: 50, whiteSpace: 'nowrap',
    }}>
      {btn('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
      {btn('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
      {btn('U', () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
      {(() => {
        // Check if selection contains a URL
        const { from, to } = editor.state.selection;
        const text = editor.state.doc.textBetween(from, to, ' ');
        const urlMatch = text.match(/https?:\/\/[^\s<>"')\[\]]+/);
        if (!urlMatch) return null;
        return btn('\u{1F517}', () => {
          // Find the link element in the DOM and trigger popover
          const domAtPos = editor.view.domAtPos(from);
          const container = domAtPos.node.nodeType === 1 ? domAtPos.node : domAtPos.node.parentElement;
          const linkEl = container?.closest('.dl-url-link') || container?.querySelector('.dl-url-link');
          if (linkEl) {
            const rect = linkEl.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent('daylab:link-click', {
              detail: { url: linkEl.getAttribute('data-href'), rect, pos: from, linkEl },
            }));
          }
        }, false);
      })()}
    </div>
  );
}

// ── Link popover ──────────────────────────────────────────────────────────────
// Three actions: Rename (change display text) | Edit URL | Remove link
// Works for both bare URL decorations and HyperlinkMark (display text ≠ URL).
function LinkPopover({ editor }) {
  const [state, setState]       = useState(null); // { url, displayText, rect, linkEl, isHyperlink }
  const [editMode, setEditMode] = useState(null); // null | 'rename' | 'editurl'
  const [draft, setDraft]       = useState('');
  const popRef   = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      const { url, displayText, rect, pos, linkEl, isHyperlink } = e.detail;
      setState({ url, displayText: displayText || url, rect, pos, linkEl, isHyperlink: !!isHyperlink });
      setEditMode(null);
      setDraft('');
    };
    window.addEventListener('daylab:link-click', handler);
    return () => window.removeEventListener('daylab:link-click', handler);
  }, []);

  // Close on outside click; skip scroll-close while editing (editor reflow fires scroll)
  useEffect(() => {
    if (!state) return;
    const close = (e) => { if (!popRef.current?.contains(e.target)) setState(null); };
    const closeScroll = () => { if (!editMode) setState(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeScroll, true);
    };
  }, [state, editMode]);

  useEffect(() => {
    if (editMode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editMode]);

  if (!state) return null;

  const { url, displayText, rect, linkEl, isHyperlink } = state;
  const top  = rect.bottom + 6;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 300));

  // Locate the link range in the document for editing.
  const findRange = () => {
    if (!editor || !linkEl) return null;
    const view = editor.view;
    if (isHyperlink) {
      let found = null;
      view.state.doc.descendants((node, pos) => {
        if (found || !node.isText) return;
        if (node.marks.some(mk => mk.type.name === 'hyperlink' && mk.attrs.href === url)
            && node.text === displayText) {
          found = { from: pos, to: pos + node.nodeSize };
        }
      });
      return found;
    }
    const linkText = linkEl.textContent;
    let found = null;
    view.state.doc.descendants((node, pos) => {
      if (found || !node.isText) return;
      const idx = node.text.indexOf(linkText);
      if (idx >= 0) found = { from: pos + idx, to: pos + idx + linkText.length };
    });
    return found;
  };

  const handleRename = () => {
    const range = findRange();
    if (!range || !editor) { setState(null); return; }
    const newText = draft.trim();
    if (!newText) { setEditMode(null); return; }
    // Both bare-URL and hyperlink: replace the text, apply/keep the hyperlink mark
    editor.chain().focus()
      .deleteRange(range)
      .insertContentAt(range.from, { type: 'text', text: newText, marks: [{ type: 'hyperlink', attrs: { href: url } }] })
      .run();
    setState(null);
  };

  const handleEditUrl = () => {
    const range = findRange();
    if (!range || !editor) { setState(null); return; }
    const newUrl = draft.trim();
    if (!newUrl) { setEditMode(null); return; }
    if (isHyperlink) {
      editor.chain().focus()
        .setTextSelection(range)
        .unsetMark('hyperlink')
        .setMark('hyperlink', { href: newUrl })
        .run();
    } else {
      // Bare URL: replace the URL text with the new URL text
      editor.chain().focus()
        .deleteRange(range)
        .insertContentAt(range.from, newUrl)
        .run();
    }
    setState(null);
  };

  const handleRemove = () => {
    const range = findRange();
    if (!range || !editor) { setState(null); return; }
    if (isHyperlink) {
      // Remove the mark, keep the display text
      editor.chain().focus().setTextSelection(range).unsetMark('hyperlink').run();
    } else {
      // Bare URL: delete the text entirely
      editor.chain().focus().deleteRange(range).run();
    }
    setState(null);
  };

  const popStyle = {
    position: 'fixed', top, left, zIndex: 9999,
    background: 'var(--dl-surface)', border: '1px solid var(--dl-border)',
    borderRadius: 8, boxShadow: 'var(--dl-shadow)', padding: '5px 8px',
    display: 'flex', alignItems: 'center', gap: 2,
  };
  const btnBase = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '3px 7px', borderRadius: 4, fontSize: 11, fontFamily: mono,
    color: 'var(--dl-muted)', letterSpacing: '0.03em', whiteSpace: 'nowrap',
  };
  const inputStyle = {
    flex: 1, minWidth: 150, background: 'var(--dl-bg, #000)',
    border: '1px solid var(--dl-border)', borderRadius: 5,
    padding: '3px 7px', fontSize: 11, fontFamily: mono,
    color: 'var(--dl-strong)', outline: 'none',
  };
  const divider = <span style={{ width: 1, height: 11, background: 'var(--dl-border)', flexShrink: 0, margin: '0 2px' }} />;

  const Btn = ({ label, onAct, danger }) => (
    <button
      onMouseDown={e => { e.preventDefault(); onAct(); }}
      style={{ ...btnBase, ...(danger ? { color: 'var(--dl-red, #c44)' } : {}) }}
      onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
      onMouseLeave={e => e.currentTarget.style.color = danger ? 'var(--dl-red, #c44)' : 'var(--dl-muted)'}
    >{label}</button>
  );

  const onKey = (e, saveFn) => {
    if (e.key === 'Enter')  { e.preventDefault(); saveFn(); }
    if (e.key === 'Escape') { e.preventDefault(); setEditMode(null); }
  };

  if (editMode) {
    const isRename = editMode === 'rename';
    const label    = isRename ? 'name' : 'url';
    const saveFn   = isRename ? handleRename : handleEditUrl;
    return createPortal(
      <div ref={popRef} onMouseDown={e => e.stopPropagation()} style={popStyle}>
        <span style={{ fontSize: 10, fontFamily: mono, color: 'var(--dl-muted)', paddingRight: 4, flexShrink: 0 }}>{label}</span>
        <input
          ref={inputRef}
          value={draft}
          placeholder={isRename ? displayText : url}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => onKey(e, saveFn)}
          style={inputStyle}
        />
        <button
          onMouseDown={e => { e.preventDefault(); saveFn(); }}
          style={{ ...btnBase, color: 'var(--dl-accent)', fontWeight: 600, paddingLeft: 8 }}
        >Save</button>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div ref={popRef} onMouseDown={e => e.stopPropagation()} style={popStyle}>
      <Btn label="Rename"   onAct={() => { setDraft(isHyperlink ? displayText : ''); setEditMode('rename'); }} />
      {divider}
      <Btn label="Edit URL" onAct={() => { setDraft(url); setEditMode('editurl'); }} />
      {divider}
      <Btn label="Remove"   onAct={handleRemove} danger />
    </div>,
    document.body
  );
}

// ── Serialisation ─────────────────────────────────────────────────────────────
// Storage format (plain text):
//   projectTag → {projectname}
//   noteLink   → [note name]
//   imageBlock → [img:url]  (its own paragraph line)
//   paragraphs → joined with \n

export function docToText(docJson) {
  function walkInline(nodes) {
    return (nodes || []).map(c => {
      if (c.type === 'text') {
        const linkMark = c.marks?.find(mk => mk.type === 'hyperlink');
        if (linkMark) return `[${c.text ?? ''}](${linkMark.attrs?.href ?? ''})`;
        return c.text ?? '';
      }
      if (c.type === 'hardBreak')   return '\n';
      if (c.type === 'projectTag')  return `{${c.attrs?.name ?? ''}}`;
      if (c.type === 'placeTag')    return `{l:${c.attrs?.name ?? ''}}`;
      if (c.type === 'noteLink')    return `[${c.attrs?.name ?? ''}]`;
      if (c.type === 'recurrenceTag') return `{r:${c.attrs?.key ?? ''}:${c.attrs?.label ?? ''}}`;
      if (c.type === 'dateTag')    return `@${c.attrs?.date ?? ''}`;
      if (c.type === 'habitTag') {
        const base = `{h:${c.attrs?.key ?? ''}:${c.attrs?.label ?? ''}}`;
        if (c.attrs?.days) return base.slice(0, -1) + `:${c.attrs.days}d}`;
        if (c.attrs?.count) return base.slice(0, -1) + `:${c.attrs.count}}`;
        return base;
      }
      if (c.type === 'goalTag')    return `{g:${c.attrs?.name ?? ''}}`;
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
  // Tokens: {project} | {l:place} | {r:key:label} | {h:key:label} | {g:name} |
  //         [text](url) hyperlink | [note] | @YYYY-MM-DD | legacy #Tag
  // Hyperlink [text](url) must come before [note] so the parser prefers it.
  const re = /\{h:([^:}]+):([^}]*)\}|\{r:([^:}]+):([^}]*)\}|\{l:([^}]+)\}|\{g:([^}]+)\}|\{([a-z0-9][a-z0-9 ]*[a-z0-9]|[a-z0-9])\}|\[([^\]]*)\]\((https?:\/\/[^)]*)\)|\[([^\]]+)\]|@(\d{4}-\d{2}-\d{2})|#([A-Za-z][A-Za-z0-9]+)/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) content.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1] != null) {
      // m[2] may be "label", "label:count", or "label:Nd" — split to extract optional count/days
      const hParts = m[2].split(':');
      const lastPart = hParts[hParts.length - 1];
      const isDays = hParts.length > 1 && /^\d+d$/i.test(lastPart);
      const isCount = hParts.length > 1 && /^\d+$/.test(lastPart);
      const hDays = isDays ? parseInt(lastPart, 10) : null;
      const hCount = isCount ? parseInt(lastPart, 10) : null;
      const hLabelClean = (isDays || isCount) ? hParts.slice(0, -1).join(':') : m[2];
      content.push({ type: 'habitTag', attrs: { key: m[1], label: hLabelClean, count: hCount, days: hDays } });
    }
    else if (m[3] != null) content.push({ type: 'recurrenceTag', attrs: { key: m[3], label: m[4] } });
    else if (m[5] != null) content.push({ type: 'placeTag',  attrs: { name: m[5] } });
    else if (m[6] != null) content.push({ type: 'goalTag',   attrs: { name: m[6] } });
    else if (m[7] != null) content.push({ type: 'projectTag', attrs: { name: m[7] } });
    else if (m[8] != null) content.push({ type: 'text', text: m[8], marks: [{ type: 'hyperlink', attrs: { href: m[9] } }] });
    else if (m[10] != null) content.push({ type: 'noteLink',  attrs: { name: m[10] } });
    else if (m[11] != null) content.push({ type: 'dateTag',   attrs: { date: m[11] } });
    else if (m[12] != null) content.push({ type: 'projectTag', attrs: { name: m[12].toLowerCase() } });
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

// Converts plain-text note content (title\nbody) or existing HTML to TipTap doc.
// First line becomes an H1; remaining lines become paragraphs.
function textToNoteContent(text) {
  if (!text) return { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [] }, { type: 'paragraph', content: [] }] };
  if (text.startsWith('<')) return text; // already HTML — let TipTap parse it
  const [title, ...body] = text.split('\n');
  const titleContent = parseLineContent(title || '');
  const bodyNodes = body.length
    ? body.map(line => { const c = parseLineContent(line); return { type: 'paragraph', content: c.length ? c : [] }; })
    : [{ type: 'paragraph', content: [] }];
  return { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: titleContent }, ...bodyNodes] };
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

    // Scan backward for / preceded by whitespace or at true paragraph start.
    // "True paragraph start" means the text node starts at the paragraph's first
    // content position — not just position 0 in its text, which could be right
    // after an inline chip (projectTag, dateChip, etc.) that left no whitespace.
    const paraStart = $position.start();
    for (let i = nodeText.length - 1; i >= 0; i--) {
      if (nodeText[i] !== '/') continue;
      if (i === 0) {
        // Only valid when this text node is the first content in the paragraph.
        // nodeStart > paraStart means something (e.g. a chip) precedes this node.
        if (nodeStart > paraStart) continue;
      } else {
        const prev = nodeText[i - 1];
        if (!/\s/.test(prev)) continue; // require space before /
      }
      const after = nodeText.slice(i + 1);
      // Match bare / (show command menu), /p, /n, /l, /@, /d, /r, /t...
      if (after.length > 0 && !/^[pnl@drhmgt]/i.test(after)) continue;
      return {
        range: { from: nodeStart + i, to: $position.pos },
        query: after,           // "" (bare /), "p", "p big think", "n", "n my note"
        text:  '/' + after,
      };
    }
    return null;
  };
}

function createSuggestion({ char, itemsFn, commandFn, renderRef, suggKey, findMatch }) {
  return Extension.create({
    name: `suggestion_${suggKey}`,
    addProseMirrorPlugins() {
      const editor = this.editor;
      const opts = {
        editor,
        char,
        allowSpaces: true,
        // Restrict # and @ triggers to space-only prefix so that URL fragments
        // like /#anchor or email addresses like user@host don't fire accidentally.
        // The / trigger uses a custom findSuggestionMatch so this has no effect on it.
        allowedPrefixes: [' '],
        pluginKey: new PluginKey(`suggestion_${suggKey}`),
        items: ({ query }) => itemsFn(query),
        command: ({ editor, range, props }) => commandFn({ editor, range, name: props }),
        render: () => ({
          onStart:   p => renderRef.current?.onStart?.(p,   suggKey),
          onUpdate:  p => renderRef.current?.onUpdate?.(p,  suggKey),
          onExit:    p => renderRef.current?.onExit?.(p,    suggKey),
          onKeyDown: p => renderRef.current?.onKeyDown?.(p, suggKey) ?? false,
        }),
      };
      if (findMatch) opts.findSuggestionMatch = findMatch;
      return [Suggestion(opts)];
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
    <div className="dl-suggestion-dropdown" style={{
      position: 'fixed', top, left, zIndex: 9999,
      background: 'var(--dl-surface)', border: '1px solid var(--dl-border)', borderRadius: 10,
      boxShadow: 'var(--dl-shadow)',
      padding: '4px 0', minWidth: 180, maxWidth: 300, maxHeight: 240, overflowY: 'auto',
    }}>
      {state.items.map((item, i) => {
        const isCmd              = item.startsWith('__cmd__:');
        const isDate             = item.startsWith('__date__:');
        const isRecurrence       = item.startsWith('__recurrence__:');
        const isHabit            = item.startsWith('__habit__:');
        const isTable            = item.startsWith('__table__:');
        const isExistingProject  = item.startsWith('__project__:');
        const isNewProject       = item.startsWith('__create_project__:');
        const isProject          = isExistingProject || isNewProject;
        const isExistingPlace    = item.startsWith('__place__:');
        const isNewPlace         = item.startsWith('__create_place__:');
        const isPlace            = isExistingPlace || isNewPlace;
        const isExistingGoal     = item.startsWith('__goal__:');
        const isNewGoal          = item.startsWith('__create_goal__:');
        const isGoal             = isExistingGoal || isNewGoal;
        const isCreate           = item.startsWith('__create__:') || isNewProject || isNewPlace || isNewGoal;
        const rawLabel           = isCmd ? item.slice(8)
                                 : isDate ? item.slice(20)
                                 : (isRecurrence || isHabit) ? item.split(':').slice(2).join(':')
                                 : isTable ? item.slice(9)   // "3:3"
                                 : isNewProject ? item.slice(19)
                                 : isExistingProject ? item.slice(12)
                                 : isNewPlace ? item.slice(16)
                                 : isExistingPlace ? item.slice(10)
                                 : isNewGoal ? item.slice(16)
                                 : isExistingGoal ? item.slice(9)
                                 : item.startsWith('__create__:') ? item.slice(11)
                                 : item.slice(9);
        const dateStr            = isDate ? item.slice(9, 19) : null;
        const label              = isCmd ? (rawLabel === 'p' ? '/p  Project' : rawLabel === 'n' ? '/n  Note' : rawLabel === 'l' ? '/l  Location' : rawLabel === '@' ? '/@  Date' : rawLabel === 'd' ? '/d  Date' : rawLabel === 'r' ? '/r  Repeat' : rawLabel === 'h' ? '/h  Habit' : rawLabel === 'g' ? '/g  Goal' : rawLabel === 't' ? '/t  Table' : '/m  Media')
                                 : isTable ? `⊞ Insert table`
                                 : isHabit ? `🎯 ${rawLabel}`
                                 : isRecurrence ? `↻ ${rawLabel}`
                                 : isDate ? rawLabel
                                 : isGoal && !isCreate ? `🏁 ${rawLabel.toUpperCase()}`
                                 : isCreate ? `+ Create "${rawLabel}"` : isProject ? rawLabel.toUpperCase() : isPlace ? `📍 ${rawLabel.toUpperCase()}` : rawLabel;
        const col                = isProject ? projectColor(rawLabel) : isPlace ? 'var(--dl-blue)' : isGoal ? 'var(--dl-teal, #5BA89D)' : isDate ? dateChipColor(dateStr) : isHabit ? 'var(--dl-accent)' : isRecurrence ? 'var(--dl-green)' : null;
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
              letterSpacing: (isProject || isPlace) && !isCreate ? '0.08em' : '0.04em',
              color: isCmd ? 'var(--dl-highlight)' : isCreate ? 'var(--dl-highlight)' : col || 'var(--dl-strong)',
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
  onArrowUpAtStart,
  onImageUpload,
  onImageDelete,     // (src) — called when an imageChip is deleted (orphan cleanup)
  noteNames,
  projectNames,
  placeNames,
  goalNames,
  onProjectClick,
  onNoteClick,
  onPlaceClick,
  onGoalClick,
  onCreateNote,      // (name, {silent}) — called when /n creates a new note
  onCreateProject,   // (name) — called when /p creates a new project
  placeholder,
  singleLine   = false,
  taskList     = false,
  noteTitle    = false,
  autoFocus    = false,
  clearOnEnter = true,   // set false for inline row editors that keep their content after Enter
  style,
  color        = ACCENT,
  textColor,
  mutedColor,
  editable     = true,
  hideInlineImages = false,
  onUpdate,
  onRecurringToggle,  // (taskId, done) — called when a recurring/habit checkbox is clicked
}, ref) {
  useEffect(injectEditorStyles, []);

  // Stable refs — avoid stale closures in TipTap plugins
  const editorRef           = useRef(null);
  const fileInputRef        = useRef(null);
  const lastExternalValue   = useRef(value);
  const onBlurRef           = useRef(onBlur);
  const onEnterCommitRef    = useRef(onEnterCommit);
  const onEnterSplitRef     = useRef(onEnterSplit);
  const onBackspaceEmptyRef  = useRef(onBackspaceEmpty);
  const onArrowUpAtStartRef  = useRef(onArrowUpAtStart);
  const onImageUploadRef    = useRef(onImageUpload);
  const onImageDeleteRef    = useRef(onImageDelete);
  const noteNamesRef        = useRef(noteNames || []);
  const projectNamesRef     = useRef(projectNames || []);
  const placeNamesRef       = useRef(placeNames || []);
  const goalNamesRef        = useRef(goalNames || []);
  const onProjectClickRef   = useRef(onProjectClick);
  const onNoteClickRef      = useRef(onNoteClick);
  const onPlaceClickRef     = useRef(onPlaceClick);
  const onGoalClickRef      = useRef(onGoalClick);
  const onCreateNoteRef     = useRef(onCreateNote);
  const onCreateProjectRef  = useRef(onCreateProject);
  const onRecurringToggleRef = useRef(onRecurringToggle);
  const onUpdateRef         = useRef(onUpdate);
  const taskListRef         = useRef(taskList);
  const noteTitleRef        = useRef(noteTitle);
  const singleLineRef       = useRef(singleLine);
  const clearOnEnterRef     = useRef(clearOnEnter);

  useEffect(() => { onBlurRef.current           = onBlur; },           [onBlur]);
  useEffect(() => { clearOnEnterRef.current     = clearOnEnter; },     [clearOnEnter]);
  useEffect(() => { onEnterCommitRef.current     = onEnterCommit; },    [onEnterCommit]);
  useEffect(() => { onEnterSplitRef.current      = onEnterSplit; },     [onEnterSplit]);
  useEffect(() => { onBackspaceEmptyRef.current  = onBackspaceEmpty; }, [onBackspaceEmpty]);
  useEffect(() => { onArrowUpAtStartRef.current  = onArrowUpAtStart; }, [onArrowUpAtStart]);
  useEffect(() => { onImageUploadRef.current     = onImageUpload; },    [onImageUpload]);
  useEffect(() => { onImageDeleteRef.current     = onImageDelete; },    [onImageDelete]);
  useEffect(() => { noteNamesRef.current         = noteNames || []; },  [noteNames]);
  useEffect(() => { projectNamesRef.current      = projectNames || []; }, [projectNames]);
  useEffect(() => { placeNamesRef.current        = placeNames || []; },  [placeNames]);
  useEffect(() => { goalNamesRef.current         = goalNames || []; },   [goalNames]);
  useEffect(() => { onProjectClickRef.current    = onProjectClick; },   [onProjectClick]);
  useEffect(() => { onNoteClickRef.current       = onNoteClick; },      [onNoteClick]);
  useEffect(() => { onPlaceClickRef.current      = onPlaceClick; },     [onPlaceClick]);
  useEffect(() => { onGoalClickRef.current       = onGoalClick; },      [onGoalClick]);
  useEffect(() => { onCreateNoteRef.current      = onCreateNote; },     [onCreateNote]);
  useEffect(() => { onCreateProjectRef.current   = onCreateProject; },  [onCreateProject]);
  useEffect(() => { onUpdateRef.current          = onUpdate; },         [onUpdate]);
  useEffect(() => { onRecurringToggleRef.current = onRecurringToggle; }, [onRecurringToggle]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.commands.focus('end'),
    setContent: (html) => {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      programmaticRef.current = true;
      ed.commands.setContent(html, false);
      lastExternalValue.current = html;
      requestAnimationFrame(() => { programmaticRef.current = false; });
    },
  }), []); // eslint-disable-line

  // Tip: first slash command usage
  const firstSlashTip = useTip('tip-first-slash');
  const editorContainerRef = useRef(null);

  // Suggestion state — suggRef kept in sync synchronously so handleKeyDown
  // can read the current state in the same event tick (useState is async).
  const [sugg, setSugg] = useState(null);
  const suggRef = useRef(null);
  // Blocks handleClick for 150ms after chip insertion so the trailing mouse-click
  // event (from dropdown selection) does not immediately navigate away.
  const justInsertedRef = useRef(false);
  const suppressOnUpdateRef = useRef(false);
  // True during mount and programmatic setContent — blocks onUpdate and
  // onSelectionUpdate auto-wrap until the next animation frame settles.
  const programmaticRef = useRef(true);

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
        const next = (s.selectedIndex + 1) % len;
        suggRef.current = { ...s, selectedIndex: next };
        setSugg(p => p ? { ...p, selectedIndex: next } : p);
        return true;
      }
      if (event.key === 'ArrowUp') {
        const next = (s.selectedIndex - 1 + len) % len;
        suggRef.current = { ...s, selectedIndex: next };
        setSugg(p => p ? { ...p, selectedIndex: next } : p);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = s.items[s.selectedIndex];
        if (item != null) {
          // Command menu item (bare /) — type the letter to refine the query
          // instead of calling command (which exits the suggestion)
          if (item.startsWith('__cmd__:')) {
            const cmd = item.slice(8); // 'p', 'n', 't', 'm', etc.
            if (cmd === 't') {
              // Table: close dropdown, delete the /, insert a 3×3 table
              s.command({ id: '__noop__' }); // close suggestion
              setSugg(null); suggRef.current = null;
              const from = editorRef.current?.state.selection.from;
              if (from != null) {
                editorRef.current?.chain().focus()
                  .deleteRange({ from: Math.max(0, from - 1), to: from })
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run();
              }
              event.preventDefault();
              return true;
            }
            if (cmd === 'm') {
              // Media: close dropdown, delete the /, trigger file picker
              s.command({ id: '__noop__' }); // close suggestion
              setSugg(null); suggRef.current = null;
              const from = editorRef.current?.state.selection.from;
              if (from != null) {
                editorRef.current?.chain().focus()
                  .deleteRange({ from: Math.max(0, from - 1), to: from })
                  .run();
              }
              if (fileInputRef.current) fileInputRef.current.click();
              event.preventDefault();
              return true;
            }
            editorRef.current?.commands.insertContent(cmd + ' ');
            event.preventDefault();
            return true;
          }
          s.command(item); setSugg(null); firstSlashTip.show(); event.preventDefault();
        }
        return true;
      }
      if (event.key === 'Escape') { setSugg(null); return true; }
      return false;
    },
  });

  textColor  = textColor  || 'inherit';
  mutedColor = mutedColor || 'var(--dl-highlight)';

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: noteTitle ? { levels: [1] } : false,
        blockquote: false, bulletList: false, orderedList: false,
        listItem: false, codeBlock: false, code: false, horizontalRule: false,
        strike: false,
        bold: noteTitle ? {} : false,
        italic: noteTitle ? {} : false,
        underline: noteTitle ? {} : false,
      }),
      URLExtension,
      HyperlinkMark,
      ProjectTagNode,
      NoteLinkNode,
      PlaceTagNode,
      RecurrenceTagNode,
      HabitTagNode,
      GoalTagNode,
      DateTagNode,
      ...(singleLine ? [] : [ImageBlock, ImageChip]),
      ...(noteTitle ? [Table.configure({ resizable: true }), TableRow, TableCell, TableHeader] : []),
      ...(taskList ? [
        TaskList,
        TaskItem.configure({ nested: true }).extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              taskId: {
                default: null,
                keepOnSplit: false, // new task items must NOT inherit the parent's DB id
                parseHTML: el => el.getAttribute('data-task-id'),
                renderHTML: attrs => attrs.taskId ? { 'data-task-id': attrs.taskId } : {},
              },
              originDate: {
                default: null,
                keepOnSplit: false,
                parseHTML: el => el.getAttribute('data-origin-date'),
                renderHTML: attrs => attrs.originDate ? { 'data-origin-date': attrs.originDate } : {},
              },
              recurring: {
                default: false,
                keepOnSplit: false, // new items are never recurring by default
                parseHTML: el => el.getAttribute('data-recurring') === 'true',
                renderHTML: attrs => attrs.recurring ? { 'data-recurring': 'true' } : {},
              },
              completedDate: {
                default: null,
                keepOnSplit: false,
                parseHTML: el => el.getAttribute('data-completed-date'),
                renderHTML: attrs => attrs.completedDate ? { 'data-completed-date': attrs.completedDate } : {},
              },
            };
          },
        }),
      ] : []),

      Placeholder.configure({
        placeholder: noteTitle
          ? ({ node }) => node.type.name === 'heading' ? 'Untitled' : 'Write something...'
          : taskList ? (placeholder || '') : placeholder || '',
        emptyNodeClass: 'is-empty',
        showOnlyCurrent: !noteTitle,
      }),

      // Unified slash command: /p → project chip, /n → note chip
      createSuggestion({
        char: '/',
        suggKey: 'slash',
        renderRef,
        findMatch: makeSlashSuggestionMatch(),
        itemsFn: (query) => {
          // Bare / — show command menu
          if (!query) return ['__cmd__:p', '__cmd__:n', '__cmd__:l', '__cmd__:d', '__cmd__:r', '__cmd__:h', '__cmd__:g', ...(noteTitle ? ['__cmd__:t'] : []), ...(onImageUploadRef.current ? ['__cmd__:m'] : [])];

          const cmd    = query[0]?.toLowerCase();              // 'p' or 'n'
          const search = query.slice(1).replace(/^\s+/, '');  // text after /p or /n

          if (cmd === 'm') {
            // /m — trigger file picker for media upload
            if (onImageUploadRef.current && fileInputRef.current) {
              // Delete the /m text, then trigger picker
              const from = editorRef.current?.state.selection.from;
              if (from != null) {
                editorRef.current?.chain().focus()
                  .deleteRange({ from: Math.max(0, from - 3), to: from })
                  .run();
              }
              fileInputRef.current.click();
            }
            return [];
          }
          if (cmd === 'p') {
            const q      = search.toLowerCase().replace(/\s/g, '');
            const qTrim  = search.trim();
            const names  = projectNamesRef.current || [];
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__project__:${n}`);
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create_project__:${qTrim}`);
            }
            // Never return empty — keeps the suggestion plugin alive while typing
            return matches.length ? matches : ['__create_project__:' + (qTrim || 'project')];
          }
          if (cmd === 'l') {
            const q      = search.toLowerCase().replace(/\s/g, '');
            const qTrim  = search.trim();
            const names  = placeNamesRef.current || [];
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__place__:${n}`);
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create_place__:${qTrim}`);
            }
            return matches.length ? matches : ['__create_place__:' + (qTrim || 'place')];
          }
          if (cmd === 'n') {
            const names   = noteNamesRef.current || [];
            const q       = search.toLowerCase().replace(/\s/g, '');
            const qTrim   = search.trim();
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__note__:${n}`);
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create__:${qTrim}`);
            }
            // Never return empty — keeps the suggestion plugin alive while typing
            return matches.length ? matches : ['__create__:' + (qTrim || 'note')];
          }
          if (cmd === '@' || cmd === 'd') {
            // Date suggestions only
            const dateItems = generateDateSuggestions(search)
              .filter(s => s.date)
              .map(s => `__date__:${s.date}:${s.label}`);
            return dateItems;
          }
          if (cmd === 'r') {
            // Repeat/recurrence suggestions
            return getRecurrenceSuggestions(search);
          }
          if (cmd === 'h') {
            // Habit suggestions — same schedule options as /r but inserts habitTag
            // "/h mwf 10"      → count-limited: MWF until 10 completions  → {h:mwf:M·W·F:10}
            // "/h mwf 10 days" → time-limited:  MWF for 10 days          → {h:mwf:M·W·F:10d}
            // "/h 10"          → daily + 10 completions                   → {h:daily:Daily:10}
            // "/h 10 days"     → daily for 10 days                        → {h:daily:10 days:10d}
            const hWords = search.trim().split(/\s+/);
            const hasDays = hWords.length >= 2 && /^days?$/i.test(hWords[hWords.length - 1]);
            const numWords = hasDays ? hWords.slice(0, -1) : hWords;
            const lastNumWord = numWords[numWords.length - 1];
            const num = /^\d+$/.test(lastNumWord) ? parseInt(lastNumWord, 10) : null;
            const schedSearch = num && numWords.length > 1 ? numWords.slice(0, -1).join(' ') : (num ? '' : search);
            const limitSuffix = num ? (hasDays ? `:${num}d` : `:${num}`) : '';

            if (num && !schedSearch) {
              const chipLabel = hasDays ? `${num} days` : 'Daily';
              return [`__habit__:daily:${chipLabel}${limitSuffix}`];
            }
            const base = getRecurrenceSuggestions(schedSearch).map(s => s.replace('__recurrence__:', '__habit__:'));
            if (num) {
              return base.map(s => `${s}${limitSuffix}`);
            }
            return base;
          }
          if (cmd === 't') {
            // /t — insert table. Return a single selectable item; commandFn handles insertion.
            return noteTitle ? ['__table__:3:3'] : [];
          }
          if (cmd === 'g') {
            const q = search.toLowerCase().replace(/\s/g, '');
            const qTrim = search.trim();
            const names = goalNamesRef.current || [];
            const matches = names
              .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
              .map(n => `__goal__:${n}`);
            if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
              matches.push(`__create_goal__:${qTrim}`);
            }
            return matches.length ? matches : ['__create_goal__:' + (qTrim || 'goal')];
          }
          return [];
        },
        commandFn: ({ editor, range, name }) => {
          // __cmd__ items are handled in onKeyDown/onSelect — they never reach here.
          // But guard just in case:
          if (name.startsWith('__cmd__:')) return;

          justInsertedRef.current = true;
          setTimeout(() => { justInsertedRef.current = false; }, 150);

          if (name.startsWith('__table__:')) {
            const parts = name.split(':');
            const rows = parseInt(parts[1]) || 3;
            const cols = parseInt(parts[2]) || 3;
            editor.chain().focus().deleteRange(range)
              .insertTable({ rows, cols, withHeaderRow: true }).run();
            return;
          }

          if (name.startsWith('__habit__:')) {
            // Format: __habit__:key:label or __habit__:key:label:N or __habit__:key:label:Nd
            const parts = name.split(':');
            const key = parts[1];
            const lastPart = parts[parts.length - 1];
            // Detect count (e.g. "10") or days (e.g. "10d")
            const isDays = parts.length > 3 && /^\d+d$/.test(lastPart);
            const isCount = parts.length > 3 && /^\d+$/.test(lastPart);
            const count = isCount ? parseInt(lastPart, 10) : null;
            const days = isDays ? parseInt(lastPart, 10) : null;
            const label = (isCount || isDays) ? parts.slice(2, -1).join(':') : parts.slice(2).join(':');
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'habitTag', attrs: { key, label, count, days } },
              { type: 'text', text: ' ' },
            ]).run();
            return;
          }

          if (name.startsWith('__recurrence__:')) {
            // __recurrence__:key:Label
            const parts = name.split(':');
            const key = parts[1];
            const label = parts.slice(2).join(':');
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'recurrenceTag', attrs: { key, label } },
              { type: 'text', text: ' ' },
            ]).run();
            return;
          }

          if (name.startsWith('__date__:')) {
            // __date__:YYYY-MM-DD:Label
            const dateStr = name.slice(9, 19); // YYYY-MM-DD
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'dateTag', attrs: { date: dateStr } },
              { type: 'text', text: ' ' },
            ]).run();
            return;
          }

          if (name.startsWith('__place__:') || name.startsWith('__create_place__:')) {
            const isNew = name.startsWith('__create_place__:');
            const placeName = isNew ? name.slice(16) : name.slice(10);
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'placeTag', attrs: { name: placeName } },
              { type: 'text', text: ' ' },
            ]).run();
            if (isNew) {
              window.dispatchEvent(new CustomEvent('daylab:create-place', { detail: { name: placeName } }));
            }
          } else if (name.startsWith('__goal__:') || name.startsWith('__create_goal__:')) {
            const isNew = name.startsWith('__create_goal__:');
            const gName = (isNew ? name.slice(16) : name.slice(9)).toLowerCase();
            editor.chain().focus().deleteRange(range).insertContent([
              { type: 'goalTag', attrs: { name: gName } },
              { type: 'text', text: ' ' },
            ]).run();
          } else if (name.startsWith('__project__:') || name.startsWith('__create_project__:')) {
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

      // # trigger for project tags — alias for /p
      createSuggestion({
        char: '#',
        suggKey: 'hashProject',
        renderRef,
        itemsFn: (query) => {
          const q      = query.toLowerCase().replace(/\s/g, '');
          const qTrim  = query.trim();
          const names  = projectNamesRef.current || [];
          const matches = names
            .filter(n => !q || n.toLowerCase().replace(/\s/g, '').includes(q))
            .map(n => `__project__:${n}`);
          if (qTrim && !names.some(n => n.toLowerCase() === qTrim.toLowerCase())) {
            matches.push(`__create_project__:${qTrim}`);
          }
          return matches.length ? matches : ['__create_project__:' + (qTrim || 'project')];
        },
        commandFn: ({ editor, range, name }) => {
          if (!name.startsWith('__project__:') && !name.startsWith('__create_project__:')) return;
          justInsertedRef.current = true;
          setTimeout(() => { justInsertedRef.current = false; }, 150);
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
        },
      }),

      // @ trigger for date tags — bare @query without /
      createSuggestion({
        char: '@',
        suggKey: 'atDate',
        renderRef,
        itemsFn: (query) => {
          const suggestions = generateDateSuggestions(query);
          return suggestions
            .filter(s => s.date)
            .map(s => `__date__:${s.date}:${s.label}`);
        },
        commandFn: ({ editor, range, name }) => {
          if (!name.startsWith('__date__:')) return;
          justInsertedRef.current = true;
          setTimeout(() => { justInsertedRef.current = false; }, 150);
          const dateStr = name.slice(9, 19);
          editor.chain().focus().deleteRange(range).insertContent([
            { type: 'dateTag', attrs: { date: dateStr } },
            { type: 'text', text: ' ' },
          ]).run();
        },
      }),
    ],

    content: noteTitle ? textToNoteContent(value)
      : taskList ? (value || EMPTY_TASK_LIST)
      : (singleLine || !value?.startsWith('<')) ? { type: 'doc', content: textToContent(value || '') }
      : (value || ''),
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
            // Use the same serialisation as the normal onBlur for this editor type:
            // singleLine → plain text, everything else → HTML. Using docToText for
            // non-singleLine editors saved plain text where HTML was expected, which
            // corrupted note chip names on reload when timing races prevented the
            // subsequent TipTap onBlur from overwriting with the correct HTML.
            const serialised = singleLineRef.current
              ? docToText(editorRef.current.getJSON())
              : editorRef.current.getHTML();
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onProjectClickRef.current(projectEl.getAttribute('data-project-tag'));
          return true;
        }
        const placeEl = t.closest?.('[data-place-tag]');
        if (placeEl && onPlaceClickRef.current) {
          if (onBlurRef.current && editorRef.current) {
            const serialised = singleLineRef.current
              ? docToText(editorRef.current.getJSON())
              : editorRef.current.getHTML();
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onPlaceClickRef.current(placeEl.getAttribute('data-place-tag'));
          return true;
        }
        const goalEl = t.closest?.('[data-goal]');
        if (goalEl && onGoalClickRef.current) {
          if (onBlurRef.current && editorRef.current) {
            const serialised = singleLineRef.current
              ? docToText(editorRef.current.getJSON())
              : editorRef.current.getHTML();
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onGoalClickRef.current(goalEl.getAttribute('data-goal'));
          return true;
        }
        const noteEl = t.closest?.('[data-note-link]');
        if (noteEl && onNoteClickRef.current) {
          if (onBlurRef.current && editorRef.current) {
            const serialised = singleLineRef.current
              ? docToText(editorRef.current.getJSON())
              : editorRef.current.getHTML();
            onBlurRef.current(serialised);
            editorRef.current.view?.dom?.blur();
          }
          onNoteClickRef.current(noteEl.getAttribute('data-note-link'));
          return true;
        }
        // Hyperlink mark click (<a class="dl-hyperlink">) → show popover
        const hlEl = t.closest?.('a.dl-hyperlink');
        if (hlEl) {
          event.preventDefault();
          event.stopPropagation();
          const rect = hlEl.getBoundingClientRect();
          const href = hlEl.getAttribute('href');
          const displayText = hlEl.textContent;
          if (href) {
            window.dispatchEvent(new CustomEvent('daylab:link-click', {
              detail: { url: href, displayText, rect, pos, linkEl: hlEl, isHyperlink: true },
            }));
          }
          return true;
        }
        // Bare URL decoration click → show popover
        const linkEl = t.closest?.('.dl-url-link');
        if (linkEl) {
          event.preventDefault();
          event.stopPropagation();
          const rect = linkEl.getBoundingClientRect();
          const url = linkEl.getAttribute('data-href');
          if (url) {
            window.dispatchEvent(new CustomEvent('daylab:link-click', {
              detail: { url, displayText: url, rect, pos, linkEl, isHyperlink: false },
            }));
          }
          return true;
        }
        return false;
      },

      handleKeyDown(view, e) {
        // Block Cmd/Ctrl+Shift+9 in task list mode — prevents removing checkboxes
        if (taskList && e.key === '9' && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return true; }
        // When suggestion dropdown is open, stop arrow/enter/tab from bubbling
        // to parent elements (prevents task row navigation during suggestion selection)
        if (suggRef.current && ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
          e.stopPropagation();
          return false; // let suggestion plugin handle it
        }

        if (e.key === 'Enter' && !e.shiftKey && singleLine) {
          e.preventDefault();
          const text = docToText(view.state.doc.toJSON());
          if (onEnterCommitRef.current) {
            onEnterCommitRef.current(text);
            if (clearOnEnterRef.current) {
              setTimeout(() => editorRef.current?.commands.setContent(
                { type: 'doc', content: [{ type: 'paragraph' }] }
              ), 0);
            }
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
        if (taskListRef.current && !e.shiftKey && (e.key === 'Enter' || e.key === 'Backspace')) {
          const { selection } = view.state;
          if (selection.empty) {
            const $from = selection.$from;
            if ($from.depth >= 2) {
              const taskItemNode = $from.node($from.depth - 1);
              if (taskItemNode?.type.name === 'taskItem') {
                // Backspace: block at start of first task item only (prevents destroying list structure)
                if (e.key === 'Backspace' && $from.parentOffset === 0 && $from.index($from.depth - 2) === 0) return true;
                // Enter: block on ANY empty task item (must type something before creating a new task)
                if (e.key === 'Enter' && $from.parent.content.size === 0) return true;
              }
            }
          }
        }
        if (e.key === 'ArrowUp' && onArrowUpAtStartRef.current) {
          const { selection } = view.state;
          if (selection.empty && selection.$from.pos <= 1) {
            onArrowUpAtStartRef.current();
            return true;
          }
        }
        if (e.key === 'Escape') { view.dom.blur(); return true; }
        return false;
      },

      handleDOMEvents: {
        paste(view, e) {
          // Check for pasted image URL (text that ends with image extension)
          const pastedText = e.clipboardData?.getData('text/plain')?.trim();
          if (pastedText && /^https?:\/\/.+\.(jpe?g|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i.test(pastedText)) {
            e.preventDefault();
            editorRef.current?.commands.insertContent([
              { type: 'imageChip', attrs: { src: pastedText } },
              { type: 'text', text: ' ' },
            ]);
            return true;
          }
          if (!onImageUploadRef.current) return false;
          const img = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
          if (!img) return false;
          e.preventDefault();
          onImageUploadRef.current(img.getAsFile()).then(url => {
            if (url) editorRef.current?.commands.insertContent([
              { type: 'imageChip', attrs: { src: url } },
              { type: 'text', text: ' ' },
            ]);
          });
          return true;
        },
        drop(view, e) {
          if (!onImageUploadRef.current) return false;
          const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
          if (!files.length) return false;
          e.preventDefault();
          // Upload all dropped files, not just the first
          Promise.all(files.map(f => onImageUploadRef.current(f))).then(urls => {
            const chips = urls.filter(Boolean).flatMap(url => [
              { type: 'imageChip', attrs: { src: url } },
              { type: 'text', text: ' ' },
            ]);
            if (chips.length) editorRef.current?.commands.insertContent(chips);
          });
          return true;
        },
      },
    },

    onBlur({ editor }) {
      flushedRef.current = true; // prevent duplicate save from unmount flush
      if (noteTitleRef.current) onBlurRef.current?.(editor.getHTML());
      else if (singleLineRef.current) onBlurRef.current?.(docToText(editor.getJSON()));
      else if (!taskListRef.current) onBlurRef.current?.(editor.getHTML());
    },

    onUpdate({ editor }) {
      if (suppressOnUpdateRef.current) return;
      if (programmaticRef.current) return;  // skip mount and programmatic setContent
      userEditedRef.current = true;
      onUpdateRef.current?.(editor.getHTML());
    },

    onSelectionUpdate({ editor }) {
      // In task list mode, if cursor somehow lands on a bare paragraph (outside the
      // task list), wrap it back. Skip during programmatic updates (mount, setContent).
      if (!taskListRef.current || programmaticRef.current) return;
      const { $from } = editor.state.selection;
      if ($from.parent.type.name === 'paragraph' && $from.depth === 1) {
        suppressOnUpdateRef.current = true;
        editor.chain().focus().toggleTaskList().run();
        suppressOnUpdateRef.current = false;
      }
    },
  });

  // Sync the module-level ref so ImageChip keyboard shortcuts can call onImageDelete
  useEffect(() => { onImageDeleteRef.current = onImageDelete; }, [onImageDelete]);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Mark editor as initialized after mount settles — unblocks onUpdate and onSelectionUpdate
  useEffect(() => {
    if (!editor) return;
    const id = requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [editor]);

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
  // flushedRef prevents double-save when TipTap's onBlur fires right before unmount.
  // userEditedRef tracks whether user actually typed — prevents unmount flush from
  // saving content to the wrong date when TipTap HTML normalization differs from
  // the loaded value (which would trigger a false-positive "changed" detection).
  const flushedRef = useRef(false);
  const userEditedRef = useRef(false);
  useEffect(() => {
    return () => {
      if (flushedRef.current) return; // onBlur already saved
      if (!userEditedRef.current) return; // user never edited — skip unmount save
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return;
      try {
        if (noteTitleRef.current) {
          onBlurRef.current?.(ed.getHTML());
        } else if (taskListRef.current) {
          onUpdateRef.current?.(ed.getHTML());
        } else if (singleLineRef.current) {
          onBlurRef.current?.(docToText(ed.getJSON()));
        } else if (onBlurRef.current) {
          onBlurRef.current(ed.getHTML());
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
    flushedRef.current = false; // reset for new content
    userEditedRef.current = false; // reset — new value came from outside
    if (!editor.isFocused) {
      // Pass emitUpdate=false so programmatic syncs don't trigger onUpdate → setValue loops.
      programmaticRef.current = true;
      if (noteTitleRef.current) {
        editor.commands.setContent(textToNoteContent(value), false);
      } else if (taskList) {
        editor.commands.setContent(value || EMPTY_TASK_LIST, false);
      } else if (singleLine || !value?.startsWith('<')) {
        editor.commands.setContent({ type: 'doc', content: textToContent(value || '') }, false);
      } else {
        editor.commands.setContent(value, false);
      }
      requestAnimationFrame(() => { programmaticRef.current = false; });
    }
  }, [value, editor]); // eslint-disable-line

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  return (
    <>
      <div ref={editorContainerRef} className={`dl-editor${taskList ? ' dl-tasklist' : ''}${hideInlineImages ? ' dl-hide-images' : ''}`} style={{
        fontFamily: serif, fontSize: F.md, lineHeight: '1.7',
        color: textColor, caretColor: color,
        '--dl-muted': mutedColor,
        position: noteTitle ? 'relative' : undefined,
        ...style,
      }}>
        {noteTitle && <FormatToolbar editor={editor} />}
        <LinkPopover editor={editor} />
        <EditorContent editor={editor} />
      </div>
      {/* Hidden file input for /m media upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file && onImageUploadRef.current) {
            onImageUploadRef.current(file).then(url => {
              if (url) editorRef.current?.commands.insertContent([
                { type: 'imageChip', attrs: { src: url } },
                { type: 'text', text: ' ' },
              ]);
            });
          }
          e.target.value = ''; // reset so same file can be re-selected
        }}
      />
      <SuggestionDropdown
        state={sugg}
        onSelect={item => {
          if (item.startsWith('__cmd__:')) {
            const cmd = item.slice(8);
            if (cmd === 'm') {
              setSugg(null); suggRef.current = null;
              const from = editorRef.current?.state.selection.from;
              if (from != null) {
                editorRef.current?.chain().focus()
                  .deleteRange({ from: Math.max(0, from - 1), to: from })
                  .run();
              }
              if (fileInputRef.current) fileInputRef.current.click();
              return;
            }
            editorRef.current?.commands.insertContent(cmd + ' ');
            return;
          }
          sugg?.command(item); setSugg(null); firstSlashTip.show();
        }}
      />
      <Tip visible={firstSlashTip.visible} message="All commands: /h habit, /r repeat, /p project, /l location, /d date, /t table" anchorRef={editorContainerRef} position="below" onDismiss={firstSlashTip.dismiss} />
    </>
  );
});

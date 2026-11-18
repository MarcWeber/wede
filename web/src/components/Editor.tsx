import { useEffect, useRef, useState, useCallback, type RefObject, type KeyboardEvent } from 'react'
import {
  EditorView, keymap, highlightActiveLineGutter,
  highlightActiveLine, drawSelection, highlightSpecialChars,
  rectangularSelection, crosshairCursor,
  Decoration,
} from '@codemirror/view'
import { numberingGutter } from '../lib/lineNumbering'
import { EditorState, Compartment, type Extension, type StateField, type StateEffect } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import {
  syntaxHighlighting, defaultHighlightStyle, bracketMatching,
  indentOnInput, HighlightStyle,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { languageServerPlugin } from 'codemirror-languageserver'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { showMinimap, type MinimapConfig } from '@replit/codemirror-minimap'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { useTheme } from '../hooks/useTheme'
import { Code } from 'lucide-react'

import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { sql } from '@codemirror/lang-sql'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { php } from '@codemirror/lang-php'
import { yaml } from '@codemirror/lang-yaml'
import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { csharp, kotlin, scala, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import { breakpointSupport, setBreakpointsEffect, setStopLineEffect } from '../lib/breakpoints'
import { targetSelectionKey } from '../lib/followSelection'
import type { Tab, EditorSettings, EditorActions } from '../types'
import type { UseYDocState } from '../hooks/useYDoc'

// sl wraps a CodeMirror 5 legacy mode as a CodeMirror 6 language extension.
const sl = (mode: StreamParser<unknown>) => () => StreamLanguage.define(mode)

type LangFn = () => Extension

const langMap: Record<string, LangFn> = {
  js: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ jsx: true, typescript: true }),
  html: () => html(), htm: () => html(), css: () => css(), scss: () => css(), less: () => css(), json: () => json(),
  py: () => python(), go: () => go(), md: () => markdown(), markdown: () => markdown(),
  xml: () => xml(), svg: () => xml(), sql: () => sql(),
  rs: () => rust(), c: () => cpp(), cpp: () => cpp(), cc: () => cpp(), hpp: () => cpp(), h: () => cpp(),
  java: () => java(), php: () => php(),
  // YAML + many languages via legacy modes (syntax highlighting; LSP is separate).
  yaml: () => yaml(), yml: () => yaml(),
  sh: sl(shell), bash: sl(shell), zsh: sl(shell), ksh: sl(shell),
  rb: sl(ruby), lua: sl(lua), toml: sl(toml),
  dockerfile: sl(dockerFile),
  ini: sl(properties), cfg: sl(properties), conf: sl(properties), env: sl(properties), properties: sl(properties),
  swift: sl(swift), ps1: sl(powerShell), psm1: sl(powerShell),
  cs: sl(csharp), kt: sl(kotlin), kts: sl(kotlin), scala: sl(scala), sbt: sl(scala), m: sl(objectiveC),
}

function getLang(filename: string): Extension {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return langMap[ext]?.() || []
}

// Headings inherit the same level-aware text colour as the rest of the UI.
const wedeHeadingHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-wede-heading1' },
  { tag: [tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6], class: 'cm-wede-heading2' },
])

// Light-mode syntax highlighting — oneDark covers dark mode, but light mode
// needs its own token colours.  These match the VS Code light palette so
// keywords, strings, numbers, comments, etc. are distinct.
const lightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#795E26' },
  { tag: tags.string, color: '#A31515' },
  { tag: tags.number, color: '#098658' },
  { tag: tags.comment, color: '#008000' },
  { tag: tags.variableName, color: '#001080' },
  { tag: tags.propertyName, color: '#795E26' },
  { tag: tags.function(tags.variableName), color: '#795E26' },
  { tag: tags.definition(tags.variableName), color: '#795E26' },
  { tag: tags.typeName, color: '#267F99' },
  { tag: tags.typeOperator, color: '#000000' },
  { tag: tags.operator, color: '#000000' },
  { tag: tags.className, color: '#267F99' },
  { tag: tags.tagName, color: '#800000' },
  { tag: tags.attributeName, color: '#EE0000' },
  { tag: tags.meta, color: '#565656' },
  { tag: tags.regexp, color: '#008000' },
  { tag: tags.literal, color: '#098658' },
  { tag: tags.bool, color: '#098658' },
  { tag: tags.null, color: '#098658' },
  { tag: tags.self, color: '#795E26' },
  { tag: tags.separator, color: '#000000' },
  { tag: tags.punctuation, color: '#393A34' },
  { tag: tags.bracket, color: '#0431FA' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.link, color: '#0B66C3', textDecoration: 'underline' },
  { tag: tags.url, color: '#0B66C3' },
  { tag: tags.monospace, color: '#A31515' },
  { tag: tags.quote, color: '#008000' },
  { tag: tags.list, color: '#795E26' },
])

// Build a theme extension from editor settings.
function makeEditorTheme(settings: EditorSettings, isDark: boolean): Extension {
  const fontSize = `${settings.fontSize || 13}px`
  const fontFamily = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace'

  const base = EditorView.theme({
    '&': {
      backgroundColor: 'var(--c-bg-primary)',
      color: 'var(--c-text-primary)',
      fontSize,
      fontFamily,
    },
    '.cm-gutters': {
      backgroundColor: 'var(--c-bg-secondary)',
      color: 'var(--c-text-muted)',
      borderRight: '1px solid var(--c-border)',
      fontFamily,
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--c-bg-hover)', color: 'var(--c-text-primary)' },
    '.cm-activeLine': { backgroundColor: 'var(--c-accent-glow)' },
    '.cm-cursor': { borderLeftColor: 'var(--c-accent)' },
    '.cm-content': { fontFamily, fontSize, color: 'var(--c-text-primary)' },
    '.cm-wede-heading1': { color: `${isDark ? 'var(--c-text-primary)' : '#795E26'} !important`, fontWeight: '700' },
    '.cm-wede-heading2': { color: `${isDark ? 'var(--c-text-primary)' : '#267F99'} !important`, fontWeight: '600' },
    // Multi-cursor: secondary cursors are slightly dimmer.
    '.cm-cursor-secondary': { borderLeftColor: 'var(--c-accent)', opacity: '0.6' },
  }, { dark: isDark })

  return base
}

// Build the minimap facet value.  Returns null when disabled (minimap hidden).
function makeMinimapConfig(enabled: boolean): MinimapConfig | null {
  if (!enabled) return null
  return {
    create() {
      const dom = document.createElement('div')
      return { dom }
    },
    displayText: 'blocks',
    showOverlay: 'always',
  }
}

interface GoToLineWidgetProps {
  viewRef: RefObject<EditorView | null>
  onClose: () => void
}

// GoToLine overlay widget — rendered inside the editor container.
// Receives a ref object (not .current) to avoid the react-hooks/refs lint rule.
function GoToLineWidget({ viewRef, onClose }: GoToLineWidgetProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    const view = viewRef.current
    if (e.key === 'Enter') {
      const n = parseInt((e.target as HTMLInputElement).value, 10)
      if (!isNaN(n) && view) {
        const line = Math.max(1, Math.min(n, view.state.doc.lines))
        const pos = view.state.doc.line(line).from
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        })
        view.focus()
      }
      onClose()
    }
    if (e.key === 'Escape') {
      onClose()
      view?.focus()
    }
  }, [viewRef, onClose])

  return (
    <div className="absolute top-2 right-4 z-20 flex items-center gap-2 bg-bg-elevated border border-border rounded-lg shadow-xl px-3 py-2">
      <span className="text-[11px] text-text-muted">Go to line:</span>
      <input
        autoFocus
        type="number"
        min="1"
        className="w-16 bg-bg-input border border-border rounded px-2 py-0.5 text-[12px] text-text-primary focus:outline-none focus:border-accent/60"
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

export interface CursorPos {
  line: number
  col: number
  anchorLine?: number // selection start line (1-based, 0 or absent = no selection)
  anchorCol?: number  // selection start column (1-based, 0 or absent = no selection)
  headLine?: number   // selection end line (1-based, 0 or absent = no selection)
  headCol?: number    // selection end column (1-based, 0 or absent = no selection)
}

export interface RemoteSelection {
  fromLine: number // 1-based start line
  fromCol: number  // 1-based start column
  toLine: number   // 1-based end line (inclusive)
  toCol: number    // 1-based end column
  color?: string   // highlight color
}

export interface EditorProps {
  file: Tab | null
  content: string | null
  onChange: (content: string) => void
  onSave: () => void
  onCursorChange?: (pos: CursorPos) => void
  settings?: EditorSettings
  lspExtension?: (Extension | StateField<string>)[] | null
  onRegisterActions?: (actions: EditorActions) => void
  onDefinition?: (uri: string, line: number, col: number) => void
  collab?: UseYDocState | null
  editable?: boolean
  breakpoints?: number[]
  onToggleBreakpoint?: (line: number, lines: number[]) => void
  stopLine?: number | null
}

export default function Editor({ file, content, onChange, onSave, onCursorChange, settings = {} as EditorSettings, lspExtension = null, onRegisterActions, onDefinition, collab = null, editable = true, breakpoints = [], onToggleBreakpoint, stopLine = null }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onCursorRef = useRef(onCursorChange)
  const onToggleBpRef = useRef(onToggleBreakpoint)
  const onDefinitionRef = useRef(onDefinition)
  const breakpointsRef = useRef(breakpoints)
  const stopLineRef = useRef(stopLine)

  const [showGoToLine, setShowGoToLine] = useState(false)

  // Compartments for live reconfiguration without destroying the editor.
  const themeCompRef   = useRef(new Compartment())
  const wrapCompRef    = useRef(new Compartment())
  const tabCompRef     = useRef(new Compartment())
  const minimapCompRef = useRef(new Compartment())
  const lineNumCompRef = useRef(new Compartment())
  const lspCompRef     = useRef(new Compartment())
  const editCompRef    = useRef(new Compartment())
  const syntaxCompRef  = useRef(new Compartment())

  const { isDark } = useTheme()

  // Keep callback refs in sync without triggering re-renders (updated in an
  // effect rather than directly in render to satisfy react-hooks/refs).
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onCursorRef.current = onCursorChange
    onToggleBpRef.current = onToggleBreakpoint
    onDefinitionRef.current = onDefinition
  })

  // Register editor actions (goToLine) with the parent IDE.
  useEffect(() => {
    onRegisterActions?.({ goToLine: () => setShowGoToLine(true) })
  }, [onRegisterActions])

  // Go to definition across files. codemirror-languageserver only moves the
  // cursor when the target URI is the current document; for another file we
  // hand the LSP target to IDE, which opens the tab and applies the selection.
  const goToDefinitionAt = useCallback(async (view: EditorView, pos: number, typeDefinition: boolean) => {
    const plugin = view.plugin(languageServerPlugin)
    if (!plugin) return false
    const line = view.state.doc.lineAt(pos)
    const position = { line: line.number - 1, character: pos - line.from }
    const target = typeDefinition
      ? await plugin.requestTypeDefinition(view, position)
      : await plugin.requestDefinition(view, position)
    if (target && target.uri !== plugin.documentUri) {
      onDefinitionRef.current?.(target.uri, target.range.start.line + 1, target.range.start.character + 1)
    }
    return true
  }, [])

  // Rebuild editor when file changes (new language, new content).
  useEffect(() => {
    if (!containerRef.current) return

    const themeComp   = themeCompRef.current
    const wrapComp    = wrapCompRef.current
    const tabComp     = tabCompRef.current
    const lineNumComp = lineNumCompRef.current
    const minimapComp = minimapCompRef.current
    const lspComp     = lspCompRef.current
    const editComp    = editCompRef.current
    const syntaxComp  = syntaxCompRef.current

    const minimapEnabled = settings.minimap ?? false

    // Collaboration: when a synced Y.Text + awareness are provided, yCollab owns
    // the document text (binds CodeMirror <-> Y.Text and renders remote cursors).
    // The doc is seeded from the Y.Text (empty until the provider syncs, then the
    // server's disk-backed content); we must NOT also seed from the `content`
    // prop or the editor would double-insert.
    const yt = collab?.ytext
    const aw = collab?.awareness
    const collabOn = !!(yt && aw)
    const collabExt = collabOn
      ? [yCollab(yt, aw, { undoManager: new Y.UndoManager(yt) })]
      : []

    const state = EditorState.create({
      // yjs's shipped .d.ts (types/YText.d.ts) declares toJSON() but omits
      // toString() from Y.Text's declarations, even though yjs/src/types/YText.js
      // implements toString() (returns the plain-text content) and toJSON()
      // calls it internally. no-base-to-string sees the undeclared method and
      // assumes Object.prototype's default — this is the real, intended call.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      doc: collabOn ? yt.toString() : (content || ''),
      extensions: [
        ...collabExt,
        lineNumComp.of(numberingGutter(settings.numbering ?? 'smart')),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        history(),
        // Multi-cursor support: Alt+Click adds a cursor; Alt+drag selects
        // a rectangular region. crosshairCursor shows a crosshair when Alt
        // is held, giving users a visual cue that multi-cursor is active.
        rectangularSelection(),
        crosshairCursor(),
        themeComp.of([isDark ? oneDark : [], makeEditorTheme(settings, isDark)]),
        wrapComp.of(settings.wordWrap ? EditorView.lineWrapping : []),
        tabComp.of(EditorState.tabSize.of(settings.tabWidth || 2)),
        // Minimap compartment — reconfigured live when settings.minimap changes.
        minimapComp.of(showMinimap.of(makeMinimapConfig(minimapEnabled))),
        // Intercept F12 / Ctrl-Cmd+Click before codemirror-languageserver's
        // built-in handler so cross-file targets can be opened by IDE.
        keymap.of([
          { key: 'F12', run: (view) => {
            if (!view.plugin(languageServerPlugin)) return false
            void goToDefinitionAt(view, view.state.selection.main.head, false)
            return true
          } },
          { key: 'Mod-F12', run: (view) => {
            if (!view.plugin(languageServerPlugin)) return false
            void goToDefinitionAt(view, view.state.selection.main.head, true)
            return true
          } },
        ]),
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false
            if (!view.plugin(languageServerPlugin)) return false
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos == null) return false
            void goToDefinitionAt(view, pos, event.shiftKey)
            return true
          },
        }),
        // LSP compartment — reconfigured when the file or lsp setting changes.
        lspComp.of(lspExtension ? lspExtension : []),
        // Read-only compartment — viewer role gets EditorState.readOnly + EditorView.editable(false).
        editComp.of(editable ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
        syntaxComp.of(syntaxHighlighting(isDark ? defaultHighlightStyle : lightHighlight)),
        syntaxHighlighting(wedeHeadingHighlight),
        breakpointSupport(),
        getLang(file?.name || ''),
        keymap.of([
          ...closeBracketsKeymap, ...defaultKeymap,
          ...searchKeymap, ...historyKeymap, indentWithTab,
        ]),
        keymap.of([
          // When collab owns the doc, the backend CRDT write-back persists edits;
          // a manual REST save would fight it, so Mod-s is a no-op here.
          { key: 'Mod-s', run: () => { if (!collabOn) onSaveRef.current?.(); return true } },
          { key: 'Ctrl-g', run: () => { setShowGoToLine(true); return true } },
        ]),
        EditorView.updateListener.of((update) => {
          // Skip onChange under collab so IDE never marks the tab modified or
          // triggers its debounced REST auto-save (the doc WS handles sync+persist).
          if (!collabOn && update.docChanged) onChangeRef.current?.(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main
            const headPos = sel.head
            const headLine = update.state.doc.lineAt(headPos)
            const anchorPos = sel.anchor
            const anchorLineObj = update.state.doc.lineAt(anchorPos)
            const hasSelection = sel.anchor !== sel.head
            onCursorRef.current?.({
              line: headLine.number,
              col: headPos - headLine.from + 1,
              anchorLine: hasSelection ? anchorLineObj.number : 0,
              anchorCol: hasSelection ? anchorPos - anchorLineObj.from + 1 : 0,
              headLine: hasSelection ? headLine.number : 0,
              headCol: hasSelection ? headPos - headLine.from + 1 : 0,
            })
          }
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto', fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    // Seed this file's breakpoints + current stop line into the new editor.
    view.dispatch({ effects: [
      setBreakpointsEffect.of(breakpointsRef.current || []),
      setStopLineEffect.of(stopLineRef.current ?? null),
    ] })
    return () => view.destroy()
  }, [file?.path, collab?.ytext]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live breakpoint updates (without recreating the editor).
  useEffect(() => {
    breakpointsRef.current = breakpoints
    if (viewRef.current) viewRef.current.dispatch({ effects: setBreakpointsEffect.of(breakpoints || []) })
  }, [breakpoints])

  // Current execution line — highlight + scroll into view when paused.
  useEffect(() => {
    stopLineRef.current = stopLine
    const view = viewRef.current
    if (!view) return
    const effects: StateEffect<unknown>[] = [setStopLineEffect.of(stopLine ?? null)]
    if (stopLine && stopLine >= 1 && stopLine <= view.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(stopLine).from, { y: 'center' }))
    }
    view.dispatch({ effects })
  }, [stopLine])

  // Live theme switch (dark ↔ light) — swap both the chrome theme and the
  // syntax highlight colours so light mode gets distinct token colours.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: [
        themeCompRef.current.reconfigure([isDark ? oneDark : [], makeEditorTheme(settings, isDark)]),
        syntaxCompRef.current.reconfigure(
          syntaxHighlighting(isDark ? defaultHighlightStyle : lightHighlight),
        ),
      ],
    })
  }, [isDark]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live settings: word wrap.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: wrapCompRef.current.reconfigure(settings.wordWrap ? EditorView.lineWrapping : []),
    })
  }, [settings.wordWrap])

  // Live settings: tab width.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: tabCompRef.current.reconfigure(EditorState.tabSize.of(settings.tabWidth || 2)),
    })
  }, [settings.tabWidth])

  // Live settings: font size — rebuild the theme compartment.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: themeCompRef.current.reconfigure([isDark ? oneDark : [], makeEditorTheme(settings, isDark)]),
    })
  }, [settings.fontSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live settings: line-number mode.
  useEffect(() => {
    if (!viewRef.current) return
    const mode = settings.numbering ?? 'smart'
    viewRef.current.dispatch({
      effects: lineNumCompRef.current.reconfigure(numberingGutter(mode)),
    })
  }, [settings.numbering])

  // Live settings: minimap toggle.
  useEffect(() => {
    if (!viewRef.current) return
    const minimapEnabled = settings.minimap ?? false
    viewRef.current.dispatch({
      effects: minimapCompRef.current.reconfigure(showMinimap.of(makeMinimapConfig(minimapEnabled))),
    })
  }, [settings.minimap])

  // Live LSP extension swap — fires when file changes or lsp toggle changes.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: lspCompRef.current.reconfigure(lspExtension ? lspExtension : []),
    })
  }, [lspExtension])

  // Live editable toggle — viewer role makes the editor read-only without
  // destroying and rebuilding it.
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: editCompRef.current.reconfigure(
        editable ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]
      ),
    })
  }, [editable])

  // Sync external content changes (e.g. auto-save feedback or file reload).
  // Disabled under collab: yCollab owns the document, so pushing the `content`
  // prop here would clobber the synced text.
  useEffect(() => {
    if (collab?.ytext) return
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (content !== undefined && content !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: content || '' } })
    }
  }, [content, collab?.ytext])

  // Scroll to a specific line (used by search result navigation) and/or apply a
  // peer's selection range (used by follow mode). The key makes repeated tab
  // updates idempotent so the user's own cursor is not fought over.
  const targetSelKey = targetSelectionKey(file?.targetSelection)
  useEffect(() => {
    const view = viewRef.current
    if (!view || !file) return
    if (file.targetSelection) {
      const sel = file.targetSelection
      const doc = view.state.doc
      const clampLine = (ln: number) => doc.line(Math.max(1, Math.min(ln, doc.lines)))
      const aLine = clampLine(sel.anchorLine)
      const hLine = clampLine(sel.headLine)
      const anchor = Math.min(aLine.from + Math.max(0, sel.anchorCol - 1), aLine.to)
      const head = Math.min(hLine.from + Math.max(0, sel.headCol - 1), hLine.to)
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: 'center' }),
      })
      return
    }
    if (!file.targetLine) return
    const line = Math.max(1, Math.min(file.targetLine, view.state.doc.lines))
    const pos = view.state.doc.line(line).from
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    })
  }, [file?.targetLine, targetSelKey])

  if (!file) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <div className="text-center text-text-muted animate-fade-in">
          <Code className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No file open</p>
          <p className="text-xs mt-1">Select a file from the explorer</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden">
      <div ref={containerRef} className="h-full overflow-hidden" />
      {showGoToLine && (
        <GoToLineWidget
          viewRef={viewRef}
          onClose={() => setShowGoToLine(false)}
        />
      )}
    </div>
  )
}

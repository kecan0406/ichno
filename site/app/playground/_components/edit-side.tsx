'use client'

import type { LintCode, LintSeverity } from 'ichno'
import type { SeatPlanEditor, ViewControls } from 'ichno/editor'
import { useState } from 'react'
import type { Check } from '../_lib/documents'
import type { BuildView } from './build-3d'
import controls from './controls.module.css'
import { DesignPanel } from './design'
import { openDialog } from './dialogs'
import { Icon } from './icons'
import { MenuButton, MenuItem, MenuSeparator } from './menu'
import { ChecksPanel, JsonPanel } from './panels'
import styles from './workspace.module.css'

// The right-hand side while editing: undo and redo, the way into the preview, the zoom — then the selection's
// properties (Design), what the schema and the lint rules say (Checks) and the stored document (JSON).

type RightTab = 'design' | 'checks' | 'json'

type Props = {
  editor: SeatPlanEditor<string>
  name: string
  booked: readonly string[]
  snapping: boolean
  onSnappingChange(next: boolean): void
  checks: Check[]
  lint: Record<LintCode, LintSeverity>
  onLintChange(next: Record<LintCode, LintSeverity>): void
  // Selects what a check points at and brings it into view.
  onFocus(ids: string[]): void
  // The zoom as shown, and what drives it — the 2D canvas's view or the 3D editor's.
  zoom: BuildView
  view: ViewControls
  onZoomToLevel(level: number): void
  onPreview(): void
  onHidePanels(): void
  onNotice(notice: string | null): void
  onRemove(): void
  onSaveAsset(): void
}

export function EditSide({
  editor,
  name,
  booked,
  snapping,
  onSnappingChange,
  checks,
  lint,
  onLintChange,
  onFocus,
  zoom,
  view,
  onZoomToLevel,
  onPreview,
  onHidePanels,
  onNotice,
  onRemove,
  onSaveAsset,
}: Props) {
  const [tab, setTab] = useState<RightTab>('design')
  const errors = checks.filter((check) => check.severity === 'error').length

  return (
    <>
      <div className={styles.head}>
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={!editor.canUndo}
          onClick={editor.undo}
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          disabled={!editor.canRedo}
          onClick={editor.redo}
        >
          <Icon name="redo" />
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={controls.button}
          data-primary=""
          title="See the plan as your customers would"
          onClick={onPreview}
        >
          <Icon name="play" size={14} />
          Preview
        </button>
        <MenuButton
          label="Zoom and view"
          className={styles.zoom}
          align="end"
          button={
            <>
              {Math.round(zoom.level * 100)}%
              <Icon name="chevronDown" size={12} />
            </>
          }
        >
          <MenuItem keys="+" disabled={!zoom.canZoomIn} onSelect={view.zoomIn}>
            Zoom in
          </MenuItem>
          <MenuItem keys="−" disabled={!zoom.canZoomOut} onSelect={view.zoomOut}>
            Zoom out
          </MenuItem>
          <MenuItem keys="⇧1" onSelect={view.fit}>
            Zoom to fit
          </MenuItem>
          <MenuItem
            keys="⇧2"
            disabled={editor.selection.length === 0}
            onSelect={() => view.zoomTo(editor.selectionBounds)}
          >
            Zoom to selection
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => onZoomToLevel(2)}>Zoom to 200%</MenuItem>
          <MenuItem onSelect={() => onZoomToLevel(4)}>Zoom to 400%</MenuItem>
          <MenuSeparator />
          <MenuItem checked={snapping} onSelect={() => onSnappingChange(!snapping)}>
            Snap to the grid
          </MenuItem>
          <MenuItem keys="⌘\" onSelect={onHidePanels}>
            Hide panels
          </MenuItem>
        </MenuButton>
      </div>
      <div className={controls.tabs} role="tablist" aria-label="Right panel">
        <button
          type="button"
          role="tab"
          className={controls.tab}
          aria-selected={tab === 'design'}
          onClick={() => setTab('design')}
        >
          Design
        </button>
        <button
          type="button"
          role="tab"
          className={controls.tab}
          aria-selected={tab === 'checks'}
          onClick={() => setTab('checks')}
        >
          Checks
          {checks.length > 0 && (
            <span className={controls.count} data-error={errors > 0 || undefined}>
              {checks.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          className={controls.tab}
          aria-selected={tab === 'json'}
          onClick={() => setTab('json')}
        >
          JSON
        </button>
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {tab === 'design' && (
          <DesignPanel
            editor={editor}
            name={name}
            booked={booked}
            snapping={snapping}
            onSnappingChange={onSnappingChange}
            onNotice={onNotice}
            onRemove={onRemove}
            onSaveAsset={onSaveAsset}
          />
        )}
        {tab === 'checks' && <ChecksPanel checks={checks} lint={lint} onLintChange={onLintChange} onFocus={onFocus} />}
        {tab === 'json' && <JsonPanel plan={editor.plan} name={name} onImport={() => openDialog('import-dialog')} />}
      </div>
    </>
  )
}

'use client'

import type { SeatPlanEditor, EditorSelection } from 'ichno/editor'
import { copyDocument, downloadDocument } from '../_lib/documents'
import type { SavedObject } from '../_lib/library'
import { PLAYGROUND_OBJECTS, type ToolDef } from '../_lib/playground-objects'
import { AssetsPanel } from './assets'
import controls from './controls.module.css'
import { openDialog } from './dialogs'
import { DocumentHead } from './file-menu'
import { LayersPanel } from './layers'
import styles from './workspace.module.css'

// The left-hand side: the document's own menu, then its layers — or the assets to place.

export type LeftTab = 'layers' | 'assets'

type Props = {
  editor: SeatPlanEditor<string>
  name: string
  tab: LeftTab
  onTabChange(next: LeftTab): void
  // Layers locked and hidden — the editor's `frozenIds` and `hiddenIds`.
  frozen: ReadonlySet<string>
  hidden: ReadonlySet<string>
  onFreeze(id: string, on: boolean): void
  onHide(id: string, on: boolean): void
  // The layers row under the pointer, to outline on the plan.
  onLayerHover(item: EditorSelection<string> | null): void
  // The objects people saved, the form for saving one, and the tool an asset is picked as.
  library: readonly SavedObject[]
  saving: boolean
  onSavingChange(next: boolean): void
  onPick(def: ToolDef | null): void
  onSave(name: string): void
  onDelete(id: string): void
  onPreset(id: string): void
  onHidePanels(): void
  onNotice(notice: string | null): void
}

export function LeftSide({
  editor,
  name,
  tab,
  onTabChange,
  frozen,
  hidden,
  onFreeze,
  onHide,
  onLayerHover,
  library,
  saving,
  onSavingChange,
  onPick,
  onSave,
  onDelete,
  onPreset,
  onHidePanels,
  onNotice,
}: Props) {
  // A layers row renamed — the label people read, on a group or a place.
  function relabel(item: EditorSelection<string>, label: string) {
    if (item.kind === 'group') {
      editor.updateGroup(item.id, (group) => {
        const { label: _, ...rest } = group

        return label ? { ...rest, label } : rest
      })
    } else {
      editor.updateObject(item.id, (object) => {
        if (object.kind !== 'place') return object
        const { label: _, ...rest } = object

        return label ? { ...rest, label } : rest
      })
    }
  }

  return (
    <>
      <DocumentHead
        name={name}
        dirty={editor.dirty}
        onPreset={onPreset}
        onImport={() => openDialog('import-dialog')}
        onCopy={() => void copyDocument(editor.plan)}
        onDownload={() => downloadDocument(editor.plan, name)}
        onRevert={editor.reset}
        onShortcuts={() => openDialog('shortcuts-dialog')}
        onHidePanels={onHidePanels}
      />
      <div className={controls.tabs} role="tablist" aria-label="Left panel">
        <button
          type="button"
          role="tab"
          className={controls.tab}
          aria-selected={tab === 'layers'}
          onClick={() => onTabChange('layers')}
        >
          Layers
        </button>
        <button
          type="button"
          role="tab"
          className={controls.tab}
          aria-selected={tab === 'assets'}
          title="Assets (⇧I)"
          onClick={() => onTabChange('assets')}
        >
          Assets
        </button>
      </div>
      <div className={styles.tabPanel} role="tabpanel">
        {tab === 'layers' ? (
          <LayersPanel
            plan={editor.plan}
            selection={editor.selection}
            isLocked={editor.isLocked}
            onSelect={(items) => {
              onNotice(null)
              editor.setSelection(items)
            }}
            onHover={onLayerHover}
            onRename={relabel}
            frozen={frozen}
            hidden={hidden}
            onFreeze={onFreeze}
            onHide={onHide}
          />
        ) : (
          <AssetsPanel
            objects={PLAYGROUND_OBJECTS}
            saved={library}
            activeId={editor.tool?.id ?? null}
            canSave={editor.selectedIds.length > 0}
            saving={saving}
            onSavingChange={onSavingChange}
            onPick={onPick}
            onSave={onSave}
            onDelete={onDelete}
          />
        )}
      </div>
    </>
  )
}

'use client'

import type { PlanPoint } from 'ichno'
import type { SeatPlanEditor } from 'ichno/editor'
import { Menu, MenuItem, MenuSeparator, type MenuPoint } from './menu'

// The plan's right-click menu — what the keys do, found where the pointer is. Pasting lands where it opened.

export type CanvasMenuAt = { screen: MenuPoint; plan: PlanPoint | null }

type Props = {
  at: CanvasMenuAt | null
  editor: SeatPlanEditor<string>
  onClose(): void
  // Deleting says what it could not delete, and pasting why it could not paste, so the workspace does them.
  onRemove(): void
  onPaste(at: PlanPoint | undefined): void
  onSaveAsset(): void
  // Lock or hide the selection — the layers panel's toggles, for the selection at once.
  onFreeze(): void
  onHide(): void
  onZoomToSelection(): void
  onFit(): void
  onHidePanels(): void
}

export function CanvasMenu({
  at,
  editor,
  onClose,
  onRemove,
  onPaste,
  onSaveAsset,
  onFreeze,
  onHide,
  onZoomToSelection,
  onFit,
  onHidePanels,
}: Props) {
  const { plan, selection } = editor
  const hasGroups = selection.some((item) => item.kind === 'group')
  const hasGrouped = selection.some(
    (item) => item.kind === 'object' && plan.objects.some((o) => o.id === item.id && o.group !== undefined),
  )
  const paste = () => onPaste(at?.plan ?? undefined)

  return (
    <Menu
      label="Plan"
      at={at?.screen ?? null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {editor.selectedIds.length > 0 ? (
        <>
          <MenuItem keys="⌘C" onSelect={() => editor.copySelected()}>
            Copy
          </MenuItem>
          <MenuItem keys="⌘X" onSelect={() => editor.cutSelected()}>
            Cut
          </MenuItem>
          <MenuItem keys="⌘V" disabled={editor.clipboard === null} onSelect={paste}>
            Paste here
          </MenuItem>
          <MenuItem keys="⌘D" onSelect={() => editor.duplicateSelected()}>
            Duplicate
          </MenuItem>
          <MenuItem keys="⌫" onSelect={onRemove}>
            Delete
          </MenuItem>
          <MenuSeparator />
          <MenuItem keys="↵" disabled={!hasGroups} onSelect={editor.selectMembers}>
            Select members
          </MenuItem>
          <MenuItem keys="⇧↵" disabled={!hasGrouped} onSelect={editor.selectGroups}>
            Select group
          </MenuItem>
          <MenuItem keys="⌘G" onSelect={() => editor.groupSelected()}>
            Group selection
          </MenuItem>
          <MenuItem keys="⇧⌘G" disabled={!hasGroups} onSelect={editor.ungroupSelected}>
            Ungroup
          </MenuItem>
          <MenuSeparator />
          <MenuItem keys="⌥⌘]" onSelect={() => editor.reorderSelected('front')}>
            Bring to front
          </MenuItem>
          <MenuItem keys="⌘]" onSelect={() => editor.reorderSelected('forward')}>
            Bring forward
          </MenuItem>
          <MenuItem keys="⌘[" onSelect={() => editor.reorderSelected('backward')}>
            Send backward
          </MenuItem>
          <MenuItem keys="⌥⌘[" onSelect={() => editor.reorderSelected('back')}>
            Send to back
          </MenuItem>
          <MenuSeparator />
          <MenuItem keys="R" onSelect={() => editor.rotateSelected(90)}>
            Turn 90°
          </MenuItem>
          <MenuItem onSelect={onFreeze}>Lock</MenuItem>
          <MenuItem onSelect={onHide}>Hide</MenuItem>
          <MenuItem onSelect={onSaveAsset}>Save as asset…</MenuItem>
          <MenuItem keys="⇧2" onSelect={onZoomToSelection}>
            Zoom to selection
          </MenuItem>
        </>
      ) : editor.selectedWallIds.length > 0 ? (
        <>
          <MenuItem keys="⌘D" onSelect={() => editor.duplicateSelected()}>
            Duplicate
          </MenuItem>
          <MenuItem keys="⌫" onSelect={onRemove}>
            Delete
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onFreeze}>Lock</MenuItem>
          <MenuItem onSelect={onHide}>Hide</MenuItem>
          <MenuItem keys="⇧2" onSelect={onZoomToSelection}>
            Zoom to selection
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem keys="⌘V" disabled={editor.clipboard === null} onSelect={paste}>
            Paste here
          </MenuItem>
          <MenuItem
            keys="⌘A"
            disabled={plan.objects.length === 0 && plan.walls.length === 0}
            onSelect={editor.selectAll}
          >
            Select all
          </MenuItem>
          <MenuSeparator />
          <MenuItem keys="⇧1" onSelect={onFit}>
            Zoom to fit
          </MenuItem>
          <MenuItem keys="⌘\" onSelect={onHidePanels}>
            Hide panels
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

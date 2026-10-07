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
  // Deleting says what it could not delete, so the workspace does it.
  onRemove(): void
  onSaveAsset(): void
  onZoomToSelection(): void
  onFit(): void
  onHidePanels(): void
}

export function CanvasMenu({
  at,
  editor,
  onClose,
  onRemove,
  onSaveAsset,
  onZoomToSelection,
  onFit,
  onHidePanels,
}: Props) {
  const { plan, selection } = editor
  const hasGroups = selection.some((item) => item.kind === 'group')
  const hasGrouped = selection.some(
    (item) => item.kind === 'object' && plan.objects.some((o) => o.id === item.id && o.group !== undefined),
  )
  const paste = () => editor.paste(at?.plan ?? undefined)

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
          <MenuItem onSelect={onSaveAsset}>Save as asset…</MenuItem>
          <MenuItem keys="⇧2" onSelect={onZoomToSelection}>
            Zoom to selection
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem keys="⌘V" disabled={editor.clipboard === null} onSelect={paste}>
            Paste here
          </MenuItem>
          <MenuItem keys="⌘A" disabled={plan.objects.length === 0} onSelect={editor.selectAll}>
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

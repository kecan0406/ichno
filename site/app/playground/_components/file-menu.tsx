'use client'

import { Logo } from '../../_ui/logo'
import { PRESETS } from '../_lib/documents'
import controls from './controls.module.css'
import { Icon } from './icons'
import { MenuButton, MenuHeading, MenuItem, MenuLink, MenuSeparator } from './menu'
import styles from './workspace.module.css'

// The top of the left panel — the main menu (documents in and out, keys) and the document's name, the way a design
// tool shows the file it has open.

type Props = {
  name: string
  dirty: boolean
  onPreset(id: string): void
  onImport(): void
  onCopy(): void
  onDownload(): void
  onRevert(): void
  onShortcuts(): void
  onHidePanels(): void
}

export function DocumentHead({
  name,
  dirty,
  onPreset,
  onImport,
  onCopy,
  onDownload,
  onRevert,
  onShortcuts,
  onHidePanels,
}: Props) {
  return (
    <div className={styles.document}>
      <div className={styles.head}>
        <MenuButton
          label="Main menu"
          className={styles.mainMenu}
          button={
            <>
              <Logo className={styles.logo} />
              <span>ichno</span>
              <Icon name="chevronDown" size={12} />
            </>
          }
        >
          <MenuLink href="/">Back to ichno</MenuLink>
          <MenuSeparator />
          <MenuHeading>Start from</MenuHeading>
          {PRESETS.map((preset) => (
            <MenuItem key={preset.id} onSelect={() => onPreset(preset.id)}>
              {preset.name}
            </MenuItem>
          ))}
          <MenuItem onSelect={onImport}>Import JSON…</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onCopy}>Copy JSON</MenuItem>
          <MenuItem onSelect={onDownload}>Download JSON</MenuItem>
          <MenuItem disabled={!dirty} onSelect={onRevert}>
            Revert changes
          </MenuItem>
          <MenuSeparator />
          <MenuItem keys="?" onSelect={onShortcuts}>
            Keyboard shortcuts
          </MenuItem>
          <MenuItem keys="⌘\" onSelect={onHidePanels}>
            Hide panels
          </MenuItem>
        </MenuButton>
        <span className={styles.spacer} />
        <button
          type="button"
          className={controls.iconButton}
          aria-label="Hide panels"
          title="Hide panels (⌘\)"
          onClick={onHidePanels}
        >
          <Icon name="sidebar" />
        </button>
      </div>
      <div className={styles.docName}>
        <strong>{name}</strong>
        <span>{dirty ? 'Edited · kept in this browser' : 'Playground · kept in this browser'}</span>
      </div>
    </div>
  )
}

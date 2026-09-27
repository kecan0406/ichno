import styles from '../playground.module.css'

// Every key the playground answers to — ichno's editor shortcuts plus the site's own keys for its objects.

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Objects',
    keys: [
      ['V', 'Select'],
      ['1 – 6', 'Row, seat block, round table, desk, booth, standing area — the playground’s objects'],
      ['Q', 'Keep the object picked after placing one'],
      ['Esc', 'Stop drawing, put the object down, then clear the selection'],
    ],
  },
  {
    title: 'Drawing',
    keys: [
      ['Drag', 'Draw at any size'],
      ['Tap', 'Drop at the standard size'],
      ['Shift', 'Square box, or a line in 15° steps'],
      ['Alt', 'Draw from the centre'],
    ],
  },
  {
    title: 'Selection',
    keys: [
      ['Tap', 'Select — tap again for one seat of a group'],
      ['Shift-tap', 'Add to or take from the selection'],
      ['Drag the floor', 'Select everything it touches'],
      ['⌘A', 'Select everything'],
      ['← ↑ → ↓', 'Move — with Shift, a whole cell'],
      ['Shift-drag', 'Move along one axis; turn in 15° steps; resize in proportion'],
      ['R  ⇧R', 'Turn a quarter clockwise, anticlockwise'],
      ['Delete', 'Delete'],
    ],
  },
  {
    title: 'Editing',
    keys: [
      ['⌘C  ⌘X  ⌘V', 'Copy, cut, paste — under the pointer'],
      ['⌘D', 'Duplicate'],
      ['⌘G', 'Group'],
      ['⌘Z  ⇧⌘Z', 'Undo, redo'],
    ],
  },
  {
    title: 'View',
    keys: [
      ['Scroll', 'Pan'],
      ['Pinch  ⌘-scroll', 'Zoom'],
      ['Space-drag', 'Pan, whatever the tool'],
      ['+  −', 'Zoom in, out'],
      ['⇧1  ⇧2', 'Fit the plan, zoom to the selection'],
      ['?', 'This list'],
    ],
  },
]

export function ShortcutsDialog() {
  return (
    <dialog
      id="shortcuts-dialog"
      className={styles.dialog}
      data-wide=""
      aria-labelledby="shortcuts-title"
      // Keys pressed here are for the dialog, not the editor behind it.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form method="dialog" className={styles.dialogBody}>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p className={styles.panelHint}>⌘ is Ctrl on Windows and Linux.</p>
        <div className={styles.shortcutGroups}>
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl className={styles.shortcuts}>
                {group.keys.map(([keys, what]) => (
                  <div key={keys}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="submit" className={styles.button} data-primary="">
            Done
          </button>
        </div>
      </form>
    </dialog>
  )
}

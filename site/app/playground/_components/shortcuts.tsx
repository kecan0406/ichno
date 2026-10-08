import controls from './controls.module.css'
import styles from './panels.module.css'

// Every key the playground answers to — ichno's editor shortcuts plus the site's own keys for its tools and panels.

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Tools',
    keys: [
      ['V', 'Select'],
      ['H', 'Hand — drag to pan'],
      ['P  F  S', 'Draw a place, a fixture, a section — ichno’s primitives'],
      ['1 – 5', 'Seat, desk, sofa, booth, standing area — the playground’s assets'],
      ['⇧I', 'Assets'],
      ['Q', 'Keep the tool after placing'],
      ['Esc', 'Drop the drawing, drag or marquee under way, put the tool down, then clear the selection'],
    ],
  },
  {
    title: 'Drawing',
    keys: [
      ['Drag', 'Draw at any size'],
      ['Tap', 'Drop at the standard size'],
      ['Shift', 'Square box, or a line in 15° steps'],
      ['Alt', 'Draw from the centre'],
      ['↵  ⌫', 'Close a section, take back its last corner'],
    ],
  },
  {
    title: 'Selection',
    keys: [
      ['Click', 'Select — again for one seat of a group'],
      ['Shift-click', 'Add to or take from the selection'],
      ['Drag the floor', 'Select everything it touches'],
      ['↵  ⇧↵', 'The selected groups’ members, the selected objects’ groups'],
      ['⌘A', 'Select everything'],
      ['← ↑ → ↓', 'Move — with Shift, a whole cell'],
      ['Shift-drag', 'Move along one axis; turn in 15° steps; resize in proportion'],
      ['Alt-drag', 'Move a copy, leaving the original'],
      ['⌘-drag', 'Move without the smart guides'],
      ['R  ⇧R', 'Turn a quarter clockwise, anticlockwise'],
      ['⌫', 'Delete'],
    ],
  },
  {
    title: 'Editing',
    keys: [
      ['⌘C  ⌘X  ⌘V', 'Copy, cut, paste — under the pointer'],
      ['⌘D', 'Duplicate — again to repeat how far the copy was moved'],
      ['⌘G  ⇧⌘G', 'Group, ungroup'],
      ['⌘]  ⌘[', 'Bring forward, send backward'],
      ['⌥⌘]  ⌥⌘[', 'Bring to front, send to back'],
      ['⌘Z  ⇧⌘Z', 'Undo, redo'],
    ],
  },
  {
    title: 'View',
    keys: [
      ['Scroll', 'Pan'],
      ['Pinch  ⌘-scroll', 'Zoom'],
      ['Space-drag', 'Pan, whatever the tool'],
      ['Drag to the edge', 'Scroll the plan while moving, selecting or drawing'],
      ['+  −', 'Zoom in, out'],
      ['⇧1  ⇧2', 'Fit the plan, zoom to the selection'],
      [',  .', 'Turn the 3D view a quarter left, right'],
      ['⌘\\', 'Hide or show the panels'],
      ['?', 'This list'],
    ],
  },
]

export function ShortcutsDialog() {
  return (
    <dialog
      id="shortcuts-dialog"
      className={controls.dialog}
      data-wide=""
      aria-labelledby="shortcuts-title"
      // Keys pressed here are for the dialog, not the editor behind it.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form method="dialog" className={controls.dialogBody}>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p className={controls.hint}>⌘ is Ctrl on Windows and Linux.</p>
        <div className={styles.shortcutGroups}>
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <dl className={styles.shortcuts}>
                {group.keys.map(([keys, what]) => (
                  <div key={keys}>
                    <dt>
                      <kbd className={controls.kbd}>{keys}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className={controls.dialogActions}>
          <button type="submit" className={controls.button} data-primary="">
            Done
          </button>
        </div>
      </form>
    </dialog>
  )
}

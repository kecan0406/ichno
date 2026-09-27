import type { MouseEvent } from 'react'

// A press on a layer, a tool or an action leaves the keyboard where it was — on the plan, so arrows, Enter, Space and
// Delete stay the editor's, the way a design tool keeps them — after letting go of a field, so what was typed there
// is kept. Tab still reaches every control.
export function pressKeepingFocus(e: MouseEvent) {
  if (e.target instanceof HTMLInputElement) return
  e.preventDefault()
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
}

'use client'

import { useEffect, useState } from 'react'
import { PRESETS, type Workbench } from '../_lib/documents'
import { Workspace } from './workspace'

// Holds the loaded document. Every visit starts from the first preset — nothing is kept between visits. Loading
// another one (a preset, an import) remounts the workspace, the way an app adopts a new baseline: fresh undo
// history, fresh `dirty`.
export function Playground() {
  const [loaded, setLoaded] = useState<{ workbench: Workbench; version: number }>(() => ({
    workbench: PRESETS[0]!.workbench,
    version: 0,
  }))

  // The theme button (./file-menu.tsx) picks light or dark for the playground only — leaving it hands the page back
  // to the system's.
  useEffect(
    () => () => {
      delete document.documentElement.dataset.theme
    },
    [],
  )

  return (
    <Workspace
      key={loaded.version}
      initial={loaded.workbench}
      onReplace={(workbench) => setLoaded((current) => ({ workbench, version: current.version + 1 }))}
    />
  )
}

'use client'

import { useEffect, useState } from 'react'
import { PRESETS, loadWorkbench, type Workbench } from '../_lib/documents'
import { Workspace } from './workspace'

// Holds the loaded document. Loading another one (a preset, an import, the browser's saved copy) remounts the
// workspace, the way an app adopts a new baseline: fresh undo history, fresh `dirty`.
export function Playground() {
  const [loaded, setLoaded] = useState<{ workbench: Workbench; version: number }>(() => ({
    workbench: PRESETS[0]!.workbench,
    version: 0,
  }))
  // Saving waits until the saved copy has been read — otherwise the preset shown first would overwrite it.
  const [restored, setRestored] = useState(false)

  // The saved copy lives in localStorage, which the server cannot read — swap it in after hydration.
  useEffect(() => {
    const saved = loadWorkbench()
    if (saved) setLoaded((current) => ({ workbench: saved, version: current.version + 1 }))
    setRestored(true)
  }, [])

  return (
    <Workspace
      key={loaded.version}
      initial={loaded.workbench}
      autosave={restored}
      onReplace={(workbench) => setLoaded((current) => ({ workbench, version: current.version + 1 }))}
    />
  )
}

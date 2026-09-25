'use client'

import { motion } from 'motion/react'
import { useId, useState } from 'react'
import styles from './ui.module.css'

export type CodeTab = { id: string; title: string; caption: string; code: string }

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0]?.id)
  const baseId = useId()
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  if (!active) return null

  return (
    <div className={styles.tabs}>
      <div className={styles.tabList} role="tablist" aria-label="Code examples">
        {tabs.map((tab) => {
          const selected = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              className={styles.tab}
              data-selected={selected || undefined}
              onClick={() => setActiveId(tab.id)}
            >
              {selected && (
                <motion.span
                  layoutId={`${baseId}-indicator`}
                  className={styles.tabIndicator}
                  transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
                />
              )}
              <span className={styles.tabLabel}>{tab.title}</span>
            </button>
          )
        })}
      </div>
      <div
        className={styles.tabPanel}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-${active.id}`}
      >
        <p className={styles.caption}>{active.caption}</p>
        <motion.pre
          key={active.id}
          className={styles.code}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <code>{active.code}</code>
        </motion.pre>
      </div>
    </div>
  )
}

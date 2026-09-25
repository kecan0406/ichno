import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { MotionProvider } from './_ui/motion-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'ichno — Seat plans for React',
  description:
    'One JSON document for seat plans, a zod schema, headless SVG components that render on the server, and a headless editor hook.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0e' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5/index.css" />
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  )
}

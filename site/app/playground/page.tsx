import type { Metadata } from 'next'
import { Playground } from './_components/playground'

export const metadata: Metadata = {
  title: 'Playground — ichno',
  description:
    'Edit a seat plan with ichno in a design-tool layout: the document’s layers, the playground’s rows, tables, desks, booths and areas as assets beside the ones you save, properties for any selection, live validation, JSON import and export, and a customer preview.',
}

export default function PlaygroundPage() {
  return <Playground />
}

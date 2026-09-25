import type { Metadata } from 'next'
import { Playground } from './_components/playground'

export const metadata: Metadata = {
  title: 'Playground — ichno',
  description:
    'Edit a seat plan with ichno: rows, tables, desks, booths, areas and fixtures, live validation, JSON import and export, and a customer preview.',
}

export default function PlaygroundPage() {
  return <Playground />
}

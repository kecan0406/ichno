// Label sequences — Seats.io-style labeling rules as plain functions. A sequence turns a position (0-based) in a
// run of `count` items into a label; the editor applies one to a row's seats or to a set of rows. Labels are what
// people read; ids stay untouched, so relabeling never breaks bookings.

export type LabelSequence = (index: number, count: number) => string

export const labeling = {
  numbers,
  letters,
  custom,
}

// 1, 2, 3 … — `step` 2 gives odd or even numbering, `reverse` counts from the other end.
function numbers({
  start = 1,
  step = 1,
  reverse = false,
  prefix = '',
}: { start?: number; step?: number; reverse?: boolean; prefix?: string } = {}): LabelSequence {
  return (index, count) => `${prefix}${start + (reverse ? count - 1 - index : index) * step}`
}

// A, B, … Z, AA, AB … — letters in `skip` are left out (theatres often skip I and O). Lowercase with `lower`.
function letters({
  skip = [],
  reverse = false,
  lower = false,
  prefix = '',
}: { skip?: readonly string[]; reverse?: boolean; lower?: boolean; prefix?: string } = {}): LabelSequence {
  const skipped = new Set(skip.map((letter) => letter.toUpperCase()))
  const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((letter) => !skipped.has(letter))
  return (index, count) => {
    const label = lettersOf(reverse ? count - 1 - index : index, alphabet)
    return `${prefix}${lower ? label.toLowerCase() : label}`
  }
}

// Labels from a list, in order — for hand-made schemes. Positions past the end get an empty label.
function custom(labels: readonly string[]): LabelSequence {
  return (index) => labels[index] ?? ''
}

// Bijective base-n: 0 → A, 25 → Z, 26 → AA (spreadsheet columns).
function lettersOf(index: number, alphabet: readonly string[]): string {
  if (alphabet.length === 0) return ''
  let n = index + 1
  let label = ''
  while (n > 0) {
    n -= 1
    label = alphabet[n % alphabet.length] + label
    n = Math.floor(n / alphabet.length)
  }
  return label
}

// Calls `frame` on every animation frame, with the frame's time, for as long as it answers true — or until the
// returned function stops it.
export function everyFrame(frame: (now: number) => boolean): () => void {
  let request = requestAnimationFrame(function tick(now) {
    if (frame(now)) request = requestAnimationFrame(tick)
  })

  return () => cancelAnimationFrame(request)
}

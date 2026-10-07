import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Like the library's own client code — the editor hands out plans that keep their identity, and memoized
  // components skip redrawing what did not change.
  reactCompiler: true,
}

export default nextConfig

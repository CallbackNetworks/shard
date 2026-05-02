import { useState, useEffect } from 'react'

export default function useBreakpoint() {
  const [bp, setBp] = useState(() =>
    window.innerWidth >= 800 ? 'desktop' : window.innerWidth >= 600 ? 'tablet' : 'mobile'
  )
  useEffect(() => {
    const handler = () =>
      setBp(window.innerWidth >= 800 ? 'desktop' : window.innerWidth >= 600 ? 'tablet' : 'mobile')
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return bp
}

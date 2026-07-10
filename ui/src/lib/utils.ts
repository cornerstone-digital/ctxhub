import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function healthColor(status: 'ok' | 'warn' | 'error' | string): string {
  switch (status) {
    case 'ok': return '#0fd97b'
    case 'warn': return '#f5a623'
    case 'error': return '#f03d3d'
    default: return '#5a5a80'
  }
}

export function relTime(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function overallHealth(statuses: ('ok' | 'warn' | 'error')[]): 'ok' | 'warn' | 'error' {
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('warn')) return 'warn'
  return 'ok'
}

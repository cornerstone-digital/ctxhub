declare module 'lucide-react' {
  import type { FC, SVGProps } from 'react'

  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string
    strokeWidth?: number | string
    absoluteStrokeWidth?: boolean
    color?: string
    fill?: string
  }

  export type LucideIcon = FC<LucideProps>

  export const Activity: LucideIcon
  export const AlertTriangle: LucideIcon
  export const BookOpen: LucideIcon
  export const Building2: LucideIcon
  export const CheckCircle: LucideIcon
  export const ChevronDown: LucideIcon
  export const Cloud: LucideIcon
  export const Crosshair: LucideIcon
  export const Download: LucideIcon
  export const ExternalLink: LucideIcon
  export const Folder: LucideIcon
  export const Globe: LucideIcon
  export const Hexagon: LucideIcon
  export const MessageSquare: LucideIcon
  export const Network: LucideIcon
  export const Package: LucideIcon
  export const RefreshCw: LucideIcon
  export const Search: LucideIcon
  export const Send: LucideIcon
  export const Snowflake: LucideIcon
  export const Users: LucideIcon
  export const X: LucideIcon
  export const XCircle: LucideIcon
  export const Zap: LucideIcon
  export const ZoomIn: LucideIcon
  export const ZoomOut: LucideIcon
}

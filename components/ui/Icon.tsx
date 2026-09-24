import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'grid' | 'addons' | 'catalogs' | 'plugins' | 'collections'
  | 'progress' | 'library' | 'settings' | 'backup' | 'transfer'
  | 'search' | 'plus' | 'minus' | 'close' | 'chevron-left'
  | 'chevron-right' | 'chevron-down' | 'arrow-up' | 'arrow-down'
  | 'check' | 'alert' | 'refresh' | 'external' | 'edit' | 'trash'
  | 'menu' | 'user' | 'more' | 'upload' | 'link'

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>,
  addons: <><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v5m0 7v5m8.5-8.5h-5m-7 0h-5"/></>,
  catalogs: <><path d="M4 5.5h16M4 12h16M4 18.5h16"/><circle cx="7" cy="5.5" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="10" cy="18.5" r="1"/></>,
  plugins: <><path d="M9 4v5H4v6h5v5h6v-5h5V9h-5V4z"/></>,
  collections: <><path d="M4 5.5h16v13H4z"/><path d="M8 9h8m-8 4h5"/></>,
  progress: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>,
  library: <><path d="M5 4.5h14v15H5z"/><path d="M8 8h8m-8 4h8m-8 4h5"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.1.9-1.1 1.9-1.4-.5a7.8 7.8 0 0 1-1.6.9l-.3 1.5h-2.2l-.3-1.5a7.8 7.8 0 0 1-1.8 0l-.3 1.5H9.4l-.3-1.5a7.8 7.8 0 0 1-1.6-.9l-1.4.5L5 16l1.1-.9a7.8 7.8 0 0 1-.3-1.8l-1.3-.8.7-2.1 1.5.1a7.8 7.8 0 0 1 1.1-1.3l-.3-1.5 2-1 .9 1.3a7.8 7.8 0 0 1 1.8-.2l.8-1.3 2.1.7-.1 1.5a7.8 7.8 0 0 1 1.3 1.1l1.5-.3 1 2-1.3.9a7.8 7.8 0 0 1 .1 1.8z"/></>,
  backup: <><path d="M4 7.5h16v12H4z"/><path d="M8 7.5V4.5h8v3M8 12h8m-8 3h5"/></>,
  transfer: <><path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  minus: <path d="M5 12h14"/>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  'chevron-left': <path d="m15 18-6-6 6-6"/>,
  'chevron-right': <path d="m9 18 6-6-6-6"/>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  'arrow-up': <><path d="M12 19V5m-6 6 6-6 6 6"/></>,
  'arrow-down': <><path d="M12 5v14m6-6-6 6-6-6"/></>,
  check: <path d="m5 12 4.5 4.5L19 7"/>,
  alert: <><path d="M12 3.5 21 20H3z"/><path d="M12 9v4m0 3.5v.1"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5l3 5"/></>,
  external: <><path d="M13 5h6v6m0-6-9 9"/><path d="M18 13v6H5V6h6"/></>,
  edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5z"/><path d="m13.5 7 3.5 3.5"/></>,
  trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.4 3.2-5.2 7-5.2s6.3 1.8 7 5.2"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5"/><path d="M5 14v5h14v-5"/></>,
  link: <><path d="M10 13.5 8.5 15a3.2 3.2 0 0 1-4.5-4.5l3-3A3.2 3.2 0 0 1 11.5 7"/><path d="m14 10.5 1.5-1.5a3.2 3.2 0 0 1 4.5 4.5l-3 3A3.2 3.2 0 0 1 12.5 17"/><path d="m9 15 6-6"/></>,
}

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number; title?: string }

export function Icon({ name, size = 20, title, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      aria-label={title}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  )
}

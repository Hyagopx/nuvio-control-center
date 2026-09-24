'use client'

import type { ReactNode } from 'react'
import { Icon } from './Icon'

type ManagementToolbarProps = {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  children?: ReactNode
  className?: string
}

export function ManagementToolbar({ value, onChange, placeholder, label, children, className = '' }: ManagementToolbarProps) {
  return (
    <div className={`management-toolbar ${className}`.trim()}>
      <label className="management-search">
        <Icon name="search" size={18}/>
        <input aria-label={label} placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}/>
      </label>
      {children && <div className="management-actions">{children}</div>}
    </div>
  )
}

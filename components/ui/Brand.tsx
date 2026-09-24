type BrandProps = {
  variant?: 'mark' | 'wordmark'
  className?: string
}

export function Brand({ variant = 'wordmark', className = '' }: BrandProps) {
  const wordmark = variant === 'wordmark'
  return (
    <img
      className={`nuvio-brand nuvio-brand-${variant} ${className}`.trim()}
      src={wordmark ? '/brand/nuvio-wordmark.png' : '/brand/nuvio-icon.png'}
      alt={wordmark ? 'Nuvio' : ''}
      aria-hidden={wordmark ? undefined : true}
    />
  )
}

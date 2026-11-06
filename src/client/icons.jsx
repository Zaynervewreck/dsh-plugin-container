/** Self-contained SVG icons; no dependency on a primitives package. */

function Svg({ size = 18, className, children, viewBox = '0 0 24 24', fill = 'none' }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function DockerMark({ size = 24, className }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M7.2 10.2h2.1v2.1H7.2zM10.1 10.2h2.1v2.1h-2.1zM13 10.2h2.1v2.1H13zM10.1 7.3h2.1v2.1h-2.1zM13 7.3h2.1v2.1H13z"
        fill="currentColor"
      />
      <path
        d="M6 13.1h11.1c1 0 1.8-.3 2.4-.9.4.9.5 2.1-.2 3.1-.9 1.4-2.6 2.1-4.9 2.1H9.1c-2.8 0-4.9-1.5-5.7-3.9-.1-.4.1-.7.5-.7H6v.3Z"
        fill="currentColor"
        opacity=".9"
      />
      <path d="M4.2 17.6c1.6 1.5 3.6 2.2 6.2 2.2h4.5c2.1 0 3.6-.6 4.6-1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export const IconPlay = (props) => (
  <Svg {...props}>
    <path d="M8 5.5v13l10-6.5L8 5.5Z" />
  </Svg>
)

export const IconStop = (props) => (
  <Svg {...props}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
  </Svg>
)

export const IconRestart = (props) => (
  <Svg {...props}>
    <path d="M4.8 10.2a7.2 7.2 0 0 1 12.3-3.7l2 2" />
    <path d="M19.4 4.2v4.6h-4.6" />
    <path d="M19.2 13.8a7.2 7.2 0 0 1-12.3 3.7l-2-2" />
    <path d="M4.6 19.8v-4.6h4.6" />
  </Svg>
)

export const IconTrash = (props) => (
  <Svg {...props}>
    <path d="M4.5 7.2h15" />
    <path d="M9 7.2V5.4h6v1.8" />
    <path d="M6.5 7.2l.8 12h9.4l.8-12" />
    <path d="M10.2 10.8v5.2M13.8 10.8v5.2" />
  </Svg>
)

export const IconRefresh = (props) => (
  <Svg {...props}>
    <path d="M19.2 8.2A8 8 0 1 0 20 14" />
    <path d="M19.6 3.8v4.8h-4.8" />
  </Svg>
)

export const IconSearch = (props) => (
  <Svg {...props}>
    <circle cx="10.8" cy="10.8" r="5.8" />
    <path d="M15.2 15.2 20 20" />
  </Svg>
)

export const IconTerminal = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="m7.2 9.2 3 2.8-3 2.8M12.5 15h4" />
  </Svg>
)

export const IconBox = (props) => (
  <Svg {...props}>
    <path d="m12 3.8 7.4 4.1v8.2L12 20.2l-7.4-4.1V7.9L12 3.8Z" />
    <path d="m4.8 8 7.2 4 7.2-4M12 12v8" />
  </Svg>
)

export const IconImage = (props) => (
  <Svg {...props}>
    <rect x="3.8" y="5" width="16.4" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4.8 16.4 4.4-4.1 3.2 2.9 2.8-2.4 3.8 3.6" />
  </Svg>
)

export const IconVolume = (props) => (
  <Svg {...props}>
    <ellipse cx="12" cy="7" rx="6.5" ry="2.8" />
    <path d="M5.5 7v9.6c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9V7" />
    <path d="M5.5 12c0 1.6 2.9 2.9 6.5 2.9s6.5-1.3 6.5-2.9" />
  </Svg>
)

export const IconNetwork = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="5.5" r="2.3" />
    <circle cx="6" cy="17.5" r="2.3" />
    <circle cx="18" cy="17.5" r="2.3" />
    <path d="M10.7 7.6 7.1 15.4M13.3 7.6l3.6 7.8M8.3 17.5h7.4" />
  </Svg>
)

export const IconCompose = (props) => (
  <Svg {...props}>
    <path d="M5 4.8h11.5L20 8.3v10.9H5V4.8Z" />
    <path d="M16 4.8v4h4M8.5 12h7M8.5 15.4h5" />
  </Svg>
)

export const IconChevronDown = (props) => (
  <Svg {...props}>
    <path d="m6.5 9.2 5.5 5.4 5.5-5.4" />
  </Svg>
)

export const IconChevronRight = (props) => (
  <Svg {...props}>
    <path d="m9.2 6.5 5.4 5.5-5.4 5.5" />
  </Svg>
)

export const IconCopy = (props) => (
  <Svg {...props}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
    <path d="M15.5 8.5V6.2a1.8 1.8 0 0 0-1.8-1.8H6.2a1.8 1.8 0 0 0-1.8 1.8v7.5c0 1 .8 1.8 1.8 1.8h2.3" />
  </Svg>
)

export const IconFolder = (props) => (
  <Svg {...props}>
    <path d="M4 7.2a1.7 1.7 0 0 1 1.7-1.7h3.1l1.8 2h7.7A1.7 1.7 0 0 1 20 9.2v8.6a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.8V7.2Z" />
  </Svg>
)

export const IconClock = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
)

export const IconCheck = (props) => (
  <Svg {...props}>
    <path d="m5.5 12.5 4.1 4.1 8.9-9.2" />
  </Svg>
)

export const IconAlert = (props) => (
  <Svg {...props}>
    <path d="M12 4.2 21 19.4H3L12 4.2Z" />
    <path d="M12 9.2v4.2M12 16.8v.2" />
  </Svg>
)

export const IconInfo = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 11v5M12 8v.2" />
  </Svg>
)

export const IconX = (props) => (
  <Svg {...props}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </Svg>
)

export const IconDownload = (props) => (
  <Svg {...props}>
    <path d="M12 4.5v10.2M7.8 10.6 12 14.8l4.2-4.2M5 18.8h14" />
  </Svg>
)

export const IconExternal = (props) => (
  <Svg {...props}>
    <path d="M13.5 5H19v5.5M19 5l-7.4 7.4" />
    <path d="M18 13.5v4.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.7V7.2a1.8 1.8 0 0 1 1.8-1.8h4.2" />
  </Svg>
)

export const IconSparkles = (props) => (
  <Svg {...props}>
    <path d="M12 4.5l1.2 3.3L16.5 9l-3.3 1.2L12 13.5l-1.2-3.3L7.5 9l3.3-1.2L12 4.5Z" />
    <path d="M18 14l.7 1.8 1.8.7-1.8.7L18 19l-.7-1.8-1.8-.7 1.8-.7L18 14Z" />
    <path d="M6 15l.6 1.4L8 17l-1.4.6L6 19l-.6-1.4L4 17l1.4-.6L6 15Z" />
  </Svg>
)

export const IconExec = (props) => (
  <Svg {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="m7.2 9.2 3 2.8-3 2.8M12.5 15h4" />
    <path d="M17 9.2h.01" />
  </Svg>
)

export const IconAttach = (props) => (
  <Svg {...props}>
    <path d="M9.5 14.5 14.5 9.5" />
    <path d="M11 7.5 12.6 5.9a3.2 3.2 0 0 1 4.5 4.5L15.4 12" />
    <path d="M13 16.5 11.4 18.1a3.2 3.2 0 0 1-4.5-4.5L8.6 12" />
  </Svg>
)

export const IconSpinner = ({ size = 16, className }) => (
  <span className={className === undefined ? 'dsh-docker-spinner' : `dsh-docker-spinner ${className}`} style={{ width: size, height: size }} aria-hidden="true" />
)

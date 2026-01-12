/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Override Vite's default SVG declaration to export React component
declare module '*.svg' {
  import * as React from 'react'
  const ReactComponent: React.FunctionComponent<
    React.ComponentProps<'svg'> & { title?: string }
  >
  export default ReactComponent
}

"use client"

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cn } from "cn"

/**
 * Base UI does not expose the Radix `asChild` / `data-state` conventions that
 * prompt-kit's collapsible-driven components (chain-of-thought, steps, tool)
 * are written against. This shim keeps the Radix-shaped surface while the
 * behaviour underneath is Base UI, so the vendored components work unchanged.
 */
const CollapsibleContext = React.createContext({ open: false })

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
  ...props
}: CollapsiblePrimitive.Root.Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : uncontrolledOpen

  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      data-state={isOpen ? "open" : "closed"}
      open={isOpen}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!isControlled) setUncontrolledOpen(nextOpen)
        onOpenChange?.(nextOpen, eventDetails)
      }}
      className={cn(className)}
      {...props}
    >
      <CollapsibleContext.Provider value={{ open: isOpen }}>
        {children}
      </CollapsibleContext.Provider>
    </CollapsiblePrimitive.Root>
  )
}

function CollapsibleTrigger({
  asChild,
  className,
  children,
  ...props
}: CollapsiblePrimitive.Trigger.Props & { asChild?: boolean }) {
  const { open } = React.useContext(CollapsibleContext)

  if (asChild && React.isValidElement(children)) {
    return (
      <CollapsiblePrimitive.Trigger
        data-slot="collapsible-trigger"
        data-state={open ? "open" : "closed"}
        render={children as React.ReactElement<Record<string, unknown>>}
        className={className}
        {...props}
      />
    )
  }

  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      data-state={open ? "open" : "closed"}
      className={cn(className)}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({
  className,
  children,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  const { open } = React.useContext(CollapsibleContext)

  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      data-state={open ? "open" : "closed"}
      className={cn(className)}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Panel>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

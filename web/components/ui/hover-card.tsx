"use client"

import * as React from "react"
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"
import { cn } from "cn"

/**
 * Radix-shaped hover-card surface backed by Base UI's Preview Card. prompt-kit
 * components use `asChild` on the trigger, so the delay props live on the root
 * here and are forwarded down to the Base UI trigger.
 */
const HoverCardDelayContext = React.createContext<{
  delay?: number
  closeDelay?: number
}>({})

function HoverCard({
  openDelay,
  closeDelay,
  children,
  ...props
}: PreviewCardPrimitive.Root.Props & {
  openDelay?: number
  closeDelay?: number
}) {
  return (
    <HoverCardDelayContext.Provider
      value={{ delay: openDelay, closeDelay }}
    >
      <PreviewCardPrimitive.Root {...props}>
        {children}
      </PreviewCardPrimitive.Root>
    </HoverCardDelayContext.Provider>
  )
}

function HoverCardTrigger({
  asChild,
  delay,
  closeDelay,
  children,
  ...props
}: PreviewCardPrimitive.Trigger.Props & { asChild?: boolean }) {
  const context = React.useContext(HoverCardDelayContext)
  const resolvedDelay = delay ?? context.delay
  const resolvedCloseDelay = closeDelay ?? context.closeDelay

  if (asChild && React.isValidElement(children)) {
    return (
      <PreviewCardPrimitive.Trigger
        delay={resolvedDelay}
        closeDelay={resolvedCloseDelay}
        render={children as React.ReactElement<Record<string, unknown>>}
        {...props}
      />
    )
  }

  return (
    <PreviewCardPrimitive.Trigger
      delay={resolvedDelay}
      closeDelay={resolvedCloseDelay}
      {...props}
    >
      {children}
    </PreviewCardPrimitive.Trigger>
  )
}

function HoverCardContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<
    PreviewCardPrimitive.Positioner.Props,
    "side" | "sideOffset" | "align" | "alignOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "bg-popover text-popover-foreground z-50 w-64 origin-(--transform-origin) rounded-md border shadow-md outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }

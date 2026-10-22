import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--ui-popover)",
          "--normal-text": "var(--ui-popover-foreground)",
          "--normal-border": "var(--ui-border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

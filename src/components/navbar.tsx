"use client"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useAuth } from "@/lib/hooks/useAuth"
import { cn } from "@/lib/utils"
import {
  CloudIcon,
  FolderIcon,
  HistoryIcon,
  HomeIcon,
  LogOutIcon,
  MenuIcon,
  ServerIcon,
  SettingsIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

const navItems = [
  {
    name: "Dashboard",
    href: "/",
    icon: HomeIcon,
  },
  {
    name: "Servers",
    href: "/servers",
    icon: ServerIcon,
  },
  {
    name: "S3",
    href: "/s3-profiles",
    icon: CloudIcon,
  },
  {
    name: "Backups",
    href: "/backups",
    icon: FolderIcon,
  },
  {
    name: "History",
    href: "/history",
    icon: HistoryIcon,
  },
  {
    name: "Settings",
    href: "/settings",
    icon: SettingsIcon,
  },
]

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Navbar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const auth = useAuth()
  const showLogout = Boolean(auth.data?.authEnabled)

  return (
    <header className="sticky top-0 z-[100] w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-14 w-[90%] items-center justify-between">
        <div className="flex items-center">
          <Link href="/" className="flex items-center space-x-2">
            <ServerIcon className="h-6 w-6" />
            <span className="font-bold">LazyBackup</span>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden items-center space-x-4 md:flex lg:space-x-6">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center transition-colors hover:text-foreground/80",
                  active ? "text-foreground" : "text-foreground/60"
                )}
              >
                <item.icon className="mr-2 h-4 w-4" />
                <span className="hidden lg:inline">{item.name}</span>
              </Link>
            )
          })}
          {showLogout && (
            <Button
              variant="ghost"
              size="sm"
              className="text-foreground/60 hover:text-foreground"
              onClick={() => auth.logout.mutate()}
              disabled={auth.logout.isPending}
            >
              <LogOutIcon className="mr-2 h-4 w-4" />
              <span className="hidden lg:inline">Logout</span>
            </Button>
          )}
        </nav>

        {/* Mobile Navigation */}
        {/* modal={false}: avoid Radix body pointer-events lock (cleanup can stick and freeze the whole app) */}
        <Sheet modal={false} open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="outline" size="icon" className="h-9 w-9">
              <MenuIcon className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            showOverlay={false}
            className="flex w-[min(100vw-2rem,20rem)] flex-col gap-0 border-l p-0 sm:max-w-sm"
          >
            <SheetHeader className="border-b px-5 py-4 text-left">
              <SheetTitle className="flex items-center gap-2 text-base">
                <ServerIcon className="h-5 w-5" />
                LazyBackup
              </SheetTitle>
              <SheetDescription className="sr-only">
                Main navigation
              </SheetDescription>
            </SheetHeader>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {navItems.map((item) => {
                const active = isActivePath(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {item.name}
                  </Link>
                )
              })}
            </nav>

            {showLogout && (
              <div className="border-t px-3 py-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                  onClick={() => {
                    setOpen(false)
                    auth.logout.mutate()
                  }}
                  disabled={auth.logout.isPending}
                >
                  <LogOutIcon className="h-4 w-4 shrink-0" />
                  Logout
                </button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}

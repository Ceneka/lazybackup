"use client"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
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

export function Navbar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const auth = useAuth()
  const showLogout = Boolean(auth.data?.authEnabled)

  return (
    <header className="sticky top-0 z-[100] w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 w-[90%] items-center justify-between mx-auto">
        <div className="flex items-center">
          <Link href="/" className="flex items-center space-x-2">
            <ServerIcon className="h-6 w-6" />
            <span className="font-bold">LazyBackup</span>
          </Link>
        </div>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-4 lg:space-x-6">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center transition-colors hover:text-foreground/80",
                pathname === item.href
                  ? "text-foreground"
                  : "text-foreground/60"
              )}
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span className="hidden lg:inline">{item.name}</span>
            </Link>
          ))}
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
            <Button variant="outline" size="icon" className="h-8 w-8 p-0">
              <MenuIcon className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" showOverlay={false} className="w-[240px] sm:w-[300px]">
            <nav className="flex flex-col gap-4 mt-8">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center p-2 transition-colors hover:text-foreground/80",
                    pathname === item.href
                      ? "text-foreground"
                      : "text-foreground/60"
                  )}
                >
                  <item.icon className="mr-2 h-5 w-5" />
                  {item.name}
                </Link>
              ))}
              {showLogout && (
                <button
                  type="button"
                  className="flex items-center p-2 text-left text-foreground/60 hover:text-foreground/80"
                  onClick={() => {
                    setOpen(false)
                    auth.logout.mutate()
                  }}
                  disabled={auth.logout.isPending}
                >
                  <LogOutIcon className="mr-2 h-5 w-5" />
                  Logout
                </button>
              )}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}

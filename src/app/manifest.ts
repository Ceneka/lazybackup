import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-version"
import type { MetadataRoute } from "next"

/** Matches `.dark --background` in globals.css (oklch 0.13 / slate-950). */
const DARK_BACKGROUND = "#030712"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "LazyBackup",
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: DARK_BACKGROUND,
    theme_color: DARK_BACKGROUND,
    icons: [
      {
        src: "/icon.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  }
}

import pkg from "../../package.json"

/** Semver from the root package.json. UI and MCP share this. */
export const APP_VERSION: string = pkg.version

export const APP_NAME = "LazyBackup"

export const APP_DESCRIPTION: string = pkg.description

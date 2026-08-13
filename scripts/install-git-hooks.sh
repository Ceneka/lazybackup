#!/bin/sh
# Wire .githooks for this clone. No-op without a git checkout (Docker builds).
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks

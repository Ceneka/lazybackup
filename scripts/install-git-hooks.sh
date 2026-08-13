#!/bin/sh
# Wire .githooks for this clone. No-op without git / a checkout (Docker builds).
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks

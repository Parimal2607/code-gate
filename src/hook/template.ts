/** Marker used to recognise (and safely overwrite) a hook we installed. */
export const HOOK_MARKER = '# managed-by: code-gate';

export const HOOK_VERSION = 1;

/**
 * POSIX sh pre-push hook. Git ships its own sh on Windows, so this works on
 * Windows, macOS and Linux.
 *
 * Resolution order:
 *   1. a project-local install (node_modules/.bin/code-gate)
 *   2. the global `code-gate` binary
 * If neither exists the push is blocked, because an unverifiable push is not a
 * verified push. Set CODE_GATE_OPTIONAL=1 to downgrade that to a warning.
 */
export function renderPrePushHook(): string {
    return `#!/bin/sh
${HOOK_MARKER}
# hook-version: ${HOOK_VERSION}
#
# Installed by \`code-gate init\`. Runs the project's quality checks before a
# push is allowed. Exit code 0 lets git continue, exit code 1 blocks the push.
# Remove with \`code-gate uninstall\`. Bypass once with \`git push --no-verify\`.

if [ "\${CODE_GATE_SKIP:-0}" = "1" ]; then
  echo "code-gate: skipped (CODE_GATE_SKIP=1)"
  exit 0
fi

remote_name="\$1"
remote_url="\$2"

local_bin="./node_modules/.bin/code-gate"

if [ -x "\$local_bin" ]; then
  exec "\$local_bin" check --hook pre-push --remote "\$remote_name"
fi

if command -v code-gate >/dev/null 2>&1; then
  exec code-gate check --hook pre-push --remote "\$remote_name"
fi

echo ""
echo "code-gate: command not found."
echo "  Install it globally:  npm install -g code-gate"
echo "  Or as a dev dep:      npm install --save-dev code-gate"
echo ""
echo "Push blocked because the quality gate could not run."
echo "Bypass once with: git push --no-verify"
echo ""

if [ "\${CODE_GATE_OPTIONAL:-0}" = "1" ]; then
  exit 0
fi

exit 1
`;
}

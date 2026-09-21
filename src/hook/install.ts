import fs from 'node:fs';
import path from 'node:path';

import { getHooksDir } from '../git/git';
import { HOOK_MARKER, renderPrePushHook } from './template';

/**
 * Absolute path to this installation's CLI entry point, baked into the hook so
 * it cannot accidentally run a different package that happens to publish a
 * `code-gate` binary.
 */
export function resolveCliPath(): string | undefined {
    const candidate = path.resolve(__dirname, '..', 'cli.js');
    return fs.existsSync(candidate) ? candidate : undefined;
}

export type HookAction = 'created' | 'updated' | 'unchanged' | 'replaced' | 'blocked';

export interface InstallHookResult {
    action: HookAction;
    hookPath?: string;
    backupPath?: string;
    /** Set when action is 'blocked'. */
    reason?: string;
}

export function hookPathFor(cwd: string): string | undefined {
    const hooksDir = getHooksDir(cwd);
    return hooksDir ? path.join(hooksDir, 'pre-push') : undefined;
}

export function isCodeGateHook(contents: string): boolean {
    return contents.includes(HOOK_MARKER) || /\bcode-gate\b/.test(contents);
}

/** True when a pre-push hook installed by code-gate is present and up to date. */
export function readInstalledHook(cwd: string): {
    exists: boolean;
    managed: boolean;
    /** False when the hook was written by an older version of code-gate. */
    current: boolean;
    hookPath?: string;
} {
    const hookPath = hookPathFor(cwd);
    if (!hookPath || !fs.existsSync(hookPath)) return { exists: false, managed: false, current: false, hookPath };

    const contents = fs.readFileSync(hookPath, 'utf8');
    const managed = isCodeGateHook(contents);
    const current = managed && contents === renderPrePushHook({ cliPath: resolveCliPath() });

    return { exists: true, managed, current, hookPath };
}

export function installPrePushHook(cwd: string, options: { force?: boolean } = {}): InstallHookResult {
    const hookPath = hookPathFor(cwd);
    if (!hookPath) return { action: 'blocked', reason: 'not a git repository' };

    fs.mkdirSync(path.dirname(hookPath), { recursive: true });

    const desired = renderPrePushHook({ cliPath: resolveCliPath() });
    let backupPath: string | undefined;
    let action: HookAction = 'created';

    if (fs.existsSync(hookPath)) {
        const existing = fs.readFileSync(hookPath, 'utf8');

        if (existing === desired) {
            ensureExecutable(hookPath);
            return { action: 'unchanged', hookPath };
        }

        if (isCodeGateHook(existing)) {
            action = 'updated';
        } else if (options.force) {
            backupPath = `${hookPath}.backup`;
            let counter = 1;
            while (fs.existsSync(backupPath)) {
                backupPath = `${hookPath}.backup.${counter}`;
                counter += 1;
            }
            fs.copyFileSync(hookPath, backupPath);
            action = 'replaced';
        } else {
            return {
                action: 'blocked',
                hookPath,
                reason: 'an unrelated pre-push hook already exists (re-run with --force to back it up and replace it)',
            };
        }
    }

    // Always LF: git runs the hook through sh, which chokes on CRLF.
    fs.writeFileSync(hookPath, desired.replace(/\r\n/g, '\n'), { encoding: 'utf8' });
    ensureExecutable(hookPath);

    return { action, hookPath, backupPath };
}

export function uninstallPrePushHook(cwd: string): { removed: boolean; hookPath?: string; reason?: string } {
    const installed = readInstalledHook(cwd);
    if (!installed.hookPath) return { removed: false, reason: 'not a git repository' };
    if (!installed.exists) return { removed: false, hookPath: installed.hookPath, reason: 'no pre-push hook found' };
    if (!installed.managed) {
        return { removed: false, hookPath: installed.hookPath, reason: 'pre-push hook was not installed by code-gate' };
    }

    fs.rmSync(installed.hookPath);
    return { removed: true, hookPath: installed.hookPath };
}

function ensureExecutable(filePath: string): void {
    try {
        fs.chmodSync(filePath, 0o755);
    } catch {
        // chmod is a no-op / may fail on Windows; git uses its own sh there.
    }
}

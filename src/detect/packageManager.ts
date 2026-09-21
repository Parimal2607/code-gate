import path from 'node:path';

import { fileExists } from '../core/json';
import type { PackageJson, PackageManager } from '../core/types';

const LOCK_FILES: Array<{ file: string; manager: PackageManager }> = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'npm-shrinkwrap.json', manager: 'npm' },
];

export interface PackageManagerDetection {
    manager: PackageManager;
    reason: string;
}

/**
 * Detect the package manager from `packageManager` in package.json first
 * (it is authoritative), then from lock files, searching upwards so that
 * packages inside a monorepo resolve to the workspace root lock file.
 */
export function detectPackageManager(root: string, pkg: PackageJson | undefined): PackageManagerDetection {
    const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager : undefined;
    if (declared) {
        const name = declared.split('@')[0] as PackageManager;
        if (['npm', 'yarn', 'pnpm', 'bun'].includes(name)) {
            return { manager: name, reason: `package.json packageManager: ${declared}` };
        }
    }

    let current = path.resolve(root);
    for (;;) {
        for (const { file, manager } of LOCK_FILES) {
            if (fileExists(path.join(current, file))) {
                const where = current === path.resolve(root) ? file : path.join(current, file);
                return { manager, reason: `lock file: ${where}` };
            }
        }

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return { manager: 'npm', reason: 'no lock file found, defaulting to npm' };
}

/** How to invoke a package.json script with the detected package manager. */
export function runScriptCommand(manager: PackageManager, script: string): { command: string; args: string[] } {
    switch (manager) {
        case 'yarn':
            return { command: 'yarn', args: [script] };
        case 'pnpm':
            return { command: 'pnpm', args: ['run', script] };
        case 'bun':
            return { command: 'bun', args: ['run', script] };
        case 'npm':
        default:
            return { command: 'npm', args: ['run', script, '--silent'] };
    }
}

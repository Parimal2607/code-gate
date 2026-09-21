import fs from 'node:fs';
import path from 'node:path';

import { fileExists, readJsonFile } from '../core/json';
import type { PackageJson, ToolInfo } from '../core/types';

/**
 * Walk up from `startDir` looking for `node_modules/<name>/package.json`.
 *
 * This is used instead of `require.resolve` because modern packages
 * (Prettier 3, ESLint 9) restrict their `exports` map, which makes
 * `require.resolve('prettier/package.json')` throw even when the package is
 * installed. Walking the filesystem also works with pnpm's symlinked layout.
 */
export function findPackageDir(startDir: string, name: string): string | undefined {
    let current = path.resolve(startDir);

    for (;;) {
        const candidate = path.join(current, 'node_modules', ...name.split('/'));
        if (fileExists(path.join(candidate, 'package.json'))) return candidate;

        const parent = path.dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/** Resolve the JS entry point of a package's binary. */
function resolveBinPath(packageDir: string, pkg: PackageJson, binName: string): string | undefined {
    const bin = pkg.bin as string | Record<string, string> | undefined;
    let relative: string | undefined;

    if (typeof bin === 'string') {
        relative = bin;
    } else if (bin && typeof bin === 'object') {
        relative = bin[binName] ?? Object.values(bin)[0];
    }

    if (!relative) return undefined;

    const absolute = path.join(packageDir, relative);
    return fileExists(absolute) ? absolute : undefined;
}

export interface DetectToolOptions {
    /** Project directory used as the search root. */
    root: string;
    /** npm package name, e.g. `typescript`. */
    packageName: string;
    /** Key inside the package's `bin` field, e.g. `tsc`. */
    binName: string;
}

export function detectTool({ root, packageName, binName }: DetectToolOptions): ToolInfo {
    const packageDir = findPackageDir(root, packageName);
    if (!packageDir) return { name: packageName, installed: false };

    const pkg = readJsonFile<PackageJson>(path.join(packageDir, 'package.json'));

    return {
        name: packageName,
        installed: true,
        version: pkg?.version,
        packageDir,
        binPath: pkg ? resolveBinPath(packageDir, pkg, binName) : undefined,
    };
}

/**
 * Build a spawn-ready command for a tool.
 *
 * Executing the resolved JS file with the current Node binary avoids the
 * `.cmd` shim / shell quoting problems that plague Windows, and guarantees the
 * project's own installed version is used.
 */
export function toolCommand(tool: ToolInfo, args: string[]): { command: string; args: string[] } | undefined {
    if (!tool.installed || !tool.binPath) return undefined;
    return { command: process.execPath, args: [tool.binPath, ...args] };
}

/** Major version number of an installed tool, or 0 when unknown. */
export function majorVersion(tool: ToolInfo): number {
    const match = /^(\d+)\./.exec(tool.version ?? '');
    return match ? Number(match[1]) : 0;
}

/** True when `name` appears in any dependency section of package.json. */
export function hasDependency(pkg: PackageJson | undefined, name: string): boolean {
    if (!pkg) return false;
    const sections = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies];
    return sections.some((section) => Boolean(section && name in section));
}

/** Shallow, depth-limited search for files with the given extensions. */
export function findFilesByExtension(
    root: string,
    extensions: string[],
    options: { maxDepth?: number; limit?: number; skipDirs?: string[] } = {}
): string[] {
    const maxDepth = options.maxDepth ?? 4;
    const limit = options.limit ?? 1;
    const skipDirs = new Set(
        options.skipDirs ?? ['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo', '.cache']
    );
    const found: string[] = [];

    const walk = (dir: string, depth: number): void => {
        if (found.length >= limit || depth > maxDepth) return;

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (found.length >= limit) return;
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
                walk(full, depth + 1);
            } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
                found.push(full);
            }
        }
    };

    walk(root, 0);
    return found;
}

/**
 * List source files without git, used when code-gate runs outside a repository.
 * Paths are relative to `root` with POSIX separators.
 */
export function listProjectFiles(root: string, extensions: string[]): string[] {
    return findFilesByExtension(root, extensions, { maxDepth: 12, limit: 20000 })
        .map((file) => path.relative(root, file).split(path.sep).join('/'))
        .sort();
}

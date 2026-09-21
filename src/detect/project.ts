import path from 'node:path';

import { fileExists, readJsonFile } from '../core/json';
import type { Language, PackageJson, ProjectInfo, ToolInfo } from '../core/types';
import { getGitRoot } from '../git/git';
import { detectPackageManager } from './packageManager';
import { detectTool, findFilesByExtension, hasDependency } from './packages';

const PRETTIER_CONFIG_FILES = [
    '.prettierrc',
    '.prettierrc.json',
    '.prettierrc.json5',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.mjs',
    '.prettierrc.ts',
    'prettier.config.js',
    'prettier.config.cjs',
    'prettier.config.mjs',
    'prettier.config.ts',
];

const ESLINT_FLAT_CONFIG_FILES = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts',
];

const ESLINT_LEGACY_CONFIG_FILES = [
    '.eslintrc',
    '.eslintrc.json',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.yaml',
    '.eslintrc.yml',
];

const TSCONFIG_FILES = ['tsconfig.json', 'tsconfig.base.json'];

/** Walk up from `cwd` to the nearest directory containing package.json. */
export function findProjectRoot(cwd: string): { root: string; packageJsonPath?: string } {
    let current = path.resolve(cwd);

    for (;;) {
        const candidate = path.join(current, 'package.json');
        if (fileExists(candidate)) return { root: current, packageJsonPath: candidate };

        const parent = path.dirname(current);
        if (parent === current) return { root: path.resolve(cwd) };
        current = parent;
    }
}

function findFirstExisting(root: string, candidates: string[]): string | undefined {
    for (const candidate of candidates) {
        const full = path.join(root, candidate);
        if (fileExists(full)) return full;
    }
    return undefined;
}

function detectPrettier(root: string, pkg: PackageJson | undefined): ToolInfo {
    const tool = detectTool({ root, packageName: 'prettier', binName: 'prettier' });
    const configPath = findFirstExisting(root, PRETTIER_CONFIG_FILES);

    if (configPath) tool.configPath = configPath;
    else if (pkg && pkg.prettier !== undefined) tool.configInPackageJson = true;

    return tool;
}

function detectEslint(root: string, pkg: PackageJson | undefined): ToolInfo {
    const tool = detectTool({ root, packageName: 'eslint', binName: 'eslint' });
    const configPath =
        findFirstExisting(root, ESLINT_FLAT_CONFIG_FILES) ?? findFirstExisting(root, ESLINT_LEGACY_CONFIG_FILES);

    if (configPath) tool.configPath = configPath;
    else if (pkg && pkg.eslintConfig !== undefined) tool.configInPackageJson = true;

    return tool;
}

interface TsconfigShape {
    compilerOptions?: { composite?: boolean; incremental?: boolean };
}

function detectLanguage(
    root: string,
    pkg: PackageJson | undefined,
    tsconfigPath: string | undefined,
    typescriptTool: ToolInfo
): { language: Language; reasons: string[] } {
    const reasons: string[] = [];

    if (tsconfigPath) reasons.push(`found ${path.basename(tsconfigPath)}`);
    if (typescriptTool.installed) reasons.push(`typescript installed (${typescriptTool.version ?? 'unknown'})`);
    if (hasDependency(pkg, 'typescript')) reasons.push('typescript in package.json dependencies');

    const tsFiles = findFilesByExtension(root, ['.ts', '.tsx', '.mts', '.cts'], { limit: 1 });
    if (tsFiles.length > 0) reasons.push(`found ${path.relative(root, tsFiles[0] as string)}`);

    // tsconfig.json is the strongest signal, followed by real .ts sources.
    if (tsconfigPath || tsFiles.length > 0) return { language: 'typescript', reasons };

    // typescript installed but no tsconfig and no .ts files: treat as JS.
    const jsFiles = findFilesByExtension(root, ['.js', '.jsx', '.mjs', '.cjs'], { limit: 1 });
    if (jsFiles.length > 0) {
        reasons.push(`found ${path.relative(root, jsFiles[0] as string)}`);
        return { language: 'javascript', reasons };
    }

    if (pkg) {
        reasons.push('package.json present, no TypeScript signals');
        return { language: 'javascript', reasons };
    }

    reasons.push('no package.json and no source files detected');
    return { language: 'unknown', reasons };
}

function detectFrameworks(pkg: PackageJson | undefined, root: string): { frameworks: string[]; label: string } {
    const frameworks: string[] = [];

    if (hasDependency(pkg, 'next')) frameworks.push('Next.js');
    if (hasDependency(pkg, 'nuxt') || hasDependency(pkg, 'nuxt3')) frameworks.push('Nuxt');
    if (hasDependency(pkg, '@remix-run/react')) frameworks.push('Remix');
    if (hasDependency(pkg, '@angular/core')) frameworks.push('Angular');
    if (hasDependency(pkg, 'svelte')) frameworks.push('Svelte');
    if (hasDependency(pkg, 'vue')) frameworks.push('Vue');
    if (hasDependency(pkg, 'react')) frameworks.push('React');
    if (hasDependency(pkg, 'vite')) frameworks.push('Vite');
    if (hasDependency(pkg, 'nest') || hasDependency(pkg, '@nestjs/core')) frameworks.push('NestJS');
    if (hasDependency(pkg, 'express')) frameworks.push('Express');
    if (hasDependency(pkg, 'fastify')) frameworks.push('Fastify');

    if (frameworks.length === 0) {
        if (pkg) {
            frameworks.push('Node.js');
        } else if (findFilesByExtension(root, ['.js', '.ts'], { limit: 1 }).length > 0) {
            frameworks.push('Node.js');
        } else {
            frameworks.push('Unknown');
        }
    }

    return { frameworks, label: frameworks[0] as string };
}

export function detectProject(cwd: string): ProjectInfo {
    const { root, packageJsonPath } = findProjectRoot(cwd);
    const pkg = packageJsonPath ? readJsonFile<PackageJson>(packageJsonPath) : undefined;

    const typescript = detectTool({ root, packageName: 'typescript', binName: 'tsc' });
    const tsconfigPath = findFirstExisting(root, TSCONFIG_FILES);
    const tsconfig = tsconfigPath ? readJsonFile<TsconfigShape>(tsconfigPath) : undefined;

    const { language, reasons } = detectLanguage(root, pkg, tsconfigPath, typescript);
    const { frameworks, label } = detectFrameworks(pkg, root);
    const packageManager = detectPackageManager(root, pkg);

    return {
        root,
        gitRoot: getGitRoot(root),
        packageJsonPath,
        pkg,
        language,
        languageReasons: reasons,
        frameworks,
        frameworkLabel: label,
        packageManager: packageManager.manager,
        packageManagerReason: packageManager.reason,
        tsconfigPath,
        tsconfigComposite: Boolean(tsconfig?.compilerOptions?.composite),
        scripts: (pkg?.scripts ?? {}) as Record<string, string>,
        tools: {
            prettier: detectPrettier(root, pkg),
            eslint: detectEslint(root, pkg),
            typescript,
        },
    };
}

export const configFileNames = {
    prettier: PRETTIER_CONFIG_FILES,
    eslintFlat: ESLINT_FLAT_CONFIG_FILES,
    eslintLegacy: ESLINT_LEGACY_CONFIG_FILES,
};

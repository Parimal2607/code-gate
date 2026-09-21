import type { CheckResult, CheckStatus, ProjectInfo } from '../core/types';

/** Extensions Prettier can format out of the box. */
export const PRETTIER_EXTENSIONS = [
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.json',
    '.jsonc',
    '.json5',
    '.css',
    '.scss',
    '.less',
    '.html',
    '.vue',
    '.svelte',
    '.md',
    '.mdx',
    '.yaml',
    '.yml',
    '.graphql',
    '.gql',
];

/** Extensions ESLint is normally configured to lint. */
export const ESLINT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte'];

export const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];

export function filterByExtension(files: string[], extensions: string[]): string[] {
    return files.filter((file) => extensions.some((ext) => file.toLowerCase().endsWith(ext)));
}

/** Drop files matching simple `ignore` patterns from .code-gate.json. */
export function applyIgnore(files: string[], patterns: string[]): string[] {
    if (patterns.length === 0) return files;

    const regexes = patterns.map((pattern) => {
        const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '\u0000')
            .replace(/\*/g, '[^/]*')
            .replace(/\u0000/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${escaped}$`);
    });

    return files.filter((file) => !regexes.some((regex) => regex.test(file)));
}

/**
 * Split file lists so a single command line stays well under the OS limit
 * (~8191 chars on Windows cmd, 32k for CreateProcess).
 */
export function chunkFiles(files: string[], maxChars = 6000, maxCount = 150): string[][] {
    const chunks: string[][] = [];
    let current: string[] = [];
    let length = 0;

    for (const file of files) {
        const cost = file.length + 3;
        if (current.length > 0 && (length + cost > maxChars || current.length >= maxCount)) {
            chunks.push(current);
            current = [];
            length = 0;
        }
        current.push(file);
        length += cost;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
}

const NPM_PLACEHOLDER_TEST = /no test specified/i;

/**
 * Find a usable script, ignoring npm's default `test` placeholder which always
 * exits 1 and would block every push.
 */
export function findScript(project: ProjectInfo, candidates: string[]): { name: string; value: string } | undefined {
    for (const name of candidates) {
        const value = project.scripts[name];
        if (!value) continue;
        if (name === 'test' && NPM_PLACEHOLDER_TEST.test(value)) continue;
        return { name, value };
    }
    return undefined;
}

export interface ResultInput {
    id: string;
    name: string;
    status: CheckStatus;
    message?: string;
    output?: string;
    command?: string;
    startedAt: number;
}

export function result(input: ResultInput): CheckResult {
    return {
        id: input.id,
        name: input.name,
        status: input.status,
        message: input.message,
        output: input.output && input.output.trim().length > 0 ? input.output.trim() : undefined,
        command: input.command,
        durationMs: Date.now() - input.startedAt,
    };
}

/** Keep failure output readable when a tool prints thousands of lines. */
export function truncateOutput(text: string, maxLines = 60): string {
    const lines = text.replace(/\s+$/, '').split(/\r?\n/);
    if (lines.length <= maxLines) return lines.join('\n');
    const hidden = lines.length - maxLines;
    return [...lines.slice(0, maxLines), `... ${hidden} more line(s) hidden`].join('\n');
}

import fs from 'node:fs';
import path from 'node:path';

import { diffLines, normalizeEol, renderHunks, splitLines } from '../core/diff';
import { exec } from '../core/exec';
import type { ToolInfo } from '../core/types';
import { toolCommand } from '../detect/packages';

/** Files listed by `prettier --check`, e.g. `[warn] src/app/page.tsx`. */
export function parseCheckOutput(output: string, candidates: string[]): string[] {
    const known = new Set(candidates.map((file) => file.replace(/\\/g, '/')));
    const failing: string[] = [];

    for (const line of output.split(/\r?\n/)) {
        const match = /^\[warn\]\s+(.+?)\s*$/.exec(line);
        if (!match) continue;

        const candidate = (match[1] as string).replace(/\\/g, '/');
        // Skip prettier's summary lines, keep only real paths we asked about.
        if (known.has(candidate)) failing.push(candidate);
    }

    return failing;
}

export interface DescribeOptions {
    tool: ToolInfo;
    root: string;
    files: string[];
    env: NodeJS.ProcessEnv;
    /** Stop after this many files to keep the output readable. */
    maxFiles?: number;
}

/**
 * Turn a list of badly formatted files into a line-numbered report.
 *
 * Prettier is run again per file to capture what it *would* write, which is
 * then diffed against the file on disk. Line-ending-only and
 * trailing-newline-only differences are called out explicitly, because a plain
 * diff of those looks empty and is confusing.
 */
export async function describeFormattingIssues(options: DescribeOptions): Promise<string> {
    const maxFiles = options.maxFiles ?? 10;
    const command = toolCommand(options.tool, []);
    if (!command) return '';

    const sections: string[] = [];

    for (const file of options.files.slice(0, maxFiles)) {
        const absolute = path.resolve(options.root, file);

        let onDisk: string;
        try {
            onDisk = fs.readFileSync(absolute, 'utf8');
        } catch {
            sections.push(`${file}\n      (could not read file)`);
            continue;
        }

        const run = await exec(command.command, [...command.args, '--no-color', file], {
            cwd: options.root,
            env: options.env,
        });

        if (run.code !== 0 || run.stdout.length === 0) {
            sections.push(`${file}\n      (Prettier could not produce formatted output)`);
            continue;
        }

        const expected = run.stdout;
        if (expected === onDisk) continue;

        const detail = describeDifference(onDisk, expected);
        sections.push([file, ...detail].join('\n'));
    }

    if (options.files.length > maxFiles) {
        sections.push(`... ${options.files.length - maxFiles} more file(s) need formatting`);
    }

    return sections.join('\n\n');
}

function describeDifference(onDisk: string, expected: string): string[] {
    const normalizedDisk = normalizeEol(onDisk);
    const normalizedExpected = normalizeEol(expected);

    if (normalizedDisk === normalizedExpected) {
        const diskCrlf = /\r\n/.test(onDisk);
        return [
            `      line endings: file uses ${diskCrlf ? 'CRLF' : 'LF'}, Prettier expects ${diskCrlf ? 'LF' : 'CRLF'}`,
            '      content is otherwise identical (see Prettier\'s "endOfLine" option)',
        ];
    }

    if (normalizedDisk.replace(/\n+$/, '') === normalizedExpected.replace(/\n+$/, '')) {
        const diskEndsWithNewline = normalizedDisk.endsWith('\n');
        return [
            `      end of file: ${diskEndsWithNewline ? 'extra blank line(s) at the end' : 'missing newline at the end'}`,
        ];
    }

    const hunks = diffLines(splitLines(normalizedDisk), splitLines(normalizedExpected));
    if (hunks.length === 0) return ['      (whitespace-only difference)'];

    return renderHunks(hunks).map((line) => `   ${line}`);
}

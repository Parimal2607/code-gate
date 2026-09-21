/**
 * Minimal line diff, used to turn "this file is badly formatted" into
 * "line 12 should look like this".
 *
 * Prettier's `--check` only prints file names, so the check re-formats the
 * failing file in memory and diffs it against what is on disk.
 */

export interface DiffHunk {
    /** 1-based line number in the original file where the hunk starts. */
    line: number;
    /** Lines currently in the file. */
    removed: string[];
    /** Lines Prettier would write instead. */
    added: string[];
}

/** Cap on the DP table so a huge file cannot stall the push. */
const MAX_CELLS = 1_000_000;

export function splitLines(text: string): string[] {
    return text.split('\n');
}

export function normalizeEol(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

function commonPrefixLength(a: string[], b: string[]): number {
    const max = Math.min(a.length, b.length);
    let index = 0;
    while (index < max && a[index] === b[index]) index += 1;
    return index;
}

function commonSuffixLength(a: string[], b: string[], skip: number): number {
    const max = Math.min(a.length, b.length) - skip;
    let index = 0;
    while (index < max && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
    return index;
}

/**
 * Longest common subsequence over lines, then grouped into hunks.
 *
 * Identical prefixes and suffixes are trimmed first, which makes the DP table
 * tiny for the usual case of a few reformatted lines in a large file.
 */
export function diffLines(original: string[], formatted: string[]): DiffHunk[] {
    const prefix = commonPrefixLength(original, formatted);
    const suffix = commonSuffixLength(original, formatted, prefix);

    const a = original.slice(prefix, original.length - suffix);
    const b = formatted.slice(prefix, formatted.length - suffix);

    if (a.length === 0 && b.length === 0) return [];

    // Pure insertion or deletion: no need for the DP table.
    if (a.length === 0 || b.length === 0 || (a.length + 1) * (b.length + 1) > MAX_CELLS) {
        return [{ line: prefix + 1, removed: a, added: b }];
    }

    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);

    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i * width + j] =
                a[i] === b[j]
                    ? (table[(i + 1) * width + (j + 1)] as number) + 1
                    : Math.max(table[(i + 1) * width + j] as number, table[i * width + (j + 1)] as number);
        }
    }

    const hunks: DiffHunk[] = [];
    let current: DiffHunk | undefined;
    let i = 0;
    let j = 0;

    const push = (line: number): DiffHunk => {
        if (!current) {
            current = { line, removed: [], added: [] };
            hunks.push(current);
        }
        return current;
    };

    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            current = undefined;
            i += 1;
            j += 1;
            continue;
        }

        if ((table[(i + 1) * width + j] as number) >= (table[i * width + (j + 1)] as number)) {
            push(prefix + i + 1).removed.push(a[i] as string);
            i += 1;
        } else {
            push(prefix + i + 1).added.push(b[j] as string);
            j += 1;
        }
    }

    while (i < a.length) {
        push(prefix + i + 1).removed.push(a[i] as string);
        i += 1;
    }

    while (j < b.length) {
        push(prefix + i + 1).added.push(b[j] as string);
        j += 1;
    }

    return hunks;
}

export interface RenderOptions {
    /** Maximum hunks printed per file. */
    maxHunks?: number;
    /** Maximum lines printed per hunk side. */
    maxLinesPerHunk?: number;
    /** Width reserved for the line number gutter. */
    gutter?: number;
}

/** Render hunks as a line-numbered `-` / `+` listing. */
export function renderHunks(hunks: DiffHunk[], options: RenderOptions = {}): string[] {
    const maxHunks = options.maxHunks ?? 5;
    const maxLines = options.maxLinesPerHunk ?? 6;
    const gutter = options.gutter ?? 5;
    const lines: string[] = [];

    for (const hunk of hunks.slice(0, maxHunks)) {
        const label = String(hunk.line).padStart(gutter);
        let first = true;

        const emit = (marker: string, text: string): void => {
            lines.push(`${first ? label : ' '.repeat(gutter)} ${marker} ${text}`);
            first = false;
        };

        for (const line of hunk.removed.slice(0, maxLines)) emit('-', line);
        if (hunk.removed.length > maxLines) emit(' ', `... ${hunk.removed.length - maxLines} more line(s)`);

        for (const line of hunk.added.slice(0, maxLines)) emit('+', line);
        if (hunk.added.length > maxLines) emit(' ', `... ${hunk.added.length - maxLines} more line(s)`);
    }

    if (hunks.length > maxHunks) {
        lines.push(`${' '.repeat(gutter)}   ... ${hunks.length - maxHunks} more change(s) in this file`);
    }

    return lines;
}

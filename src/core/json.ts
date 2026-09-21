import fs from 'node:fs';

/**
 * Remove `//` and block comments plus trailing commas so that JSON-with-comments
 * files (tsconfig.json, .eslintrc, .code-gate.json) can be parsed with JSON.parse.
 */
export function stripJsonComments(input: string): string {
    let result = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i] as string;
        const next = input[i + 1];

        if (inLineComment) {
            if (char === '\n') {
                inLineComment = false;
                result += char;
            }
            continue;
        }

        if (inBlockComment) {
            if (char === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inString) {
            result += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            result += char;
            continue;
        }

        if (char === '/' && next === '/') {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }

        result += char;
    }

    // Trailing commas before } or ]
    return result.replace(/,(\s*[}\]])/g, '$1');
}

export function readJsonFile<T = unknown>(filePath: string): T | undefined {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(stripJsonComments(raw)) as T;
    } catch {
        return undefined;
    }
}

export function fileExists(filePath: string): boolean {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

export function dirExists(dirPath: string): boolean {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch {
        return false;
    }
}

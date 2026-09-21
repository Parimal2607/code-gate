import type { CheckStatus } from './types';

const supportsColor = (() => {
    if (process.env.NO_COLOR) return false;
    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
    if (process.env.TERM === 'dumb') return false;
    return Boolean(process.stdout.isTTY);
})();

/**
 * Windows consoles using a legacy code page mangle box drawing and check marks.
 * Fall back to ASCII unless the terminal is known to handle UTF-8.
 */
const supportsUnicode = (() => {
    if (process.env.CODE_GATE_ASCII === '1') return false;
    if (process.platform !== 'win32') return true;
    return Boolean(
        process.env.WT_SESSION ||
            process.env.TERM_PROGRAM ||
            process.env.ConEmuANSI ||
            process.env.TERM ||
            process.env.CODE_GATE_UNICODE === '1'
    );
})();

function wrap(open: string, text: string): string {
    return supportsColor ? `\u001b[${open}m${text}\u001b[0m` : text;
}

export const color = {
    bold: (text: string) => wrap('1', text),
    dim: (text: string) => wrap('2', text),
    red: (text: string) => wrap('31', text),
    green: (text: string) => wrap('32', text),
    yellow: (text: string) => wrap('33', text),
    cyan: (text: string) => wrap('36', text),
    gray: (text: string) => wrap('90', text),
};

export const symbols = {
    pass: supportsUnicode ? '\u2713' : '+', // ✓
    fail: supportsUnicode ? '\u2717' : 'x', // ✗
    warn: supportsUnicode ? '\u26a0' : '!', // ⚠
    skip: '-',
    line: supportsUnicode ? '\u2501' : '-', // ━
};

export function statusSymbol(status: CheckStatus): string {
    switch (status) {
        case 'pass':
            return color.green(symbols.pass);
        case 'fail':
            return color.red(symbols.fail);
        case 'warn':
            return color.yellow(symbols.warn);
        case 'skip':
        default:
            return color.gray(symbols.skip);
    }
}

const WIDTH = 44;

export function rule(): string {
    return color.gray(symbols.line.repeat(WIDTH));
}

export function centered(text: string): string {
    const plainLength = text.replace(/\u001b\[[0-9;]*m/g, '').length;
    const pad = Math.max(0, Math.floor((WIDTH - plainLength) / 2));
    return ' '.repeat(pad) + text;
}

export function out(line = ''): void {
    process.stdout.write(`${line}\n`);
}

export function banner(title: string): void {
    out();
    out(rule());
    out(centered(color.bold(title)));
    out(rule());
    out();
}

export function keyValue(key: string, value: string, keyWidth = 14): void {
    out(`${color.gray(key.padEnd(keyWidth))}${value}`);
}

/** Indent tool output so it is visually attached to its check. */
export function indent(text: string, prefix = '  '): string {
    return text
        .replace(/\s+$/, '')
        .split(/\r?\n/)
        .map((line) => (line.length ? prefix + line : line))
        .join('\n');
}

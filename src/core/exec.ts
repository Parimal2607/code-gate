import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';

export interface ExecResult {
    code: number;
    stdout: string;
    stderr: string;
    /** stdout + stderr in the order they were emitted. */
    combined: string;
    /** Printable representation of what was executed. */
    command: string;
    /** Set when the process could not be spawned at all. */
    spawnError?: Error;
}

export interface ExecOptions {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    /** Run through the platform shell. Only use with fixed, trusted commands. */
    shell?: boolean;
    /** Hard limit in ms. The process is killed when exceeded. */
    timeoutMs?: number;
    /** Stream child output straight to the terminal instead of capturing it. */
    inherit?: boolean;
}

function formatCommand(command: string, args: string[]): string {
    return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

/**
 * Spawn a child process and capture its output.
 *
 * Never rejects: a spawn failure is reported as `code: -1` with `spawnError`
 * set, so callers can turn it into a check result instead of a crash.
 */
export function exec(command: string, args: string[], options: ExecOptions): Promise<ExecResult> {
    const printable = formatCommand(command, args);

    return new Promise<ExecResult>((resolve) => {
        const spawnOptions: SpawnOptions = {
            cwd: options.cwd,
            env: options.env ?? process.env,
            shell: options.shell ?? false,
            stdio: options.inherit ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        };

        const child = spawn(command, args, spawnOptions);

        let stdout = '';
        let stderr = '';
        let combined = '';
        let settled = false;
        let timer: NodeJS.Timeout | undefined;

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            stdout += chunk;
            combined += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
            stderr += chunk;
            combined += chunk;
        });

        const finish = (code: number, spawnError?: Error) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({ code, stdout, stderr, combined, command: printable, spawnError });
        };

        if (options.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(() => {
                child.kill('SIGKILL');
                combined += `\ncode-gate: timed out after ${options.timeoutMs}ms\n`;
                finish(124);
            }, options.timeoutMs);
        }

        child.on('error', (error: Error) => finish(-1, error));
        child.on('close', (code, signal) => {
            if (code === null) {
                finish(signal ? 1 : 0);
                return;
            }
            finish(code);
        });
    });
}

/** Synchronous helper used for cheap git queries during detection. */
export function execSyncSafe(command: string, args: string[], cwd: string): ExecResult {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';

    return {
        code: result.error ? -1 : (result.status ?? 1),
        stdout,
        stderr,
        combined: stdout + stderr,
        command: formatCommand(command, args),
        spawnError: result.error ?? undefined,
    };
}

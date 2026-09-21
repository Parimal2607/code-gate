/**
 * Read stdin with a hard timeout.
 *
 * Git pipes the pushed refs into a pre-push hook on stdin, but it may send
 * nothing at all (e.g. when deleting a ref). Waiting forever would hang the
 * push, so give up quickly and fall back to other detection strategies.
 */
export function readStdin(timeoutMs = 2000): Promise<string> {
    if (process.stdin.isTTY) return Promise.resolve('');

    return new Promise<string>((resolve) => {
        let data = '';
        let settled = false;

        const finish = (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            process.stdin.removeAllListeners('data');
            process.stdin.removeAllListeners('end');
            process.stdin.removeAllListeners('error');
            try {
                process.stdin.pause();
            } catch {
                /* ignore */
            }
            resolve(data);
        };

        const timer = setTimeout(finish, timeoutMs);

        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk: string) => {
            data += chunk;
        });
        process.stdin.on('end', finish);
        process.stdin.on('error', finish);
        process.stdin.resume();
    });
}

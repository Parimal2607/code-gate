#!/usr/bin/env node
import path from 'node:path';

import { checkCommand } from './commands/check';
import { doctorCommand } from './commands/doctor';
import { initCommand } from './commands/init';
import { uninstallCommand } from './commands/uninstall';
import { readJsonFile } from './core/json';
import type { ResolvedChecksConfig } from './core/types';
import { color, out } from './core/ui';

const CHECK_IDS: Array<keyof ResolvedChecksConfig> = ['prettier', 'eslint', 'typescript', 'tests', 'build'];

interface ParsedArgs {
    command: string;
    flags: Record<string, string | boolean>;
    positionals: string[];
    unknown: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
    const flags: Record<string, string | boolean> = {};
    const positionals: string[] = [];
    const unknown: string[] = [];

    const valueFlags = new Set(['remote', 'hook', 'skip', 'only', 'cwd']);
    const booleanFlags = new Set([
        'help',
        'version',
        'all',
        'verbose',
        'force',
        'config',
        'no-tests',
        'no-build',
        'no-prettier',
        'no-eslint',
        'no-typescript',
        'require-tests',
        'require-build',
    ]);

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;

        if (arg === '-h') {
            flags.help = true;
            continue;
        }
        if (arg === '-v') {
            flags.version = true;
            continue;
        }
        if (arg === '-V') {
            flags.verbose = true;
            continue;
        }

        if (arg.startsWith('--')) {
            const [rawName, inlineValue] = arg.slice(2).split('=', 2) as [string, string | undefined];

            if (valueFlags.has(rawName)) {
                const value = inlineValue ?? argv[i + 1];
                if (inlineValue === undefined) i += 1;
                flags[rawName] = value ?? '';
                continue;
            }

            if (booleanFlags.has(rawName)) {
                flags[rawName] = inlineValue === undefined ? true : inlineValue !== 'false';
                continue;
            }

            unknown.push(arg);
            continue;
        }

        positionals.push(arg);
    }

    const command = positionals[0] ?? 'check';
    return { command, flags, positionals: positionals.slice(1), unknown };
}

function splitList(value: string | boolean | undefined): string[] {
    if (typeof value !== 'string' || value.length === 0) return [];
    // Accept both `--only a,b` and shells that collapse it to `--only "a b"`.
    return value
        .split(/[,\s]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function getVersion(): string {
    const pkg = readJsonFile<{ version?: string }>(path.join(__dirname, '..', 'package.json'));
    return pkg?.version ?? '0.0.0';
}

function printHelp(): void {
    out(`
${color.bold('code-gate')} ${color.gray(`v${getVersion()}`)}

  Local quality gate. Runs the project's own Prettier, ESLint, TypeScript,
  tests and build before a push is allowed, and blocks the push on failure.

${color.bold('Usage')}
  code-gate [command] [options]

${color.bold('Commands')}
  check                 Run all applicable checks (default)
  init                  Install the git pre-push hook in this repository
  doctor                Show detected tools and whether the gate is wired up
  uninstall             Remove the pre-push hook installed by code-gate

${color.bold('Options')}
  --all                 Check every tracked file instead of only changed files
  --skip <ids>          Comma separated checks to skip (${CHECK_IDS.join(',')})
  --only <ids>          Run only these checks
  --no-tests            Shortcut for --skip tests
  --no-build            Shortcut for --skip build
  --require-tests       Fail when the project has no test script
  --require-build       Fail when the project has no build script
  --cwd <dir>           Run as if started in <dir>
  --verbose, -V         Show detection details, timings and the file list
  --force               init: replace an existing unrelated pre-push hook
  --config              init: also write a starter .code-gate.json
  --hook <name>         Internal: set by the git hook (pre-push)
  --remote <name>       Internal: remote name passed by git to the hook
  --version, -v         Print version
  --help, -h            Print this help

${color.bold('Exit codes')}
  0  all required checks passed  ${color.gray('-> git push continues')}
  1  at least one check failed   ${color.gray('-> git push is blocked')}

${color.bold('Examples')}
  code-gate init            ${color.gray('# set up the hook once per repository')}
  code-gate                 ${color.gray('# check changed files now')}
  code-gate check --all     ${color.gray('# check the whole project')}
  code-gate doctor          ${color.gray('# what did it detect?')}
  git push --no-verify      ${color.gray('# emergency bypass')}
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const { command, flags, unknown } = parseArgs(argv);

    if (unknown.length > 0) {
        out(color.red(`Unknown option: ${unknown.join(', ')}`));
        out(color.gray('Run `code-gate --help` to see the available options.'));
        return 1;
    }

    if (flags.version) {
        out(getVersion());
        return 0;
    }

    if (flags.help || command === 'help') {
        printHelp();
        return 0;
    }

    const cwd = typeof flags.cwd === 'string' && flags.cwd ? path.resolve(flags.cwd) : process.cwd();
    const verbose = Boolean(flags.verbose);

    switch (command) {
        case 'init':
            return initCommand({ cwd, force: Boolean(flags.force), writeConfig: Boolean(flags.config) });

        case 'doctor':
            return doctorCommand({ cwd, verbose });

        case 'uninstall':
            return uninstallCommand({ cwd });

        case 'check':
        case 'run': {
            const skip = splitList(flags.skip);
            if (flags['no-tests']) skip.push('tests');
            if (flags['no-build']) skip.push('build');
            if (flags['no-prettier']) skip.push('prettier');
            if (flags['no-eslint']) skip.push('eslint');
            if (flags['no-typescript']) skip.push('typescript');

            const invalid = [...skip, ...splitList(flags.only)].filter(
                (id) => !CHECK_IDS.includes(id as keyof ResolvedChecksConfig)
            );
            if (invalid.length > 0) {
                out(color.red(`Unknown check id: ${invalid.join(', ')}`));
                out(color.gray(`Valid ids: ${CHECK_IDS.join(', ')}`));
                return 1;
            }

            return checkCommand({
                cwd,
                hook: flags.hook === 'pre-push' ? 'pre-push' : undefined,
                remoteName: typeof flags.remote === 'string' && flags.remote ? flags.remote : undefined,
                all: Boolean(flags.all),
                verbose,
                skip,
                only: splitList(flags.only),
                configOverrides: {
                    ...(flags['require-tests'] ? { requireTests: true } : {}),
                    ...(flags['require-build'] ? { requireBuild: true } : {}),
                },
            });
        }

        default:
            out(color.red(`Unknown command: ${command}`));
            out(color.gray('Run `code-gate --help` to see the available commands.'));
            return 1;
    }
}

// Only self-execute when run as a program, so the module stays importable.
if (require.main === module) {
    main()
        .then((code) => {
            process.exitCode = code;
        })
        .catch((error: unknown) => {
            out();
            out(color.red('code-gate crashed:'));
            out(error instanceof Error ? (error.stack ?? error.message) : String(error));
            out();
            out(color.gray('This blocks the push on purpose. Bypass with: git push --no-verify'));
            // A crash must never silently allow an unverified push.
            process.exitCode = 1;
        });
}

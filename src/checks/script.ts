import { exec } from '../core/exec';
import type { Check, CheckContext, CheckResult, ResolvedChecksConfig } from '../core/types';
import { runScriptCommand } from '../detect/packageManager';
import { findScript, result, truncateOutput } from './helpers';

interface ScriptCheckOptions {
    id: Extract<keyof ResolvedChecksConfig, 'tests' | 'build'>;
    name: string;
    /** Script names to look for, in priority order. */
    candidates: string[];
    /** When true, a missing script fails the gate. */
    isRequired(ctx: CheckContext): boolean;
    missingMessage: string;
    timeoutMs: number;
}

/**
 * Generic "run an existing package.json script" check, shared by tests and
 * build. The script itself is never assumed: whatever the project defines is
 * executed through the detected package manager.
 */
function createScriptCheck(options: ScriptCheckOptions): Check {
    return {
        id: options.id,
        name: options.name,

        async run(ctx: CheckContext): Promise<CheckResult> {
            const startedAt = Date.now();
            const base = { id: options.id, name: options.name, startedAt };
            const script = findScript(ctx.project, options.candidates);

            if (!script) {
                return result({
                    ...base,
                    status: options.isRequired(ctx) ? 'fail' : 'skip',
                    message: options.missingMessage,
                });
            }

            const { command, args } = runScriptCommand(ctx.project.packageManager, script.name);

            const run = await exec(command, args, {
                cwd: ctx.project.root,
                env: ctx.childEnv,
                // npm/yarn/pnpm/bun are shell shims on Windows.
                shell: process.platform === 'win32',
                timeoutMs: options.timeoutMs,
            });

            const printable = `${command} ${args.join(' ')}`;

            if (run.spawnError) {
                return result({
                    ...base,
                    status: 'warn',
                    message: `could not run ${ctx.project.packageManager}: ${run.spawnError.message}`,
                    command: printable,
                });
            }

            if (run.code !== 0) {
                return result({
                    ...base,
                    status: 'fail',
                    message: run.code === 124 ? `\`${script.name}\` timed out` : `\`${script.name}\` script failed`,
                    output: truncateOutput(run.combined),
                    command: printable,
                });
            }

            return result({ ...base, status: 'pass', message: `\`${script.name}\` script passed`, command: printable });
        },
    };
}

export const testsCheck = createScriptCheck({
    id: 'tests',
    name: 'Tests',
    candidates: ['test', 'tests', 'test:ci', 'test:unit'],
    isRequired: (ctx) => ctx.config.requireTests,
    missingMessage: 'Not configured (no test script)',
    timeoutMs: 15 * 60 * 1000,
});

export const buildCheck = createScriptCheck({
    id: 'build',
    name: 'Build',
    candidates: ['build', 'compile'],
    isRequired: (ctx) => ctx.config.requireBuild,
    missingMessage: 'Not configured (no build script)',
    timeoutMs: 20 * 60 * 1000,
});

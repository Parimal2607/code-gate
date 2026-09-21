import { exec } from '../core/exec';
import type { Check, CheckContext, CheckResult } from '../core/types';
import { majorVersion, toolCommand } from '../detect/packages';
import { applyIgnore, chunkFiles, ESLINT_EXTENSIONS, filterByExtension, result, truncateOutput } from './helpers';

/**
 * Runs the project's own ESLint against the changed files.
 *
 * The project's configuration is used as-is; no config is generated. When the
 * project has no ESLint config at all the check is reported as not applicable
 * instead of failing the push.
 */
export const eslintCheck: Check = {
    id: 'eslint',
    name: 'ESLint',

    async run(ctx: CheckContext): Promise<CheckResult> {
        const startedAt = Date.now();
        const base = { id: 'eslint', name: 'ESLint', startedAt };
        const tool = ctx.project.tools.eslint;

        if (!tool.installed) {
            return result({ ...base, status: 'skip', message: 'Not installed in this project' });
        }

        if (!tool.configPath && !tool.configInPackageJson) {
            return result({ ...base, status: 'skip', message: 'No ESLint configuration found' });
        }

        const command = toolCommand(tool, []);
        if (!command) {
            return result({ ...base, status: 'warn', message: 'eslint binary could not be resolved' });
        }

        const candidates = applyIgnore(filterByExtension(ctx.selection.files, ESLINT_EXTENSIONS), ctx.config.ignore);
        if (candidates.length === 0) {
            return result({ ...base, status: 'skip', message: 'No lintable files to check' });
        }

        // ESLint 9 warns loudly when explicitly passed files are ignored by config.
        const extraArgs = majorVersion(tool) >= 9 ? ['--no-warn-ignored'] : [];
        const configLabel = tool.configPath ? tool.configPath.split(/[/\\]/).pop() : 'package.json';

        let failed = false;
        let fatal = false;
        let output = '';
        let lastCommand = '';

        for (const chunk of chunkFiles(candidates)) {
            const args = ['--no-color', ...extraArgs, ...chunk];
            const run = await exec(command.command, [...command.args, ...args], {
                cwd: ctx.project.root,
                env: ctx.childEnv,
            });

            lastCommand = `eslint ${chunk.length} file(s)`;

            if (run.spawnError) {
                return result({
                    ...base,
                    status: 'warn',
                    message: `could not run eslint: ${run.spawnError.message}`,
                    command: lastCommand,
                });
            }

            // 0 = clean, 1 = lint errors, 2 = fatal configuration/internal error.
            if (run.code !== 0) {
                failed = true;
                if (run.code === 2 || run.code < 0) fatal = true;
                output += run.combined;
            }
        }

        if (failed) {
            return result({
                ...base,
                status: 'fail',
                message: fatal ? `ESLint could not run (config: ${configLabel})` : `Lint errors found (config: ${configLabel})`,
                output: truncateOutput(output),
                command: lastCommand,
            });
        }

        return result({
            ...base,
            status: 'pass',
            message: `${candidates.length} file(s) clean (config: ${configLabel})`,
            command: lastCommand,
        });
    },
};

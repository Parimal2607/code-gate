import { exec } from '../core/exec';
import type { Check, CheckContext, CheckResult } from '../core/types';
import { toolCommand } from '../detect/packages';
import { applyIgnore, chunkFiles, filterByExtension, PRETTIER_EXTENSIONS, result, truncateOutput } from './helpers';
import { describeFormattingIssues, parseCheckOutput } from './prettierReport';

/**
 * Runs `prettier --check` on the changed files.
 *
 * Nothing about formatting is configured here: Prettier resolves the project's
 * own .prettierrc / prettier.config.* and plugins by itself.
 */
export const prettierCheck: Check = {
    id: 'prettier',
    name: 'Prettier',

    async run(ctx: CheckContext): Promise<CheckResult> {
        const startedAt = Date.now();
        const base = { id: 'prettier', name: 'Prettier', startedAt };
        const tool = ctx.project.tools.prettier;

        if (!tool.installed) {
            return result({ ...base, status: 'skip', message: 'Not installed in this project' });
        }

        const command = toolCommand(tool, []);
        if (!command) {
            return result({ ...base, status: 'warn', message: 'prettier binary could not be resolved' });
        }

        const candidates = applyIgnore(
            filterByExtension(ctx.selection.files, PRETTIER_EXTENSIONS),
            ctx.config.ignore
        );

        if (candidates.length === 0) {
            return result({ ...base, status: 'skip', message: 'No formattable files to check' });
        }

        const configLabel = tool.configPath
            ? `config: ${tool.configPath.split(/[/\\]/).pop()}`
            : tool.configInPackageJson
              ? 'config: package.json'
              : 'no config file, using Prettier defaults';

        let failed = false;
        let rawOutput = '';
        let lastCommand = '';
        const failingFiles: string[] = [];

        for (const chunk of chunkFiles(candidates)) {
            const args = ['--check', '--no-color', ...chunk];
            const run = await exec(command.command, [...command.args, ...args], {
                cwd: ctx.project.root,
                env: ctx.childEnv,
            });

            lastCommand = `prettier --check ${chunk.length} file(s)`;

            if (run.spawnError) {
                return result({
                    ...base,
                    status: 'warn',
                    message: `could not run prettier: ${run.spawnError.message}`,
                    command: lastCommand,
                });
            }

            if (run.code !== 0) {
                failed = true;
                rawOutput += run.combined;
                failingFiles.push(...parseCheckOutput(run.combined, chunk));
            }
        }

        if (failed) {
            // `prettier --check` only names files, so re-format each one in
            // memory to report the exact lines that differ.
            const detailed = await describeFormattingIssues({
                tool,
                root: ctx.project.root,
                files: failingFiles,
                env: ctx.childEnv,
            });

            const fixHint =
                failingFiles.length > 0
                    ? `\nFix with: npx prettier --write ${failingFiles.slice(0, 5).join(' ')}${
                          failingFiles.length > 5 ? ' ...' : ''
                      }`
                    : '';

            return result({
                ...base,
                status: 'fail',
                message: `${failingFiles.length || 'some'} file(s) need formatting (${configLabel})`,
                output: detailed ? `${truncateOutput(detailed, 120)}${fixHint}` : truncateOutput(rawOutput),
                command: lastCommand,
            });
        }

        return result({
            ...base,
            status: 'pass',
            message: `${candidates.length} file(s) formatted correctly (${configLabel})`,
            command: lastCommand,
        });
    },
};

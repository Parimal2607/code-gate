import path from 'node:path';

import { exec } from '../core/exec';
import type { Check, CheckContext, CheckResult } from '../core/types';
import { toolCommand } from '../detect/packages';
import { result, truncateOutput } from './helpers';

/**
 * Runs `tsc --noEmit` using the project's own tsconfig.json.
 *
 * This check is deliberately inert for JavaScript-only projects: a missing
 * TypeScript setup is reported as "Not applicable", never as a failure.
 */
export const typescriptCheck: Check = {
    id: 'typescript',
    name: 'TypeScript',

    async run(ctx: CheckContext): Promise<CheckResult> {
        const startedAt = Date.now();
        const base = { id: 'typescript', name: 'TypeScript', startedAt };
        const { project } = ctx;

        if (project.language !== 'typescript') {
            return result({ ...base, status: 'skip', message: 'Not applicable (JavaScript project)' });
        }

        if (!project.tools.typescript.installed) {
            return result({ ...base, status: 'skip', message: 'Not applicable (typescript not installed)' });
        }

        const args = ['--noEmit', '--pretty', 'false'];

        if (project.tsconfigPath) {
            args.push('-p', path.relative(project.root, project.tsconfigPath).split(path.sep).join('/'));

            // `--noEmit` is rejected for composite projects, so disable it explicitly.
            if (project.tsconfigComposite) args.push('--composite', 'false', '--incremental', 'false');
        }

        const command = toolCommand(project.tools.typescript, args);
        if (!command) {
            return result({ ...base, status: 'warn', message: 'tsc binary could not be resolved' });
        }

        const run = await exec(command.command, command.args, { cwd: project.root, env: ctx.childEnv });
        const printable = `tsc ${args.join(' ')}`;

        if (run.spawnError) {
            return result({
                ...base,
                status: 'warn',
                message: `could not run tsc: ${run.spawnError.message}`,
                command: printable,
            });
        }

        if (run.code !== 0) {
            return result({
                ...base,
                status: 'fail',
                message: 'Type errors found',
                output: truncateOutput(run.combined),
                command: printable,
            });
        }

        const version = project.tools.typescript.version ? ` (v${project.tools.typescript.version})` : '';
        return result({ ...base, status: 'pass', message: `No type errors${version}`, command: printable });
    },
};

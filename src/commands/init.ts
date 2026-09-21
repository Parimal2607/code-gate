import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_FILE_NAMES } from '../detect/config';
import { detectProject } from '../detect/project';
import { banner, color, keyValue, out, symbols } from '../core/ui';
import { getGitRoot, getHooksDir, isGitRepository } from '../git/git';
import { installPrePushHook } from '../hook/install';

export interface InitOptions {
    cwd: string;
    force?: boolean;
    /** Also write a starter .code-gate.json. */
    writeConfig?: boolean;
}

/** `code-gate init` - install the pre-push hook in the current repository. */
export async function initCommand(options: InitOptions): Promise<0 | 1> {
    banner('CODE GATE INIT');

    if (!isGitRepository(options.cwd)) {
        out(color.red(`${symbols.fail} Not a git repository.`));
        out();
        out('Run `git init` first, then re-run `code-gate init`.');
        out();
        return 1;
    }

    const project = detectProject(options.cwd);
    const gitRoot = getGitRoot(options.cwd);
    const hooksDir = getHooksDir(options.cwd);

    keyValue('Repository', gitRoot ?? 'unknown');
    keyValue('Project', project.frameworkLabel);
    keyValue('Language', project.language === 'typescript' ? 'TypeScript' : 'JavaScript');
    keyValue('Package Mgr', project.packageManager);
    keyValue('Hooks dir', hooksDir ?? 'unknown');
    out();

    const install = installPrePushHook(options.cwd, { force: options.force });

    switch (install.action) {
        case 'created':
            out(color.green(`${symbols.pass} pre-push hook installed`));
            break;
        case 'updated':
            out(color.green(`${symbols.pass} pre-push hook updated`));
            break;
        case 'unchanged':
            out(color.green(`${symbols.pass} pre-push hook already up to date`));
            break;
        case 'replaced':
            out(color.green(`${symbols.pass} pre-push hook installed`));
            out(color.yellow(`${symbols.warn} previous hook backed up to ${install.backupPath}`));
            break;
        case 'blocked':
        default:
            out(color.red(`${symbols.fail} could not install hook: ${install.reason}`));
            out();
            return 1;
    }

    if (install.hookPath) out(color.gray(`  ${install.hookPath}`));

    if (options.writeConfig) {
        const configPath = path.join(project.root, CONFIG_FILE_NAMES[0] as string);
        if (fs.existsSync(configPath) && !options.force) {
            out(color.yellow(`${symbols.warn} ${CONFIG_FILE_NAMES[0]} already exists, left untouched`));
        } else {
            fs.writeFileSync(configPath, `${JSON.stringify(starterConfig(), null, 4)}\n`, 'utf8');
            out(color.green(`${symbols.pass} wrote ${CONFIG_FILE_NAMES[0]}`));
        }
    }

    const missing = describeMissingTools(project);
    if (missing.length > 0) {
        out();
        out(color.yellow('Heads up: these checks will be skipped until the tools exist in this project:'));
        missing.forEach((line) => out(color.yellow(`  ${symbols.skip} ${line}`)));
    }

    out();
    out(color.bold('Done. Every `git push` from this repository now runs code-gate.'));
    out(color.gray('Run the checks manually with: code-gate'));
    out(color.gray('Inspect the setup with:      code-gate doctor'));
    out();

    return 0;
}

function starterConfig(): unknown {
    return {
        checks: { prettier: true, eslint: true, typescript: true, tests: true, build: true },
        requireTests: false,
        requireBuild: false,
        changedFilesOnly: true,
        ignore: [],
    };
}

function describeMissingTools(project: ReturnType<typeof detectProject>): string[] {
    const missing: string[] = [];

    if (!project.tools.prettier.installed) missing.push('Prettier (no prettier package installed)');
    if (!project.tools.eslint.installed) missing.push('ESLint (no eslint package installed)');
    else if (!project.tools.eslint.configPath && !project.tools.eslint.configInPackageJson) {
        missing.push('ESLint (no eslint config file found)');
    }
    if (project.language === 'typescript' && !project.tools.typescript.installed) {
        missing.push('TypeScript (tsconfig found but typescript is not installed)');
    }
    if (!project.scripts.test) missing.push('Tests (no test script in package.json)');
    if (!project.scripts.build) missing.push('Build (no build script in package.json)');

    return missing;
}

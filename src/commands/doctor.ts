import path from 'node:path';

import { loadConfig } from '../detect/config';
import { detectProject } from '../detect/project';
import { banner, color, keyValue, out, statusSymbol } from '../core/ui';
import { findScript } from '../checks/helpers';
import { isGitRepository } from '../git/git';
import { readInstalledHook } from '../hook/install';
import type { CheckStatus, ProjectInfo } from '../core/types';

interface Line {
    status: CheckStatus;
    label: string;
    detail?: string;
}

function relative(project: ProjectInfo, target?: string): string | undefined {
    return target ? path.relative(project.root, target).split(path.sep).join('/') || path.basename(target) : undefined;
}

/** `code-gate doctor` - report what was detected and whether the gate is wired up. */
export async function doctorCommand(options: { cwd: string; verbose?: boolean }): Promise<0 | 1> {
    banner('CODE GATE DOCTOR');

    const project = detectProject(options.cwd);
    const config = loadConfig(project);
    const inRepo = isGitRepository(options.cwd);
    const hook = readInstalledHook(options.cwd);

    keyValue('Project', project.frameworks.join(', '));
    keyValue('Language', project.language === 'typescript' ? 'TypeScript' : project.language === 'javascript' ? 'JavaScript' : 'Unknown');
    keyValue('Package Mgr', `${project.packageManager} ${color.gray(`(${project.packageManagerReason})`)}`);
    keyValue('Root', project.root);
    out();

    const testScript = findScript(project, ['test', 'tests', 'test:ci', 'test:unit']);
    const buildScript = findScript(project, ['build', 'compile']);

    const lines: Line[] = [
        { status: inRepo ? 'pass' : 'fail', label: 'Git repository', detail: inRepo ? project.gitRoot : 'not a git repository' },
        {
            status: project.packageJsonPath ? 'pass' : 'warn',
            label: 'package.json',
            detail: relative(project, project.packageJsonPath) ?? 'not found',
        },
        {
            status: project.tools.prettier.installed ? 'pass' : 'skip',
            label: 'Prettier',
            detail: project.tools.prettier.installed
                ? `v${project.tools.prettier.version ?? '?'}`
                : 'not installed (check skipped)',
        },
        {
            status: project.tools.prettier.configPath || project.tools.prettier.configInPackageJson ? 'pass' : 'warn',
            label: 'Prettier config',
            detail: project.tools.prettier.configPath
                ? relative(project, project.tools.prettier.configPath)
                : project.tools.prettier.configInPackageJson
                  ? 'package.json "prettier" field'
                  : 'none found (Prettier defaults would be used)',
        },
        {
            status: project.tools.eslint.installed ? 'pass' : 'skip',
            label: 'ESLint',
            detail: project.tools.eslint.installed
                ? `v${project.tools.eslint.version ?? '?'}`
                : 'not installed (check skipped)',
        },
        {
            status: project.tools.eslint.configPath || project.tools.eslint.configInPackageJson ? 'pass' : 'warn',
            label: 'ESLint config',
            detail: project.tools.eslint.configPath
                ? relative(project, project.tools.eslint.configPath)
                : project.tools.eslint.configInPackageJson
                  ? 'package.json "eslintConfig" field'
                  : 'none found (check skipped)',
        },
        {
            status: project.language === 'typescript' ? (project.tools.typescript.installed ? 'pass' : 'fail') : 'skip',
            label: 'TypeScript',
            detail:
                project.language !== 'typescript'
                    ? 'not applicable (JavaScript project)'
                    : project.tools.typescript.installed
                      ? `v${project.tools.typescript.version ?? '?'}`
                      : 'tsconfig found but typescript is not installed',
        },
        {
            status: project.tsconfigPath ? 'pass' : 'skip',
            label: 'tsconfig.json',
            detail: project.tsconfigPath ? relative(project, project.tsconfigPath) : 'not present',
        },
        {
            status: testScript ? 'pass' : 'skip',
            label: 'Test script',
            detail: testScript ? `${testScript.name}: ${testScript.value}` : 'not configured',
        },
        {
            status: buildScript ? 'pass' : 'skip',
            label: 'Build script',
            detail: buildScript ? `${buildScript.name}: ${buildScript.value}` : 'not configured',
        },
        {
            status: hook.exists ? (hook.managed && hook.current ? 'pass' : 'warn') : 'fail',
            label: 'pre-push hook',
            detail: !hook.exists
                ? 'not installed - run `code-gate init`'
                : !hook.managed
                  ? `exists but not managed by code-gate (${hook.hookPath})`
                  : hook.current
                    ? (hook.hookPath as string)
                    : `outdated, re-run \`code-gate init\` (${hook.hookPath})`,
        },
        {
            status: config.configPath ? 'pass' : 'skip',
            label: '.code-gate.json',
            detail: config.configPath ? relative(project, config.configPath) : 'not present (auto detection in use)',
        },
    ];

    for (const line of lines) {
        const detail = line.detail ? color.gray(`  ${line.detail}`) : '';
        out(`${statusSymbol(line.status)} ${line.label.padEnd(16)}${detail}`);
    }

    out();
    out(color.bold('Checks that would run now'));
    out();

    const wouldRun: Array<[string, boolean, string]> = [
        ['Prettier', config.checks.prettier && project.tools.prettier.installed, 'needs prettier installed'],
        [
            'ESLint',
            config.checks.eslint &&
                project.tools.eslint.installed &&
                Boolean(project.tools.eslint.configPath || project.tools.eslint.configInPackageJson),
            'needs eslint + a config file',
        ],
        [
            'TypeScript',
            config.checks.typescript && project.language === 'typescript' && project.tools.typescript.installed,
            'TypeScript projects only',
        ],
        ['Tests', config.checks.tests && Boolean(testScript), 'needs a test script'],
        ['Build', config.checks.build && Boolean(buildScript), 'needs a build script'],
    ];

    for (const [name, enabled, why] of wouldRun) {
        out(`${statusSymbol(enabled ? 'pass' : 'skip')} ${name.padEnd(12)}${enabled ? '' : color.gray(why)}`);
    }

    if (options.verbose) {
        out();
        out(color.bold('Detection details'));
        out();
        project.languageReasons.forEach((reason) => out(color.gray(`  language: ${reason}`)));
        out(color.gray(`  package manager: ${project.packageManagerReason}`));
    }

    const blocking = lines.filter((line) => line.status === 'fail');
    out();

    if (blocking.length === 0) {
        out(color.green('Ready.'));
        out();
        return 0;
    }

    out(color.red(`Not ready: ${blocking.map((line) => line.label).join(', ')}`));
    out();
    return 1;
}

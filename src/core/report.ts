import type { CheckResult, FileSelection, GateConfig, ProjectInfo } from './types';
import { banner, color, indent, keyValue, out, rule, statusSymbol, symbols } from './ui';

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function printHeader(
    project: ProjectInfo,
    config: GateConfig,
    selection: FileSelection,
    verbose: boolean
): void {
    banner('CODE GATE');

    keyValue('Project', project.pkg?.name ? `${project.frameworkLabel} (${project.pkg.name})` : project.frameworkLabel);
    keyValue('Language', project.language === 'typescript' ? 'TypeScript' : project.language === 'javascript' ? 'JavaScript' : 'Unknown');
    keyValue('Package Mgr', project.packageManager);
    keyValue('Files', selection.isFullScan ? `${selection.files.length} (full scan)` : `${selection.files.length} changed`);

    if (verbose) {
        keyValue('Root', project.root);
        keyValue('Strategy', selection.strategy);
        keyValue('Language why', project.languageReasons.join('; ') || 'n/a');
        keyValue('Pkg mgr why', project.packageManagerReason);
        if (config.configPath) keyValue('Gate config', config.configPath);
        if (selection.files.length > 0) {
            out();
            out(color.gray('Selected files'));
            selection.files.forEach((file) => out(color.gray(`  ${file}`)));
        }
    }

    out();
    out(color.bold('Checks'));
    out();
}

export function printCheckResult(item: CheckResult, verbose: boolean): void {
    const detail = item.message ? color.gray(` ${item.message}`) : '';
    const timing = verbose ? color.gray(` [${formatDuration(item.durationMs)}]`) : '';
    out(`${statusSymbol(item.status)} ${item.name}${detail}${timing}`);
}

export function printFailureDetails(results: CheckResult[]): void {
    const failures = results.filter((item) => item.status === 'fail' && item.output);

    for (const failure of failures) {
        out();
        out(color.red(`${failure.name} output:`));
        if (failure.command) out(color.gray(`$ ${failure.command}`));
        out();
        out(indent(failure.output as string));
    }
}

export function printFooter(passed: boolean, results: CheckResult[], durationMs: number): void {
    const failed = results.filter((item) => item.status === 'fail');
    const warned = results.filter((item) => item.status === 'warn');

    out();
    out(rule());
    if (passed) {
        out(color.green(`        ${symbols.pass} PUSH ALLOWED`));
    } else {
        out(color.red(`        ${symbols.fail} PUSH BLOCKED`));
    }
    out(rule());
    out();

    if (passed) {
        out(color.gray(`All required checks passed in ${formatDuration(durationMs)}.`));
        if (warned.length > 0) {
            out(color.yellow(`${warned.length} check(s) could not run and were not enforced.`));
        }
    } else {
        out(color.red(`Failed: ${failed.map((item) => item.name).join(', ')}`));
        out();
        out('Please fix the failed checks and try again.');
        out(color.gray('Bypass in an emergency: git push --no-verify'));
    }
    out();
}

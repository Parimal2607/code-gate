import { printCheckResult, printFailureDetails, printFooter, printHeader } from '../core/report';
import { runGate, type RunOptions } from '../core/runner';
import { color, out } from '../core/ui';

/** `code-gate` / `code-gate check` - run every applicable check. */
export async function checkCommand(options: RunOptions): Promise<0 | 1> {
    if (options.hook === 'pre-push') {
        out();
        out(color.bold('Running Code Gate...'));
    }

    const outcome = await runGate(options, {
        onStart: ({ project, config, selection }) => printHeader(project, config, selection, Boolean(options.verbose)),
        onCheckDone: (result) => printCheckResult(result, Boolean(options.verbose)),
    });

    if (!outcome.project.gitRoot) {
        out();
        out(color.yellow('Not inside a git repository: checks ran against the whole project.'));
    }

    printFailureDetails(outcome.results);
    printFooter(outcome.passed, outcome.results, outcome.durationMs);

    return outcome.exitCode;
}

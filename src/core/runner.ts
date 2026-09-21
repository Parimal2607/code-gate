import path from 'node:path';

import { checks as allChecks } from '../checks';
import { ESLINT_EXTENSIONS, PRETTIER_EXTENSIONS } from '../checks/helpers';
import { loadConfig } from '../detect/config';
import { listProjectFiles } from '../detect/packages';
import { detectProject } from '../detect/project';
import {
    getPushedFiles,
    getTrackedFiles,
    getWorkingChanges,
    normalizeToProject,
    parsePrePushStdin,
} from '../git/git';
import { readStdin } from './stdin';
import type {
    Check,
    CheckContext,
    CheckResult,
    FileSelection,
    GateConfig,
    ProjectInfo,
    ResolvedChecksConfig,
} from './types';

export interface RunOptions {
    cwd: string;
    /** Set when invoked from the git pre-push hook. */
    hook?: 'pre-push';
    /** Remote name passed by git to the hook ($1). */
    remoteName?: string;
    /** Ignore the diff and check every tracked file. */
    all?: boolean;
    /** Mirrors `changedFilesOnly` from .code-gate.json; false forces a full scan. */
    changedFilesOnly?: boolean;
    verbose?: boolean;
    /** Check ids disabled from the command line. */
    skip?: string[];
    /** Only run these check ids. */
    only?: string[];
    configOverrides?: Partial<GateConfig> & { checks?: Partial<ResolvedChecksConfig> };
    /** Pre-read hook stdin (used by tests). */
    stdin?: string;
}

export interface RunOutcome {
    project: ProjectInfo;
    config: GateConfig;
    selection: FileSelection;
    results: CheckResult[];
    passed: boolean;
    exitCode: 0 | 1;
    durationMs: number;
}

/** Environment handed to every child process. */
function buildChildEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        // Keeps watch-mode test runners (vitest, jest --watch) from hanging the push.
        CI: process.env.CI ?? 'true',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // Lets nested tooling detect that it is running inside the gate.
        CODE_GATE: '1',
    };
}

/** Work out which files this run should look at. */
export async function resolveSelection(project: ProjectInfo, options: RunOptions): Promise<FileSelection> {
    const gitRoot = project.gitRoot;

    if (!gitRoot) {
        // Outside a repository there is no diff to rely on: scan the project.
        const extensions = [...new Set([...PRETTIER_EXTENSIONS, ...ESLINT_EXTENSIONS])];
        return {
            files: listProjectFiles(project.root, extensions),
            strategy: 'filesystem scan (not a git repository)',
            isFullScan: true,
        };
    }

    const fullScan = (strategy: string): FileSelection => ({
        files: normalizeToProject(gitRoot, project.root, getTrackedFiles(gitRoot)),
        strategy,
        isFullScan: true,
    });

    if (options.all) return fullScan('all tracked files (--all)');
    if (options.changedFilesOnly === false) return fullScan('all tracked files (changedFilesOnly: false)');

    if (options.hook === 'pre-push') {
        const raw = options.stdin ?? (await readStdin());
        const refs = parsePrePushStdin(raw);

        if (refs.length === 0) {
            // git gave us nothing usable: fall back to the local diff.
            const working = getWorkingChanges(gitRoot);
            if (working.fallbackToFullScan) return fullScan('all tracked files (no push range, no upstream)');
            return {
                files: normalizeToProject(gitRoot, project.root, working.files),
                strategy: `pre-push without ref info, using ${working.strategy}`,
                isFullScan: false,
            };
        }

        const pushed = getPushedFiles(gitRoot, refs, options.remoteName ?? 'origin');
        if (pushed.fallbackToFullScan) return fullScan('all tracked files (push range unresolved)');

        return {
            files: normalizeToProject(gitRoot, project.root, pushed.files),
            strategy: pushed.strategy,
            isFullScan: false,
        };
    }

    const working = getWorkingChanges(gitRoot);
    if (working.fallbackToFullScan) return fullScan('all tracked files (no upstream branch)');

    return {
        files: normalizeToProject(gitRoot, project.root, working.files),
        strategy: working.strategy,
        isFullScan: false,
    };
}

function selectChecks(config: GateConfig, options: RunOptions): Check[] {
    const skip = new Set((options.skip ?? []).map((id) => id.toLowerCase()));
    const only = options.only?.map((id) => id.toLowerCase());

    return allChecks.filter((check) => {
        if (only && only.length > 0) return only.includes(check.id);
        if (skip.has(check.id)) return false;
        return config.checks[check.id] !== false;
    });
}

export interface RunHooks {
    onStart?(context: { project: ProjectInfo; config: GateConfig; selection: FileSelection; checks: Check[] }): void;
    onCheckStart?(check: Check): void;
    onCheckDone?(result: CheckResult): void;
}

/**
 * The orchestrator: detect -> select checks -> execute -> collect -> exit code.
 *
 * Only `fail` results block the push. `skip` and `warn` never do.
 */
export async function runGate(options: RunOptions, hooks: RunHooks = {}): Promise<RunOutcome> {
    const startedAt = Date.now();
    const project = detectProject(path.resolve(options.cwd));
    const config = loadConfig(project, { overrides: options.configOverrides });
    const selection = await resolveSelection(project, {
        ...options,
        changedFilesOnly: options.changedFilesOnly ?? config.changedFilesOnly,
    });

    const selected = selectChecks(config, options);
    hooks.onStart?.({ project, config, selection, checks: selected });

    const ctx: CheckContext = {
        project,
        config,
        selection,
        verbose: Boolean(options.verbose),
        childEnv: buildChildEnv(),
    };

    const results: CheckResult[] = [];

    for (const check of selected) {
        hooks.onCheckStart?.(check);
        let checkResult: CheckResult;

        try {
            checkResult = await check.run(ctx);
        } catch (error) {
            // A crash inside a check must not silently open the gate.
            checkResult = {
                id: check.id,
                name: check.name,
                status: 'fail',
                message: 'Check crashed',
                output: error instanceof Error ? (error.stack ?? error.message) : String(error),
                durationMs: 0,
            };
        }

        results.push(checkResult);
        hooks.onCheckDone?.(checkResult);
    }

    const passed = results.every((item) => item.status !== 'fail');

    return {
        project,
        config,
        selection,
        results,
        passed,
        exitCode: passed ? 0 : 1,
        durationMs: Date.now() - startedAt,
    };
}

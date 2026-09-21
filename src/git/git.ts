import fs from 'node:fs';
import path from 'node:path';

import { execSyncSafe } from '../core/exec';

const ZERO_SHA = /^0+$/;

/** git's built-in empty tree object, used to diff a root commit. */
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = execSyncSafe('git', args, cwd);
    return { ok: result.code === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function isGitRepository(cwd: string): boolean {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout === 'true';
}

/** Absolute path to the working tree root. */
export function getGitRoot(cwd: string): string | undefined {
    const result = git(cwd, ['rev-parse', '--show-toplevel']);
    return result.ok && result.stdout ? path.resolve(result.stdout) : undefined;
}

/**
 * Directory that holds the shared hooks for this repository.
 *
 * Honours `core.hooksPath` (used by husky and friends) and resolves
 * `--git-common-dir` so that linked worktrees install into the main repo.
 */
export function getHooksDir(cwd: string): string | undefined {
    const gitRoot = getGitRoot(cwd);
    if (!gitRoot) return undefined;

    const custom = git(cwd, ['config', '--get', 'core.hooksPath']);
    if (custom.ok && custom.stdout) {
        return path.isAbsolute(custom.stdout) ? custom.stdout : path.join(gitRoot, custom.stdout);
    }

    const common = git(cwd, ['rev-parse', '--git-common-dir']);
    const gitDir = common.ok && common.stdout ? common.stdout : '.git';
    const absoluteGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(gitRoot, gitDir);
    return path.join(absoluteGitDir, 'hooks');
}

export interface PrePushRef {
    localRef: string;
    localSha: string;
    remoteRef: string;
    remoteSha: string;
}

/** Parse the `<local ref> <local sha> <remote ref> <remote sha>` lines git feeds a pre-push hook. */
export function parsePrePushStdin(input: string): PrePushRef[] {
    return input
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+/))
        .filter((parts) => parts.length >= 4)
        .map((parts) => ({
            localRef: parts[0] as string,
            localSha: parts[1] as string,
            remoteRef: parts[2] as string,
            remoteSha: parts[3] as string,
        }));
}

export function isZeroSha(sha: string): boolean {
    return ZERO_SHA.test(sha);
}

function diffNames(cwd: string, args: string[]): string[] {
    const result = git(cwd, ['diff', '--name-only', '--diff-filter=ACMR', ...args]);
    if (!result.ok) return [];
    return result.stdout.split(/\r?\n/).filter(Boolean);
}

/** Best-effort base commit for a branch that does not exist on the remote yet. */
function findNewBranchBase(cwd: string, localSha: string, remoteName: string): string | undefined {
    const newCommits = git(cwd, ['rev-list', localSha, '--not', `--remotes=${remoteName}`]);
    if (newCommits.ok && newCommits.stdout) {
        const commits = newCommits.stdout.split(/\r?\n/).filter(Boolean);
        const oldest = commits[commits.length - 1];
        if (oldest) {
            const parent = git(cwd, ['rev-parse', '--verify', `${oldest}^`]);
            if (parent.ok && parent.stdout) return parent.stdout;
            // Root commit: diff against git's well-known empty tree object.
            return EMPTY_TREE_SHA;
        }
    }

    for (const candidate of [`${remoteName}/HEAD`, `${remoteName}/main`, `${remoteName}/master`]) {
        const verified = git(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
        if (verified.ok && verified.stdout) {
            const base = git(cwd, ['merge-base', verified.stdout, localSha]);
            if (base.ok && base.stdout) return base.stdout;
        }
    }

    return undefined;
}

export interface ChangedFilesResult {
    files: string[];
    strategy: string;
    /** True when no diff range could be established and everything should be checked. */
    fallbackToFullScan: boolean;
}

/** Files contained in the commits that are about to be pushed. */
export function getPushedFiles(cwd: string, refs: PrePushRef[], remoteName: string): ChangedFilesResult {
    const files = new Set<string>();
    const strategies: string[] = [];
    let sawRange = false;
    let checkableRefs = 0;

    for (const ref of refs) {
        if (isZeroSha(ref.localSha)) continue; // branch deletion, nothing to check
        checkableRefs += 1;

        if (!isZeroSha(ref.remoteSha)) {
            const known = git(cwd, ['cat-file', '-e', `${ref.remoteSha}^{commit}`]);
            const base = known.ok ? ref.remoteSha : findNewBranchBase(cwd, ref.localSha, remoteName);
            if (base) {
                diffNames(cwd, [base, ref.localSha]).forEach((file) => files.add(file));
                strategies.push(`git diff ${base.slice(0, 7)}..${ref.localSha.slice(0, 7)}`);
                sawRange = true;
                continue;
            }
        }

        const base = findNewBranchBase(cwd, ref.localSha, remoteName);
        if (base) {
            diffNames(cwd, [base, ref.localSha]).forEach((file) => files.add(file));
            strategies.push(`new branch: git diff ${base.slice(0, 7)}..${ref.localSha.slice(0, 7)}`);
            sawRange = true;
        }
    }

    if (!sawRange) {
        // Deletion-only pushes have nothing to verify; anything else means we
        // failed to work out the range, so check everything rather than nothing.
        if (checkableRefs === 0) {
            return { files: [], strategy: 'branch deletion only, nothing to check', fallbackToFullScan: false };
        }
        return { files: [], strategy: 'no push range resolved', fallbackToFullScan: true };
    }

    return { files: [...files], strategy: strategies.join(', '), fallbackToFullScan: false };
}

/** Working tree + staged + untracked changes, with an upstream diff as fallback. */
export function getWorkingChanges(cwd: string): ChangedFilesResult {
    const files = new Set<string>();
    diffNames(cwd, ['HEAD']).forEach((file) => files.add(file));

    const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']);
    if (untracked.ok) untracked.stdout.split(/\r?\n/).filter(Boolean).forEach((file) => files.add(file));

    if (files.size > 0) {
        return { files: [...files], strategy: 'working tree + staged + untracked', fallbackToFullScan: false };
    }

    const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream.ok && upstream.stdout) {
        diffNames(cwd, [`${upstream.stdout}...HEAD`]).forEach((file) => files.add(file));
        if (files.size > 0) {
            return { files: [...files], strategy: `git diff ${upstream.stdout}...HEAD`, fallbackToFullScan: false };
        }
        return { files: [], strategy: `no changes vs ${upstream.stdout}`, fallbackToFullScan: false };
    }

    return { files: [], strategy: 'no upstream branch', fallbackToFullScan: true };
}

/** Every file tracked by git, used for full scans. */
export function getTrackedFiles(cwd: string): string[] {
    const result = git(cwd, ['ls-files']);
    return result.ok ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

/**
 * Convert git paths (relative to the git root, POSIX separators) into paths
 * relative to the project root, dropping files outside the project and files
 * that no longer exist on disk.
 */
export function normalizeToProject(gitRoot: string, projectRoot: string, files: string[]): string[] {
    const result: string[] = [];

    for (const file of files) {
        const absolute = path.resolve(gitRoot, file);
        const relative = path.relative(projectRoot, absolute);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
        if (!fs.existsSync(absolute)) continue;
        result.push(relative.split(path.sep).join('/'));
    }

    return [...new Set(result)].sort();
}

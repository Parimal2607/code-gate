/**
 * Programmatic API.
 *
 * `code-gate` is primarily a CLI, but the orchestrator and detectors are
 * exported so they can be reused (custom runners, editor integrations, tests).
 */
export { checks } from './checks';
export { runGate, resolveSelection, type RunOptions, type RunOutcome } from './core/runner';
export { detectProject } from './detect/project';
export { detectPackageManager } from './detect/packageManager';
export { loadConfig, defaultConfig, CONFIG_FILE_NAMES } from './detect/config';
export { installPrePushHook, uninstallPrePushHook, readInstalledHook, hookPathFor } from './hook/install';
export { renderPrePushHook, HOOK_MARKER } from './hook/template';
export { parsePrePushStdin, getPushedFiles, getWorkingChanges } from './git/git';
export type {
    Check,
    CheckContext,
    CheckResult,
    CheckStatus,
    FileSelection,
    GateConfig,
    Language,
    PackageManager,
    ProjectInfo,
    ToolInfo,
} from './core/types';
export { main } from './cli';

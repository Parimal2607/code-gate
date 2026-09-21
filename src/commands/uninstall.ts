import { banner, color, out, symbols } from '../core/ui';
import { uninstallPrePushHook } from '../hook/install';

/** `code-gate uninstall` - remove the pre-push hook we installed. */
export async function uninstallCommand(options: { cwd: string }): Promise<0 | 1> {
    banner('CODE GATE UNINSTALL');

    const removed = uninstallPrePushHook(options.cwd);

    if (removed.removed) {
        out(color.green(`${symbols.pass} pre-push hook removed`));
        out(color.gray(`  ${removed.hookPath}`));
        out();
        return 0;
    }

    out(color.yellow(`${symbols.warn} nothing removed: ${removed.reason}`));
    out();
    return removed.reason === 'no pre-push hook found' ? 0 : 1;
}

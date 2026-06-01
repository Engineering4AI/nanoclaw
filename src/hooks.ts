export type PreHook = (toolName: string, args: Record<string, unknown>) => Promise<void>;
export type PostHook = (toolName: string, args: Record<string, unknown>, result: string) => Promise<void>;

const _preHooks: PreHook[] = [];
const _postHooks: PostHook[] = [];

export function registerPre(fn: PreHook): void {
  _preHooks.push(fn);
}

export function registerPost(fn: PostHook): void {
  _postHooks.push(fn);
}

export async function pre(toolName: string, args: Record<string, unknown>): Promise<void> {
  for (const fn of _preHooks) {
    await fn(toolName, args);
  }
}

export async function post(toolName: string, args: Record<string, unknown>, result: string): Promise<void> {
  for (const fn of _postHooks) {
    await fn(toolName, args, result);
  }
}

import {FlowHookCallable, FlowHookEvent} from "../types";

/**
 * Safely calls a hook function, catching any errors to prevent them from interrupting the flow.
 * 
 * @template TEvent The type of the event payload.
 * @param hook The hook function to call.
 * @param event The event payload to pass to the hook.
 */
export async function safeCallHook<TEvent = unknown>(
  hook: ((event: TEvent) => void | Promise<void>) | undefined,
  event: TEvent
) {
  if (!hook) return;
  if (typeof hook !== 'function') return;

  try {
    await hook(event);
  } catch {}
}

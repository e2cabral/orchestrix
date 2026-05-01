import {FlowHookCallable, FlowHookEvent} from "../types";

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
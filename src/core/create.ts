import {Flow} from "./flow";
import {FlowConfig} from "../types";

/**
 * Creates a new Flow instance.
 * @template TInput The type of the flow input data.
 * @param name Flow name.
 * @param config Optional configurations (e.g., idempotency store).
 * @returns A new Flow instance.
 */
export const create = <TInput = unknown>(name: string, config?: FlowConfig) => new Flow<TInput>(name, config);

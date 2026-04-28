import {Flow} from "./flow";
import {FlowConfig} from "../types";

/**
 * Cria uma nova instância de um Fluxo.
 * @template TInput O tipo dos dados de entrada do fluxo.
 * @param name Nome do fluxo.
 * @param config Configurações opcionais (ex: armazenamento de idempotência).
 * @returns Uma nova instância de Flow.
 */
export const create = <TInput = unknown>(name: string, config?: FlowConfig) => new Flow<TInput>(name, config);
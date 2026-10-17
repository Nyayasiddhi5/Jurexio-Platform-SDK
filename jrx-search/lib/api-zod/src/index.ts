export * from "./generated/api";
export * from "./generated/types";
// Both the zod schema (path params) and the orval model type (query params)
// are named GetSimilarCasesParams; explicitly re-export the zod schema value
// and the query-params model type to resolve the ambiguity.
export { GetSimilarCasesParams } from "./generated/api";
export type { GetSimilarCasesParams as GetSimilarCasesQueryParamsType } from "./generated/types";
// Same collision pattern: ListStatutesResponse exists as both a zod schema
// value and an orval model type; re-export the zod value and alias the type.
export { ListStatutesResponse } from "./generated/api";
export type { ListStatutesResponse as ListStatutesResponseType } from "./generated/types";

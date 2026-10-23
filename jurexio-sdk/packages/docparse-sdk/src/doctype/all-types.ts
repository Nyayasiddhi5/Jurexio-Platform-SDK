import { DOC_TYPES } from "./registry.js";
import { GOVT_DOC_TYPES } from "./gov-registry.js";
import { CIVIL_DOC_TYPES } from "./civil-registry.js";

/** Legal + government + civil registration profiles for Platform SDK classification. */
export const ALL_DOC_TYPES = [...DOC_TYPES, ...GOVT_DOC_TYPES, ...CIVIL_DOC_TYPES];

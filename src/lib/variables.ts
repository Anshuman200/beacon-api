import { Environment, KeyValuePair } from "@/store/collectionStore";

export interface VariableLookupResult {
  value: string;
  secret?: boolean;
  source: "environment" | "global" | "collection";
}

/**
 * Builds the merged {{variable}} -> value map once, in one place, so resolveTemplates
 * (substitution) and lookupVariable (single-key preview) can never disagree about
 * precedence — active environment overrides globals overrides collection vars.
 */
function buildVariableMap(
  activeEnv: Environment | null,
  globalsEnv: Environment | null,
  collectionVars?: KeyValuePair[]
): Record<string, VariableLookupResult> {
  const map: Record<string, VariableLookupResult> = {};

  if (Array.isArray(collectionVars)) {
    collectionVars.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        map[v.key.trim()] = { value: v.value, secret: v.secret, source: "collection" };
      }
    });
  }

  if (globalsEnv && Array.isArray(globalsEnv.variables)) {
    globalsEnv.variables.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        map[v.key.trim()] = { value: v.value, secret: v.secret, source: "global" };
      }
    });
  }

  if (activeEnv && Array.isArray(activeEnv.variables)) {
    activeEnv.variables.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        map[v.key.trim()] = { value: v.value, secret: v.secret, source: "environment" };
      }
    });
  }

  return map;
}

/**
 * Looks up a single {{variable}} by name using the same precedence as resolveTemplates
 * (active environment > global > collection), without resolving a whole string.
 * Used for UI affordances like hover-to-preview.
 */
export function lookupVariable(
  key: string,
  activeEnv: Environment | null,
  globalsEnv: Environment | null,
  collectionVars?: KeyValuePair[]
): VariableLookupResult | undefined {
  return buildVariableMap(activeEnv, globalsEnv, collectionVars)[key];
}

/**
 * Resolves all {{variable_name}} templates in a text string using variables from:
 * 1. The currently active environment (highest precedence)
 * 2. The global environment (id: env_globals)
 * 3. The active collection's variables (lowest precedence)
 */
export function resolveTemplates(
  text: string,
  activeEnv: Environment | null,
  globalsEnv: Environment | null,
  collectionVars?: KeyValuePair[]
): string {
  if (!text) return "";

  const varMap = buildVariableMap(activeEnv, globalsEnv, collectionVars);

  // Regex matches {{variable_name}}
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in varMap) {
      return varMap[trimmedKey].value;
    }
    return match; // Return unchanged if key is not found
  });
}

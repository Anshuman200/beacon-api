import { Environment, KeyValuePair } from "@/store/collectionStore";

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

  // Combine variables: active environment overrides globals overrides collection vars
  const varMap: Record<string, string> = {};

  if (Array.isArray(collectionVars)) {
    collectionVars.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        varMap[v.key.trim()] = v.value;
      }
    });
  }

  if (globalsEnv && Array.isArray(globalsEnv.variables)) {
    globalsEnv.variables.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        varMap[v.key.trim()] = v.value;
      }
    });
  }

  if (activeEnv && Array.isArray(activeEnv.variables)) {
    activeEnv.variables.forEach((v) => {
      if (v.enabled && v.key.trim()) {
        varMap[v.key.trim()] = v.value;
      }
    });
  }

  // Regex matches {{variable_name}}
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey in varMap) {
      return varMap[trimmedKey];
    }
    return match; // Return unchanged if key is not found
  });
}

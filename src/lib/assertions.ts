import { Assertion } from "@/store/collectionStore";

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
  responseTime: number; // ms
}

export interface AssertionResult {
  id: string;
  target: string;
  property: string;
  operator: string;
  expectedValue: string;
  actualValue: string;
  passed: boolean;
  message: string;
}

/**
 * Resolves a simple JSON path like "$.data.items[0].name" from an object
 */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!path || path === "$" || path.trim() === "") return obj;
  
  let normalizedPath = path.trim();
  if (normalizedPath.startsWith("$.")) {
    normalizedPath = normalizedPath.substring(2);
  } else if (normalizedPath.startsWith("$")) {
    normalizedPath = normalizedPath.substring(1);
  }

  // Convert array brackets to dot notation: e.g., items[0].name -> items.0.name, [0] -> 0
  normalizedPath = normalizedPath.replace(/\[(\d+)\]/g, ".$1");
  if (normalizedPath.startsWith(".")) {
    normalizedPath = normalizedPath.substring(1);
  }

  const parts = normalizedPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (part === "") continue;
    if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Evaluates all assertions against the response
 */
export function evaluateAssertions(
  response: ProxyResponse,
  assertions: Assertion[]
): AssertionResult[] {
  if (!assertions || !Array.isArray(assertions)) return [];

  return assertions.map((assertion) => {
    let actual: unknown = undefined;
    let actualStr = "undefined";

    // 1. Get the actual value based on the target
    switch (assertion.target) {
      case "status_code":
        actual = response.status;
        actualStr = String(response.status);
        break;
      case "response_time":
        actual = response.responseTime;
        actualStr = `${response.responseTime} ms`;
        break;
      case "content_type":
        // Find content-type key (case insensitive)
        const ctKey = Object.keys(response.headers).find(
          (k) => k.toLowerCase() === "content-type"
        );
        actual = ctKey ? response.headers[ctKey] : undefined;
        actualStr = String(actual || "undefined");
        break;
      case "header":
        if (assertion.property) {
          const hKey = Object.keys(response.headers).find(
            (k) => k.toLowerCase() === assertion.property.toLowerCase()
          );
          actual = hKey ? response.headers[hKey] : undefined;
          actualStr = String(actual || "undefined");
        }
        break;
      case "body_text":
        actual = typeof response.data === "string" 
          ? response.data 
          : JSON.stringify(response.data);
        actualStr = String(actual || "");
        break;
      case "json_path":
        if (assertion.property) {
          actual = getValueByPath(response.data, assertion.property);
          actualStr = typeof actual === "object" ? JSON.stringify(actual) : String(actual);
        }
        break;
      default:
        break;
    }

    // 2. Perform comparison
    let passed = false;
    let operatorLabel = "";
    const expectedVal = assertion.value;

    switch (assertion.operator) {
      case "equals":
        passed = String(actual) === expectedVal;
        operatorLabel = "equals";
        break;
      case "not_equals":
        passed = String(actual) !== expectedVal;
        operatorLabel = "does not equal";
        break;
      case "contains":
        passed = String(actual || "").includes(expectedVal);
        operatorLabel = "contains";
        break;
      case "not_contains":
        passed = !String(actual || "").includes(expectedVal);
        operatorLabel = "does not contain";
        break;
      case "less_than":
        passed = Number(actual) < Number(expectedVal);
        operatorLabel = "is less than";
        break;
      case "greater_than":
        passed = Number(actual) > Number(expectedVal);
        operatorLabel = "is greater than";
        break;
      case "exists":
        passed = actual !== undefined && actual !== null;
        operatorLabel = "exists";
        break;
      case "matches_regex":
        try {
          passed = new RegExp(expectedVal).test(String(actual || ""));
        } catch {
          passed = false;
        }
        operatorLabel = "matches regex";
        break;
      default:
        break;
    }

    // 3. Format error message
    let message = "";
    const targetName = 
      assertion.target === "status_code" ? "Status Code" :
      assertion.target === "response_time" ? "Response Time" :
      assertion.target === "content_type" ? "Content-Type" :
      assertion.target === "header" ? `Header [${assertion.property}]` :
      assertion.target === "body_text" ? "Response Body" :
      `JSON Path [${assertion.property}]`;

    if (passed) {
      message = `${targetName} ${operatorLabel} "${expectedVal}"`;
    } else {
      if (assertion.operator === "exists") {
        message = `${targetName} does not exist`;
      } else {
        message = `${targetName} expected to ${operatorLabel} "${expectedVal}", but got "${actualStr}"`;
      }
    }

    return {
      id: assertion.id,
      target: assertion.target,
      property: assertion.property,
      operator: assertion.operator,
      expectedValue: expectedVal,
      actualValue: actualStr,
      passed,
      message,
    };
  });
}

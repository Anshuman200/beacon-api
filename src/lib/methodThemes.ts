export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

export const METHOD_THEMES: Record<string, { bg: string; border: string; text: string; primary: string }> = {
  GET: { bg: "rgba(16, 185, 129, 0.12)", border: "rgba(16, 185, 129, 0.3)", text: "#10b981", primary: "#10b981" },
  POST: { bg: "rgba(99, 102, 241, 0.12)", border: "rgba(99, 102, 241, 0.3)", text: "#6366f1", primary: "#6366f1" },
  PUT: { bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)", text: "#f59e0b", primary: "#f59e0b" },
  PATCH: { bg: "rgba(6, 182, 212, 0.12)", border: "rgba(6, 182, 212, 0.3)", text: "#06b6d4", primary: "#06b6d4" },
  DELETE: { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.3)", text: "#ef4444", primary: "#ef4444" },
  OPTIONS: { bg: "rgba(107, 114, 128, 0.12)", border: "rgba(107, 114, 128, 0.3)", text: "#6b7280", primary: "#6b7280" },
  HEAD: { bg: "rgba(139, 92, 246, 0.12)", border: "rgba(139, 92, 246, 0.3)", text: "#8b5cf6", primary: "#8b5cf6" },
};

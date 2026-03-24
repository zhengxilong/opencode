export type CommandType = "help" | "status" | "reset" | "project.list" | "project.use" | "confirm" | "cancel" | "unknown"

export type Command =
  | { type: "help" }
  | { type: "status" }
  | { type: "reset" }
  | { type: "project.list" }
  | { type: "project.use"; project: string }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "unknown"; text: string }

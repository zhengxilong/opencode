import { For, Show } from "solid-js"
import { useTheme } from "../../context/theme"

export function FeedbackPrompt(props: {
  mode: "idle" | "detail" | "submitted"
  reasons: { key: string; label: string }[]
  selected: string[]
  comment: string
}) {
  const { theme } = useTheme()

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.backgroundElement}
    >
      <Show when={props.mode === "submitted"}>
        <text fg={theme.success}>✅ 感谢反馈！</text>
      </Show>

      <Show when={props.mode === "idle"}>
        <text fg={theme.textMuted}>⚡ 评价此回复: [👍 有用 (u)] [👎 无用 (d)] [跳过 (s)]</text>
      </Show>

      <Show when={props.mode === "detail"}>
        <box flexDirection="column" gap={1}>
          <text fg={theme.warning}>⚡ 已选择无用，请选择原因并回车提交</text>
          <For each={props.reasons}>
            {(reason, index) => (
              <text fg={props.selected.includes(reason.key) ? theme.text : theme.textMuted}>
                [{index() + 1}] {reason.label}
                <Show when={props.selected.includes(reason.key)}>
                  <span style={{ fg: theme.success }}> 已选</span>
                </Show>
              </text>
            )}
          </For>
          <text fg={theme.textMuted}>数字键切换原因，输入内容补充说明，Backspace 删除，Enter 提交，Esc 取消</text>
          <text fg={theme.text}>
            说明: <span style={{ fg: props.comment ? theme.text : theme.textMuted }}>{props.comment || "可选，最多 200 字"}</span>
          </text>
        </box>
      </Show>
    </box>
  )
}

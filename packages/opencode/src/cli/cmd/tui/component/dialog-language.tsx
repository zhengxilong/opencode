import { createMemo } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { LanguageManager } from "@/language/language"

export function DialogLanguage() {
  const toast = useToast()
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()

  const current = createMemo(() => {
    const cfg = (sync.data.config as any).language
    if (!cfg) return "zh-CN"
    return typeof cfg === "string" ? cfg : (cfg.user ?? "zh-CN")
  })

  const options = createMemo((): DialogSelectOption<string>[] =>
    LanguageManager.listLanguages().map((item) => ({
      value: item.code,
      title: `${item.nativeName} (${item.code})`,
      description: item.name,
    })),
  )

  return (
    <DialogSelect<string>
      title="Select language"
      placeholder="Search languages"
      options={options()}
      current={current()}
      onSelect={(option) => {
        dialog.clear()
        const cfg = (sync.data.config as any).language
        const next =
          typeof cfg === "string" || !cfg
            ? option.value
            : {
                ...cfg,
                user: option.value,
              }

        sdk.client.config
          .update(
            {
              config: {
                language: next,
              } as any,
            },
            { throwOnError: true },
          )
          .then((ok) => {
            toast.show({
              variant: "success",
              message: `Language switched to ${option.title}`,
            })
          })
          .catch((error) => {
            toast.error(error)
          })
      }}
    />
  )
}

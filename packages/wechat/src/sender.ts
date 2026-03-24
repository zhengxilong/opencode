import type { WechatAccount, SendTextInput, SendTextResult } from "./model/wechat"
import { apiFetch } from "./poller"
import { randomId } from "./util/hash"
import { splitReply } from "./util/text"

export async function sendTextMessage(account: WechatAccount, input: SendTextInput): Promise<SendTextResult> {
  const clientId = randomId("wechat")
  await apiFetch({
    baseUrl: account.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: input.to,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [{ type: 1, text_item: { text: input.text } }],
        context_token: input.contextToken,
      },
      base_info: {
        channel_version: "0.1.0",
      },
    }),
    token: account.token,
    timeoutMs: 15_000,
  })
  return { clientId }
}

export async function sendReplyChunks(account: WechatAccount, input: { to: string; text: string; contextToken: string; max: number }) {
  const chunks = splitReply(input.text, input.max)
  for (const chunk of chunks) {
    await sendTextMessage(account, {
      to: input.to,
      text: chunk,
      contextToken: input.contextToken,
    })
  }
}

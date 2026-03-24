export type WechatAccount = {
  accountId: string
  token: string
  baseUrl: string
  userId?: string
  savedAt: string
}

export type WechatMessageItem = {
  type?: number
  text_item?: {
    text?: string
  }
  voice_item?: {
    text?: string
  }
  ref_msg?: {
    title?: string
  }
}

export type WechatRawMessage = {
  from_user_id?: string
  to_user_id?: string
  client_id?: string
  session_id?: string
  message_type?: number
  message_state?: number
  item_list?: WechatMessageItem[]
  context_token?: string
  create_time_ms?: number
}

export type GetUpdatesResult = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WechatRawMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type InboundMessage = {
  messageId: string
  wechatUserId: string
  sessionKey: string
  text: string
  contextToken?: string
  createTimeMs: number
  raw: WechatRawMessage
}

export type SendTextInput = {
  to: string
  text: string
  contextToken: string
}

export type SendTextResult = {
  clientId: string
}

export type QrCodeInfo = {
  qrcode: string
  qrcode_img_content: string
}

export type QrStatus =
  | { status: "wait" | "scaned" | "expired" }
  | {
      status: "confirmed"
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
      ilink_user_id?: string
    }

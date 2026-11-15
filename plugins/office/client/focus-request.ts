/** A request to bring one agent into view, made by the attention strip. */
export interface FocusRequest {
  agentId: string;
  /** Changes on every request, so asking for the same agent twice moves the view again. */
  nonce: number;
}

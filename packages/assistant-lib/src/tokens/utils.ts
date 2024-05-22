import { get_encoding } from "tiktoken";

const encoding = get_encoding("cl100k_base");

export function countTokens(text: string) {
  const tokens = encoding.encode(text);

  return tokens.length;
}

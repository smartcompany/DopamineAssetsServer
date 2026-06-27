import { createAIClient } from "nextjs-share-lib";

/** AI SDK/engine swaps live in nextjs-share-lib; apiKey comes from this app env. */
export const ai = createAIClient({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

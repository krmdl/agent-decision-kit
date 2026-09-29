import { pipeline } from "@huggingface/transformers";

type Captioner = (image: Blob) => Promise<Array<{ generated_text?: string }>>;
let captioner: Promise<Captioner> | undefined;

export async function describeScreenshot(png: Buffer) {
  const start = performance.now();
  const model = process.env.AGENT_DECISION_VISION_MODEL ?? "Xenova/vit-gpt2-image-captioning";
  captioner ??= pipeline("image-to-text", model, { dtype: "q8" }).then((instance) => instance as unknown as Captioner);
  const image = new Blob([new Uint8Array(png)], { type: "image/png" });
  const output = await (await captioner)(image);
  const caption = Array.isArray(output) ? output.map((item) => item.generated_text ?? "").filter(Boolean).join(" ") : "";
  return { caption, model, latencyMs: Math.round(performance.now() - start), provider: "local-vision" };
}

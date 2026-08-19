// generiert von scripts/build-assets.mjs — NIE von Hand editieren (Gate: npm run check:manifest).
// Hashes der eigenen SD-Turbo-Konversion (tools/convert-sd-turbo.sh) und der ORT-WASM-Datei,
// die das gebündelte onnxruntime-web/webgpu-Glue referenziert.
export const ORT_VERSION = "1.27.0";
export const GENERATED_ASSETS = {
  text_encoder: { path: "sd-turbo/text_encoder/model.onnx", bytes: 681342985, sha256: "5b4fb87516e5b1e9bc261154f979095dbc3ea143b23b66235cd4f44cb100dacf" },
  unet: { path: "sd-turbo/unet/model.onnx", bytes: 1733131719, sha256: "cc779b5c9afec9df6bb862f49c079506d9850a6d76cf4cacbb33d45a44bb9d2f" },
  vae_decoder: { path: "sd-turbo/vae_decoder/model.onnx", bytes: 99126105, sha256: "ddedb9324899b37f6d02f5b3ddeb3c7aa690b5656e1e4f185f6715d2bf93a75f" },
  vocab: { path: "sd-turbo/tokenizer/vocab.json", bytes: 1059962, sha256: "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349" },
  merges: { path: "sd-turbo/tokenizer/merges.txt", bytes: 524619, sha256: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" },
  ort_wasm: { path: "runtime/ort-1.27.0/ort-wasm-simd-threaded.asyncify.wasm", bytes: 24254953, sha256: "7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a" },
} as const;

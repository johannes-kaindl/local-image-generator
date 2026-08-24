// generiert von scripts/build-assets.mjs — NIE von Hand editieren (Gate: npm run check:manifest).
// Hashes der eigenen SD-Turbo- und SDXL-Turbo-Konversionen (tools/convert-model.sh <sd-turbo|sdxl-turbo>)
// und der ORT-WASM-Datei, die das gebündelte onnxruntime-web/webgpu-Glue referenziert.
export const ORT_VERSION = "1.27.0";
export const GENERATED_ASSETS = {
  runtime: {
    ort_wasm: { path: "runtime/ort-1.27.0/ort-wasm-simd-threaded.asyncify.wasm", bytes: 24254953, sha256: "7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a" },
  },
  models: {
  "sd-turbo": {
    text_encoder: { path: "sd-turbo/text_encoder/model.onnx", bytes: 681342985, sha256: "5b4fb87516e5b1e9bc261154f979095dbc3ea143b23b66235cd4f44cb100dacf" },
    unet: { path: "sd-turbo/unet/model.onnx", bytes: 1733131719, sha256: "cc779b5c9afec9df6bb862f49c079506d9850a6d76cf4cacbb33d45a44bb9d2f" },
    vae_decoder: { path: "sd-turbo/vae_decoder/model.onnx", bytes: 99126105, sha256: "ddedb9324899b37f6d02f5b3ddeb3c7aa690b5656e1e4f185f6715d2bf93a75f" },
    vocab: { path: "sd-turbo/tokenizer/vocab.json", bytes: 1059962, sha256: "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349" },
    merges: { path: "sd-turbo/tokenizer/merges.txt", bytes: 524619, sha256: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" },
  },
  "sdxl-turbo": {
    text_encoder: { path: "sdxl-turbo/text_encoder/model.onnx", bytes: 246412196, sha256: "b9a932ea03a045785279a745628c98f919ae23d572a2254a4cba871f1c3caefe" },
    text_encoder_2: { path: "sdxl-turbo/text_encoder_2/model.onnx", bytes: 1390157299, sha256: "60994028321feb8faac23e4f2cfd12f450d775b3e764a782db9831bda2002311" },
    unet: { path: "sdxl-turbo/unet/model.onnx", bytes: 4421288, sha256: "c6a78a08925d218d8aee74f363466fd92b615d42725f5095658ee4ddb08e20c1", data: [
        { path: "sdxl-turbo/unet/unet_000.onnx_data", bytes: 416934400, sha256: "d53fa04cc23c6495bea86ea4a57f4fb9f618c28f1e99d16b2be65f734b74bea1" },
        { path: "sdxl-turbo/unet/unet_001.onnx_data", bytes: 418993920, sha256: "a40df5ed0c8b0dbe34e21029f4e4ad717577bb3ee05b1c4fefb26dac727138ee" },
        { path: "sdxl-turbo/unet/unet_002.onnx_data", bytes: 416808960, sha256: "4a230dc82312e2111cfdf474971d380ee3bd4e147ed2f0fbe79bfbf3a43a6a4b" },
        { path: "sdxl-turbo/unet/unet_003.onnx_data", bytes: 414858240, sha256: "3aebfef73ee5f287dedf1e02b7cf951f829ae2e9471d6953730c7ba91bef8b2f" },
        { path: "sdxl-turbo/unet/unet_004.onnx_data", bytes: 416808960, sha256: "254a0604561d4dc8f815876ff64a1572c701d5ae1ed7fb7dc19e59a6eeccfe3f" },
        { path: "sdxl-turbo/unet/unet_005.onnx_data", bytes: 418135040, sha256: "6ed7239cb0441dfc1b5b514ee9c492ccf9f38bf64068a9376c53771818a2ad9d" },
        { path: "sdxl-turbo/unet/unet_006.onnx_data", bytes: 416839680, sha256: "2d4dca7d2403455cebe156a2e1eeacec34ec2624d8b3b9a6b58441bddaca8d5a" },
        { path: "sdxl-turbo/unet/unet_007.onnx_data", bytes: 416808960, sha256: "994682bf01a7d8540422dbfe24c6bedfe0354e4d6614039486717710859be98a" },
        { path: "sdxl-turbo/unet/unet_008.onnx_data", bytes: 416829440, sha256: "95f97db26c83f609e12d5e58cf81b6dbfae5c27927db66f6806cc078208b7944" },
        { path: "sdxl-turbo/unet/unet_009.onnx_data", bytes: 416808960, sha256: "9673750f80e7948b4baa1ffa1b2a6cb3b06ca9a62f3a941e71fdda90aafdd248" },
        { path: "sdxl-turbo/unet/unet_010.onnx_data", bytes: 406996480, sha256: "080274fb862e436ea50bf302bef342843bc88389b8a4f60614e72cc8ef95c4f8" },
        { path: "sdxl-turbo/unet/unet_011.onnx_data", bytes: 416808960, sha256: "196c388d5242ee2179aa12ec9f3094f3c8019e61758da3544bbff435253a2c4b" },
        { path: "sdxl-turbo/unet/unet_012.onnx_data", bytes: 141271040, sha256: "100beb79369663e1a90e6325ace5ce3219266ef31ebdf7a11765cb44dbb08a56" },
      ] },
    vae_decoder: { path: "sdxl-turbo/vae_decoder/model.onnx", bytes: 198078154, sha256: "a49a58ad044e29434b9c806a41155f1976774e564f18143be77acf7103e3a7f6" },
    vocab: { path: "sdxl-turbo/tokenizer/vocab.json", bytes: 1059962, sha256: "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349" },
    merges: { path: "sdxl-turbo/tokenizer/merges.txt", bytes: 524619, sha256: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" },
    vocab_2: { path: "sdxl-turbo/tokenizer_2/vocab.json", bytes: 1059962, sha256: "e089ad92ba36837a0d31433e555c8f45fe601ab5c221d4f607ded32d9f7a4349" },
    merges_2: { path: "sdxl-turbo/tokenizer_2/merges.txt", bytes: 524619, sha256: "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a" },
  },
  },
} as const;

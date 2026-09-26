# Getting started

This walk-through takes you from a fresh install to your first generated image, using the built-in engine. It needs about ten minutes plus the model download (≈ 2.6 GB for the default model, SD-Turbo). Nothing else has to be installed.

## 1. Install and enable the plugin

Follow one of the [install routes in the README](https://github.com/johannes-kaindl/local-image-generator/blob/main/README.md#installation), then enable **Local Image Generator** under **Settings → Community plugins**. The plugin is desktop-only.

## 2. Open the generator

Click the image-plus icon in the ribbon, or run the command **Open generator** from the command palette. The generator opens in the right sidebar with two tabs, Generate and History.

## 3. Download the model

On first start the panel says that the built-in model is not downloaded yet and offers a **Download model** button that names the size. Nothing is downloaded before you click it.

1. Click **Download model**. The status line shows the progress per file; every file is checked against a checksum. You can cancel — finished files are kept.
2. When the notice "Model downloaded and verified — ready to generate." appears, the status line reads **Ready**.

The files are stored outside your vault, so they are never synced. If your GPU cannot run the built-in engine, the panel says so and points you to a server instead; see [Troubleshooting](troubleshooting.md).

## 4. Generate an image

1. Type a prompt into the field, for example "a quiet lake at dawn".
2. Optionally click a style chip such as **Sumi-e** or **Watercolor** to append its look to the prompt. Click it again to remove it.
3. Press **Generate**. The first image after an Obsidian start takes a few seconds longer while the model is loaded into the GPU; the status line counts along.

**Generate** greys out once the prompt, seed and steps match your last result, because regenerating would only reproduce the same picture. **Reroll** rolls a new seed and generates a variation.

## 5. Keep the result

- **Create** saves the image as an attachment and opens it. Set **Create button** to **Image + note** in the settings if you also want a note with the recipe (prompt, seed, steps, size) in its frontmatter.
- **Insert** saves the image and embeds it at the cursor of the note you have open.

Every run is kept in the **History** tab, from where a click loads the recipe back into Generate.

## Where to go next

- Start from an image you already have: pick one under **Reference** and set **Change strength**.
- Use a server (Draw Things, AUTOMATIC1111, Forge, SD.Next) or your own ComfyUI workflow: switch **Engine** under **Settings → Local Image Generator**. The README has a section on [setting up a server](https://github.com/johannes-kaindl/local-image-generator/blob/main/README.md#setting-up-a-server-optional).
- Something went wrong? [Troubleshooting](troubleshooting.md).

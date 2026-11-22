# ComfyUI reference setup

This folder holds what you need to point local-image-generator at your own ComfyUI server in several vaults at once:

- `workflows/`: API-format reference workflows (generate, edit, upscale) with their provenance, see the README there.
- `reference-config.example.json`: a template for the settings `tools/vault-abgleich.mjs` writes into each vault. It carries placeholders only.

## Set up your reference config

1. Copy `reference-config.example.json` to `reference-config.local.json` in this folder. Git ignores that file, so your host name and IDs stay on your machine.
2. Replace every `<...>` placeholder:

| Key | What to enter | Example |
|---|---|---|
| `settings.endpoint` | URL of your ComfyUI server, as the plugin should reach it | `http://comfy.local:8188` |
| `settings.comfyEndpointChoice.endpointId` and `endpointManager.endpointId` | ID of the image endpoint in the LLM Endpoint Manager (its `data.json`, field `endpoints[].id`) | `3f2c…` |
| `settings.comfyWorkflowFolder` | Vault folder the workflows are copied into, relative to the vault root | `Resources/ComfyUI` |
| `endpointManager.sourceVault` | Name of the vault whose LLM Endpoint Manager already holds that endpoint; it is copied into vaults that lack it | `Main` |

`retire` lists workflow files the tool moves to the vault's trash (`.trash/`), for example files you replaced. `settings.comfyWorkflowPath` (read by plugin versions before 0.23) is derived from the folder and the generate selection when you leave it out.

## Run it

```bash
npm run vault:abgleich -- --dry          # show every change, write nothing
npm run vault:abgleich                   # write all closed vaults under ~/Documents
npm run vault:abgleich -- --offene       # also write vaults open in Obsidian, then reload the plugin there
npm run vault:abgleich -- --root <dir> --vault <name> --config <file>
```

The tool refuses to run while the config is missing or still carries a placeholder, and names the keys. It treats a vault as open only if the main Obsidian profile lists it as open (`obsidian.json`); a vault open in a second instance with its own profile counts as closed, so close that instance first.

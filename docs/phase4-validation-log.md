# Phase 4 validation log

The record of Phase 4, the wind farm twin as a Fabric app: what was found out before the first deployment, what was checked without Fabric, and, once it has been deployed, what went wrong and what was changed. Phase 4 was written on 21 November 2026 and has not been deployed yet.

## Progress

| Step of the guide | Result | Notes |
|---|---|---|
| 0. Look at it first | Preview delivered | The user's verdict on the picture is open |
| 1. Tenant setting | Not run | |
| 2. Node.js on the workstation | Not run | The versions on the user's WSL are not known |
| 3. Create the app | Not run | The scaffolder has not run anywhere yet: finding 9 |
| 4. Sign in and deploy | Not run | |
| 5. Open the app | Not run | |
| 6. Connection check | Not run | Settles findings 4 and 11 |
| 7. Show it | Not run | |

## Found before the first deployment

Each of these would have been an obstacle, or a wrong statement in the guide. They were found by reading the released packages and the documentation, and by running what can run without Fabric.

| # | What I had planned or said | What is true | Source | Changed |
|---|---|---|---|---|
| 1 | "There is no connector for a KQL database" (roadmap, 20 November) | Rayfin 2.0.1 has a connector type `eventhouse` and one for a data agent, `fabric-dataagent`. Both are held back: "authoring is held in this release", the CLI refuses to add them | The guide inside `@microsoft/rayfin-guide@2.0.1` | The app uses functions, which are generally available. The roadmap says where the connectors would go when released |
| 2 | Write the app from Microsoft Learn | Learn describes CLI 1.36.2. The packages on npm are 2.0.1, published 17 to 20 November 2026 with general availability at Ignite. 2.0 changed the client (`RayfinClient.create` with services) and the functions (`ctx.Tokens`, `ctx.Secrets`; `getToken` and `getSecret` deprecated) | npm registry; the 2.0.0 changelog in the guide package | Everything is written and compiled against the 2.0.1 packages. A test refuses the deprecated calls |
| 3 | Call the data agent through its OpenAI-style address, as the Python SDK of Phase 3 does | The template's own guidance for data agents: use the MCP address, "Do not substitute the legacy OpenAI-style endpoint", and speak the protocol in four steps over plain HTTP | Skill `fabric-data-agent` inside the Universal App template of the CLI package | `askAgent` follows that guidance. Tested against the reference server of the protocol's SDK, as JSON and as an event stream |
| 4 | A function gets a token for the Eventhouse | The built-in audiences are Sql, Storage, Fabric, AzureAI and ADO. Anything else is a "custom audience", written as its resource address. Whether the platform issues one for `https://kusto.kusto.windows.net` to the identity of an app is not documented | Type definitions of `@microsoft/fabric-user-data-functions@2.0.1`; the resource from Microsoft's `skills-for-fabric` reference for Eventhouse queries | The function declares the custom audience, falls back to the Fabric token, and the connection check reports both. **Open until deployed** |
| 5 | The chat streams the answer | Functions cannot stream and stop after 240 seconds. The author of the original demo moved the chat to a container app for this reason | Functions limitations on Learn; his article of 13 July 2026 | The chat waits and shows the seconds. The function gives up at 225 seconds with a message |
| 6 | Rayfin generates the types of the functions at deployment | Only `functions init` and the development mode generate `types.ts`. `rayfin up` does not, and the template's build stops when the file disagrees with the code | `functions/typegen.md` in the guide; `validate-functions.mjs` of the template | Functions return JSON text, so `types.ts` is four entries of `string`, written in the generated form and accepted by the template's validator (4 authored, 4 generated) |
| 7 | My React code as I would write it | The template lints with the React compiler rules: no state set directly in an effect, no ref written during render | The template's ESLint configuration, run on the overlay | Three places rewritten. The overlay passes the template's lint |
| 8 | `npm install` works | With npm 10.9.9 (the one that comes with Node.js 22) the install of the template stopped: `Cannot read properties of null (reading 'edgesOut')`. npm 12.2.3 installed it | Run here, twice | `create-app.sh` says so when it sees npm 10; the guide has the cure |
| 9 | Run the scaffolder to see what it makes | I could not run `@microsoft/create-rayfin` where I work. The template it copies is inside the CLI package, and the template's own script applies the functions pack | The unpacked `@microsoft/rayfin-cli@2.0.1` | The app was assembled and checked from those files. That the scaffolder gives the same result on the user's machine is assumed, and `create-app.sh` checks the result with `npm run typecheck` |
| 10 | The scene is light enough for any browser | Without a graphics card (software rendering) one frame of the full picture took 2.3 seconds, and 1.2 after the shrubs lost their shadows and three quarters of their triangles | Headless Chrome with SwiftShader | The twin lowers its picture quality by itself in three steps when frames take more than 55 ms. `?fullquality` turns that off |
| 11 | The app asks the data agent as the user | A function calls outside resources as the identity of the app, which today is its owner. Separately, Microsoft documents that a service principal cannot yet use a data agent that has a KQL database among its sources. Whether the identity of an app is treated like a user or like a service principal is not said | Functions pages on Learn; `data-agent-service-principal.md` | The guide asks for one live and one history question after deployment and says what a difference would mean. **Open until deployed** |
| 12 | Sharing the app shares a picture | With application authentication, everyone the app is shared with reads the data with the owner's rights | "Share a Fabric app" on Learn | Said in "Before you start" |
| 13 | Positions and terrain have to be made for the app | Phase 1 already made them: `data/reference/terrain/heightmap.json`, `site.json`, `gis/roads.geojson`, and the registry has the same positions | The repository | `tools/build-twin-assets.py` builds the app's site data from those files; a test keeps it current |
| 14 | Turbines at true size | A 180 m turbine on a 4 km site is 47 pixels tall in the view of the whole site | First picture of the preview | Turbines are drawn 1.8 times larger and the ground 2.5 times taller. The guide and the README say so |

## Checked without Fabric

| Check | Result on 21 November 2026 |
|---|---|
| `npm test` in `app/` | 42 tests pass: site data and ground, the simulation and its fault story, the functions against a pretend Fabric API and Eventhouse, the MCP client against the reference server |
| Eight deliberate mistakes in the code, one at a time | All eight made a test fail: no session header, event stream not read, last table instead of first, no fallback to the other token, a loose check of the turbine identifier, no paging, nacelle turned the wrong way, a fault that never trips |
| The overlay inside the template of `@microsoft/rayfin-cli@2.0.1` | `npm run typecheck` (validator, functions build, `tsc -b`), `vite build` and the template's lint all pass |
| Pictures of the preview | Five, taken in headless Chrome and looked at: the site, a turbine, a fault building up, the tripped turbine, the site with a fault. No error in the browser console |
| `node tools/kql-syntax-check.js fabric/kql/94-twin-app-queries.kql` | No diagnostics |
| `pytest simulator/tests/test_phase4.py` | 6 tests: site data current, the contract the same on both sides, `types.ts` names the registered functions, names and thresholds of the earlier phases, every queried column exists, the pinned version is the one the guide names |
| `bash tools/script-tests/run.sh` | 73 scenarios, 11 of them for `app/create-app.sh` |

## Obstacles of the first deployment

None yet: not deployed.

## Still open

- The user's verdict on the picture.
- Everything the guide lists under "Not run, because it needs Fabric".
- Findings 4 and 11: which token the Eventhouse accepts, and whether the data agent answers live questions for the identity of the app.
- If neither token works for the Eventhouse, the fallback has to be built: the Lakehouse SQL endpoint over the shortcuts (documented for functions, about five minutes behind), or a service principal whose secret the function reads.
- A view of one turbine taken apart by component, which the roadmap names, is not built. The panel lists the component values instead.
- The site data is bundled into the page. Reading it from the registry in the KQL database (`CurrentAssets()`) would let a changed site show without a new deployment.

## Lessons so far

- Three days after a product becomes generally available, its documentation describes the version before. The packages themselves, and the guide packed with them, were the reliable source.
- A template that ships guidance for coding agents is worth reading as a human: the answer to "how do I call a data agent from a function" was in it, written by the people who run the service.
- Where the documentation cannot say whether something works, build both ways and a check that reports which one did. One deployment then answers the question instead of one deployment per guess.
- Measure a picture on the worst machine it may meet. The scene that looked light was two seconds a frame without a graphics card.

## Files of Phase 4

Against the repository at the end of Phase 3: 47 new files and 7 changed ones. No file was removed or renamed.

| Changed |
|---|
| `README.md` |
| `docs/00-architecture.md` |
| `docs/03-roadmap.md` |
| `docs/troubleshooting.md` |
| `fabric/README.md` |
| `tools/check-scripts.sh` |
| `tools/script-tests/run.sh` |

| New | Files |
|---|---|
| `app/` | `README.md`, `create-app.sh`, `.gitignore`; the workbench: `package.json`, `tsconfig.json`, `css.d.ts`, `build-preview.mjs`, `preview-main.tsx`, `screenshots.mjs` |
| `app/overlay/packages/frontend/src/` | `App.tsx`; `twin/TwinApp.tsx`, `twin/TwinView.tsx`, `twin/twin.css`; `twin/scene/` (`SceneEngine.ts`, `terrain.ts`, `turbine.ts`); `twin/ui/` (`panels.tsx`, `ChatPanel.tsx`, `format.ts`); `twin/data/` (`contract.ts`, `provider.ts`, `sampleProvider.ts`, `fabricProvider.ts`, `site.ts`); `twin/assets/site-data.ts`, which `tools/build-twin-assets.py` generates |
| `app/overlay/packages/functions/src/` | `function_app.ts`, `types.ts`, `contract.ts`, `config.ts`, `fabric.ts`, `kusto.ts`, `live.ts`, `agent.ts` |
| `app/preview/` | `windfarm-twin-preview.html`, built by `npm run preview` |
| `app/test/` | `data.spec.ts`, `functions.spec.ts`, `agent.spec.ts` |
| `docs/` | `11-deployment-guide-phase4.md`, `phase4-validation-log.md`, `images/phase4-twin-site.jpg`, `images/phase4-twin-fault.jpg` |
| `fabric/kql/` | `94-twin-app-queries.kql` |
| `simulator/tests/` | `test_phase4.py` |
| `tools/` | `build-twin-assets.py`; `script-tests/stubs-app/` (`node`, `npm`, `npx`) |

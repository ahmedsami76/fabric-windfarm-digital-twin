# Phase 4 validation log

The record of Phase 4, the wind farm twin as a Fabric app: what was found out before the first deployment, what was checked without Fabric, and, once it has been deployed, what went wrong and what was changed. Phase 4 was written on 21 November 2026 and has not been deployed yet. On 22 November the exploded view was added (update 1): findings 15 to 21. On 23 November, on the way to the first deployment, the scripts in the user's copy had lost their execute permission for the third time: obstacle A. The same night the first deployment took place: obstacles B to G. It showed that a Fabric app cannot read the Eventhouse directly, and update 2, built that night, gives the live values two other routes. Update 2 has not run in Fabric yet.

## Progress

| Step of the guide | Result | Notes |
|---|---|---|
| Before you start: the earlier phases are running | Open | 23 November, 00:38: the user had restarted "the fabric instance and the vm" and asked for the command that rebuilds `config/demo.env`. Obstacle A. Whether the settings file was rebuilt and whether telemetry arrives again has not been reported |
| 0. Look at it first | Preview delivered twice | First on 21 November. The user asked whether it had an exploded view; it had not (finding 15). Second preview, with it, on 22 November. The user's verdict on the picture is open |
| 1. Tenant setting | Not run | |
| 2. Node.js on the workstation | Started 23 November, 00:54 | Obstacle B: `nvm` was not installed, and the guide's line was typed with its label. New commands given (Node.js 22, npm 12). His result is open |
| 3. Create the app | Done by the user, output not seen | At 01:01 on 23 November he was in `app/windfarm-twin` and `npx rayfin` found the project root, so `create-app.sh` and the scaffolder ran. Which Node.js and npm versions, and what the script printed, is not known |
| 4. Sign in and deploy | Done by the user on 23 November between 01:17 and 01:22, output not seen | Obstacles C (no keychain on WSL) and D (the sign-in waited for a browser that never opened). Which cure of D worked, what `npx rayfin up` printed and how long it took is not known. `up` accepted the custom audience without complaint |
| 5. Open the app | Done, 01:22 | The page loads and reaches the functions: the connection check answered |
| 6. Connection check | Third run 01:31: six lines, **finding 4 settled** | PASS: token for the Fabric API; workspace and KQL database (`WindFarmEH` at `https://trd-fpskz3aaeymu57w7uy.z2.kusto.fabric.microsoft.com`); data agent (`e493aa32-83b0-490e-8790-16e9935d14f5`). FAIL: token for the Eventhouse (not issued, obstacle E); query with the Fabric token: `The Eventhouse answered 401:` with an empty body. A Fabric app as it runs today cannot read the Eventhouse directly. Obstacles E and F on the way. The route for the live values is being chosen with the user: Lakehouse SQL endpoint over the shortcuts (`AudienceType.Sql`, `mssql`, at least 5 minutes behind: `TargetLatencyInMinutes=5`), or a service principal whose secret the function reads (`ctx.Secrets`, seconds behind, needs an app registration) |
| 7. Real-time values: the service principal (new on 23 November) | Not run | The user chose "both routes, real time first" at about 01:35 and said he can create an app registration in the tenant |
| 8. Show it | Not run | |

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
| 15 | "A view of one turbine taken apart by component … is not built. The panel lists the component values instead" (this log and the roadmap, 21 November) | The original demo pulls a turbine apart component by component, and the roadmap had named a component view per turbine for this phase. I left it out of the first delivery; it stood only under "Not yet" in the roadmap and under "Still open" here | The user's question of 21 November, 23:52: "have you included an 'exploded view' feature in the 3d graphics?" | Built on 22 November: the cover lifts off, eleven components move apart, each with a label of live values and the colour of its condition; a list of the components in the turbine panel. The components are the eleven types of `ref_components` |
| 16 | The simulation of the preview raised `GBX-VIB` (critical, at 5.5 mm/s, with a derate) and `GBX-OIL-TEMP` (warning, at 80 °C) | Neither code exists. The alarm catalogue has `GBX-VIB-HIGH` (warning, 5.5, no action), `GBX-VIB-CRIT` (critical, 8.0, derate to 30%), `GBX-OIL-TEMP-HIGH` (78), `-CRIT` (88) and `-TRIP` (96). The first preview showed an alarm the deployed app can never show | `data/reference/alarm_codes.csv`, read when the components had to be coloured by alarm | The simulated fault now runs through those five alarms at their levels, with the derate and the trip where the controller has them. A test compares code, level, severity, text and action with the catalogue |
| 17 | In the simulation a tripped turbine kept more than 5 mm/s of gearbox vibration, and every temperature lost the share that came from the load in the second of the trip | A gearbox that stands does not vibrate, and a machine keeps its heat for a while | Reading the code of the simulation when the four signals were added | Vibration is 0.2 mm/s at standstill; temperatures fall and rise over minutes. Two tests |
| 18 | "Nacelle red" meant vibration at 5.5 mm/s | With the oil at 90 °C and three gearbox alarms active, a tripped turbine had an amber nacelle: the red level knew vibration only | Picture of the tripped turbine | The red level is the first alarm of the controller on either signal: 5.5 mm/s or 78 °C. A test ties both numbers to the catalogue |
| 19 | Setting `transparent` on a material makes it see-through | In Three.js 0.187 the shader is built for opaque or for transparent, and a material that changes between them has to be rebuilt (`needsUpdate`). The first picture of the opened turbine showed a solid cover | First picture of the exploded view | The cover is rebuilt when it starts and when it stops being glass |
| 20 | Look at the opened turbine from the front quarter | From the front the hub is the near thing and takes a third of the picture, one blade crosses it, and the drivetrain is small behind. A label was hidden under the alarm panel when the panel grew | The first pictures of the exploded view | The camera stands behind the rotor plane, so the drivetrain is near. The distance is fitted to the part of the page the panels leave free, and again when the chat is hidden or shown. Labels move out from under panels |
| 21 | The box the camera is placed by holds every part | The nose of the hub was 0.14 m outside it | A test written for the exploded view, on its first run | Box corrected; the test stays |

## Checked without Fabric

| Check | Result on 22 November 2026 |
|---|---|
| `npm test` in `app/` | 92 tests pass on 23 November with update 2 (60 on 22 November, 42 on 21 November): site data and ground, the simulation and its fault story against the alarm catalogue, the components and their alarms against the reference data, the parts of the opened turbine, the functions against a pretend Fabric API and Eventhouse, the MCP client against the reference server |
| 25 deliberate mistakes in the code, one at a time | All 25 made a test fail. The eight of 21 November: no session header, event stream not read, last table instead of first, no fallback to the other token, a loose check of the turbine identifier, no paging, nacelle turned the wrong way, a fault that never trips. Seventeen for update 1, among them: an alarm that finds no component, an information that colours one, an alarm of another turbine, a level that is not the catalogue's, a stopped gearbox that vibrates, a column not asked for, a value from the wrong column, a part that does not move, the hub left in the main bearing, a part outside the cover |
| The overlay inside the template of `@microsoft/rayfin-cli@2.0.1` | `npm run typecheck` (validator, functions build, `tsc -b`), `vite build` and the template's lint all pass |
| Pictures of the preview | Six, taken in headless Chrome and looked at: the site, a turbine, the turbine taken apart, the same at the height of a fault, the tripped turbine, the site with a fault. No error in the browser console |
| The exploded view, beyond those pictures | Looked at: one frame of the opening, the yawed turbine WT-05 (yaw ring amber), a row of the list pointed at (part and label marked), the chat hidden, a window of 1920 by 1080, the turbine after closing. Read from the page by a script: pointing at a row of the list marks the label of that part, pointing at the gearbox in the scene marks its row, Esc closes the view and brings the tiles back |
| `node tools/kql-syntax-check.js fabric/kql/94-twin-app-queries.kql` | No diagnostics |
| `pytest simulator/tests/test_phase4.py` | 6 tests: site data current, the contract the same on both sides, `types.ts` names the registered functions, names and thresholds of the earlier phases, every queried column exists, the pinned version is the one the guide names |
| `bash tools/script-tests/run.sh` | 93 scenarios on 23 November (73 before), 16 of them for `app/create-app.sh` and 15 for `app/create-principal.sh` |
| `python3 tools/check-twin-sql.py` (new on 23 November) | The five T-SQL statements of the Lakehouse route: names, syntax, and their answers on a made-up site |
| Update 2 inside the template of `@microsoft/rayfin-cli@2.0.1` | `npm run typecheck` (7 authored, 7 generated), `vite build`, the template's lint on the page, the CLI's analysis of the declared audiences, the functions bundle with the SQL driver |

## Met on the way to the first deployment

Obstacle A is not an obstacle of the Phase 4 guide. It came up while the environment of the earlier phases was brought back, and it changes what the next regeneration has to do.

| # | When | What happened | Cause | Cure given | To change at the regeneration |
|---|---|---|---|---|---|
| A | 23 November 2026, 00:39 | On the WSL workstation both commands of my answer stopped: `bash: ./infra/rebuild-env.sh: Permission denied` and `bash: ./infra/vm.sh: Permission denied` | The scripts in the user's copy had lost their execute permission. It is the third time, after obstacle 12 of Phase 1 and obstacle 7 of Phase 3. How the files got into the folder since 21 November is not known. My answer gave the commands in the form that needs the permission (`./infra/…`), as the guides do | `find . -name '*.sh' -exec chmod +x {} +`, then the two commands with `bash` in front. Tried in a copy of the repository with the permission taken from every file: the same error; all 73 scenario tests pass there, because they start every script through `bash`; after the `find` line every script is executable and `tools/check-scripts.sh` reports 15 of 15; in a copy without `app/` the line also ends without an error. The user's result is open | Every command in the guides and every usage line and hint in the scripts starts a script through `bash`. Today 150 lines in 16 files start one directly: 54 in the Phase 1 guide, 35 in the troubleshooting page, 35 in the scripts. A check keeps it so. The `chmod` step of the Phase 1 guide, the troubleshooting row and the third rule of `tools/check-scripts.sh` did not prevent the second and the third time |

## Obstacles of the first deployment

The deployment started on 23 November 2026 at step 2. Changes named here are in the working copy and go out with the regeneration.

| # | Step | What happened | Cause | Changed | Checked |
|---|---|---|---|---|---|
| B | 2 | 00:54. The user typed `nvm: nvm install --lts`; the shell answered `Command 'nvm:' not found` | Three faults of one line of the guide: "With `nvm`: `nvm install --lts`". The label read as part of the command. `nvm` was taken for installed; it is not on his WSL. And "the current LTS" is Node.js 26 since October 2026, while `@microsoft/create-rayfin@2.0.1` and `@microsoft/rayfin-cli@2.0.1` declare Node.js 20, 22 and 24 (`engines`), and the app was built on 22.23.5 only. The CLI itself checks only for 20 or newer, and only for `rayfin dev`, so what happens on 26 is not known | Step 2 is a block of four commands: install `nvm` 0.40.5, `source ~/.bashrc`, `nvm install 22`, `npm install -g npm@12`, with a check and the reasons. `create-app.sh` points to step 2 when Node.js is missing or too old, and prints a note for a version other than 22 or 24. `npm@latest` became `npm@12` everywhere. Three troubleshooting rows | Three new scenario tests (Node.js 26, 24, 22). The `engines` values and the CLI's check read in the unpacked packages; the release status of Node.js from nodejs.org and endoflife.date; the nvm installer read (version, what it writes). **The four commands were not run here**: running the downloaded installer was refused in my environment. His result is open |
| C | 4 | 01:01. `npx rayfin login`: `Login failed: OS keychain is not available and plaintext token storage is not enabled`; `npx rayfin up` stopped with the same message | WSL has no credential store. The guide knew it, but only as a row of its troubleshooting table, while on WSL it happens to everyone | `export RAYFIN_ENCRYPTION_FALLBACK_ENABLED=true` is the second line of step 4, with what it means (sign-in kept unencrypted under `~/.rayfin`, for this terminal only, `npx rayfin logout` removes it). The hint `create-app.sh` prints at its end has the line too | The setting and `logout` read in `@microsoft/rayfin-guide@2.0.1` (`cli/environment-variables.md`, `app-backend/deploy.md`); the message he got names the same setting. His result is open |
| D | 4 | 01:16. "how long is it expected to run for?" About a quarter of an hour after the cure of obstacle C a command was still running. The newest file in `~/.rayfin/logs` was the failed `up` of 01:01, so no `up` had started: `npx rayfin login` was waiting | `auth/rayfin-auth.js` of the CLI 2.0.1: on Linux the browser is started with `"$BROWSER" url` or `xdg-open url` through `exec`, the result is ignored, the address is not printed, and the fall-back to a device code comes only when the interactive sign-in throws. On WSL without a Linux browser nothing opens and nothing ends. The guide said "opens the browser on Windows", taken from Rayfin's own guide and not tried | Cure given: a three-line program `~/bin/open-in-windows` named in `BROWSER`, which keeps the address in `~/rayfin-login-url.txt` and hands it to Windows through `powershell.exe Start-Process`. Step 4 of the guide says that no browser opens on WSL and that the command then waits without end; a troubleshooting row has the cure. To do at the regeneration, once it is known to work: put the program into the repository and the `export` into step 4 | Called the way the CLI calls it, with a stand-in for PowerShell: the whole address arrives and is kept in the file. **The hand-over to Windows was not tried.** I also had no measured time for a deployment to answer his question with. His result is open |
| E | 6 | 01:22. The connection check, complete: `Data source: fabric`, `FAIL The check itself: WorkloadException/GenericConnectionCustomAudienceRequiresItemIdentity: Connections to a custom audience are only available when the item uses its own identity.` The live values failed with the same message | Finding 4, first half, answered by the service: a token for a custom audience (`https://kusto.kusto.windows.net`) is issued only to an app that runs as its own identity, and a Fabric app today runs as its owner (`functions/index.md` of the Rayfin guide: "For current Fabric apps, the app identity is the owner of the Fabric app item"). `npx rayfin up` deploys the declaration all the same; the refusal comes at every call of a function that declares it, before the function's own code runs. So the fallback inside the function never got its turn, and the check could not print its six lines. I had built for "the token is missing when read", which is what the package's documentation describes, not for "the call is refused" | `function_app.ts`: the three annotations declare `AudienceType.Fabric` only, and the Eventhouse token of the three functions throws, so the queries go out with the Fabric token. Given to the user as a paste that changes his two copies of the file, then `npm run typecheck && npx rayfin up` | The changed overlay inside the template: `npm run typecheck` passes; 60 app tests pass, among them the one without an Eventhouse token. **Whether the Eventhouse accepts the Fabric token is not known**; no documentation found says so. If it does not: read the tables through the Lakehouse SQL endpoint (`AudienceType.Sql`), a few minutes behind. Still to do when the result is in: the connection check and the guide (the rows on the two tokens, "what is not tested") describe the closed route as open |
| F | 6 | 01:27, after the change of obstacle E was deployed. `FAIL The check itself: The function getDiagnostics did not return JSON.` and `Last error of the live values: InternalError: An internal execution error occured during function execution` | The first message is a fault of the page. The functions return JSON text; `FunctionClient.invoke` of `@microsoft/rayfin-functions@2.0.1` parses JSON text itself ("Auto-parse JSON-encoded output strings") and hands over the object; the page called `JSON.parse` on that object. So the check had run and its six lines were thrown away. My tests had used a stand-in client of my own that returned the text; I had not read the released client. The second message is the host's wording for a function that threw; its cause is in the six lines that were lost, most likely the Eventhouse refusing the Fabric token | New `twin/data/functionResult.ts`: `fromFunction` takes the object as it is and parses text; `fabricProvider.ts` uses it. Given to the user as a paste for his two copies, then `npm run typecheck && npx rayfin up` | The released `FunctionClient.js` with a pretend transport: JSON text out, array in, and the old page's "did not return JSON" reproduced. Three new tests (63 in `app/`). Typecheck, build and lint inside the template. The paste, run on a copy of the delivered repository, gives the working copy's files. His result is open. Still to do: a function that throws reaches the page as "InternalError" without its reason; the functions should catch and return the reason |

| G | 6 | 01:31. The third connection check, six lines at last: `FAIL Query with the Fabric token: The Eventhouse answered 401:` (empty body), after `FAIL Token for the Eventhouse` from obstacle E. Everything else passed | Finding 4, second half: the Eventhouse does not accept the token for the Fabric API. With obstacle E that closes both ways the plan had. A Fabric app, running as its owner, cannot read an Eventhouse directly; no setting on the user's side changes that | Asked the user which way to go (four choices, with what each costs); he chose both routes, real time first. Built that night as **update 2**: seven functions instead of four, each route with its own three so that a refused declaration cannot stop the other; the Lakehouse route (`sql.ts`, the driver `mssql` as Rayfin's guide prescribes, T-SQL versions of the four queries); the Eventhouse route as a service principal (`principal.ts`, three secrets of the app read through `ctx.Secrets`, client-credentials token kept in memory); `app/create-principal.sh` to set the principal up, show it, remove it; the page chooses the route (`routes.ts`), asks less often on the Lakehouse, and its badge says "Lakehouse copy · N min behind" and never "Live" for it; every function returns its failure with the reason instead of throwing; the connection check reports both routes with PASS, FAIL and SKIP; `create-app.sh` adds the driver; guide step 7 and the section "How the live values reach the app" | 92 tests in `app/` (63 before). The template's validator: 7 authored, 7 generated. The CLI's own analysis of the project: `Fabric` for four functions, `Fabric` and `Sql` for three, no custom audience. The functions bundled with the CLI's esbuild settings, driver included: 1.8 MB; a bundle with the driver alone starts and fails at the name lookup of a made-up server, as it should. `tools/check-twin-sql.py`: the T-SQL run in DuckDB on a made-up site against what the KQL returns by design. 93 script scenarios (76 before), 15 of them for the new script; its `az` options against the help of Azure CLI 2.93.0. **Nothing of update 2 has run in Fabric or against Azure**: the SQL token, the SQL endpoint with these statements, the real age of the copies, the secrets, the principal's access. Reports of other users on whether a workspace role alone lets a principal read a Fabric KQL database differ; the script prints the `.add database … viewers` command for that case |

## Still open

- **Update 2 in Fabric:** the connection check after it is deployed (which lines of the Lakehouse route pass, and the age it prints); then `app/create-principal.sh` and the three lines of the Eventhouse route.
- Obstacle A: whether `bash infra/rebuild-env.sh --force` and `bash infra/vm.sh status` ran on the user's workstation, and what they printed. `infra/rebuild-env.sh` has not been seen running against Azure yet (obstacle 19 of Phase 1).
- The change obstacle A asks for: scripts started through `bash` in every guide, usage line and hint.
- Obstacle B: whether the four commands of step 2 ran on the user's WSL, and which versions `node --version` and `npm --version` print there. Whether Rayfin 2.0.1 works on Node.js 24 or 26 has not been tried.
- Obstacles C and D: whether the sign-in went through with the setting and the opener, and how long `npx rayfin up` takes. If the opener fails: `RAYFIN_TOKEN` from `az account get-access-token --resource https://api.fabric.microsoft.com`, which the CLI passes through unchanged; whether one Fabric token is enough for everything `up` does is not known.
- Step 3: the output of `bash app/create-app.sh` on the user's machine, the first run of Microsoft's scaffolder, was not sent.
- The user's verdict on the picture.
- Everything the guide lists under "Not run, because it needs Fabric".
- Finding 11: whether the data agent answers for the identity of the app, and also for live questions. No question has been put to the chat of the deployed app yet. (Finding 4 is settled: obstacles E and G.)
- The exploded view on a computer with a graphics card. Here the movement was seen as single frames of a software renderer.
- The questions the list of components sends to the data agent. They use the component names of `ref_components`; none has been put to the agent.
- Rotor hub, main bearing and transformer can only ever be green: no alarm of the catalogue names them. The transformer and the main bearing have a temperature and no level to judge it by.
- The site data is bundled into the page. Reading it from the registry in the KQL database (`CurrentAssets()`) would let a changed site show without a new deployment.

## Lessons so far

- Three days after a product becomes generally available, its documentation describes the version before. The packages themselves, and the guide packed with them, were the reliable source.
- A template that ships guidance for coding agents is worth reading as a human: the answer to "how do I call a data agent from a function" was in it, written by the people who run the service.
- Where the documentation cannot say whether something works, build both ways and a check that reports which one did. One deployment then answers the question instead of one deployment per guess.
- Measure a picture on the worst machine it may meet. The scene that looked light was two seconds a frame without a graphics card.
- A feature of the original that is left out belongs at the top of what is delivered, where it is read, not in a list at the end of a log. The exploded view was the first thing the user asked about.
- A simulation that stands in for real data takes its codes and levels from the same reference file as the real thing, with a test between them. The invented alarm code of the first preview was found only because a new feature had to read it.
- An obstacle that comes back a third time was not cured the first two times. A `chmod` step, a troubleshooting row and a check all need the reader to do something after the files have changed hands. A command that starts with `bash` needs nothing. And a command typed into an answer belongs to the guide: it follows the same rule.
- A command in running text gets typed with the words around it. Every command stands in a code block, alone. And a guide does not assume a tool it has not installed or checked for: "with `nvm`" was written for a machine that has it.
- "The newest" is not a version. `--lts`, `@latest` and "current" pointed at one thing when the guide was tested and at another a month later; the guide names the version that was tested.
- What is certain on the reader's kind of machine belongs in the step, not in the troubleshooting table. The guide was written for a WSL workstation and kept the WSL keychain setting for "if something fails".
- A step that can wait without end needs a time in the guide: how long it normally takes, and what to look at when it takes longer. The user had to ask.
- A fallback has to sit outside the thing that can fail. The second token was tried inside the function, and the platform refused the function before it started. A check that is meant to report on a declaration must not itself carry that declaration.
- A stand-in I wrote myself tests my idea of the other side. Where the other side's code is in a released package, run that code in the test, as was done for the MCP client and not for the function client.

## Files of Phase 4

Against the repository at the end of Phase 3: 52 new files and 7 changed ones. No file was removed or renamed. Update 1 added five of the new files and changed 24 others; its own list follows the two tables.

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
| `app/overlay/packages/frontend/src/` | `App.tsx`; `twin/TwinApp.tsx`, `twin/TwinView.tsx`, `twin/twin.css`; `twin/scene/` (`SceneEngine.ts`, `terrain.ts`, `turbine.ts`, `exploded.ts`); `twin/ui/` (`panels.tsx`, `ChatPanel.tsx`, `format.ts`); `twin/data/` (`contract.ts`, `provider.ts`, `sampleProvider.ts`, `fabricProvider.ts`, `site.ts`, `components.ts`); `twin/assets/site-data.ts`, which `tools/build-twin-assets.py` generates |
| `app/overlay/packages/functions/src/` | `function_app.ts`, `types.ts`, `contract.ts`, `config.ts`, `fabric.ts`, `kusto.ts`, `live.ts`, `agent.ts` |
| `app/preview/` | `windfarm-twin-preview.html`, built by `npm run preview` |
| `app/test/` | `data.spec.ts`, `functions.spec.ts`, `agent.spec.ts`, `components.spec.ts`, `scene.spec.ts` |
| `docs/` | `11-deployment-guide-phase4.md`, `phase4-validation-log.md`, `images/phase4-twin-site.jpg`, `images/phase4-twin-fault.jpg`, `images/phase4-twin-components.jpg` |
| `fabric/kql/` | `94-twin-app-queries.kql` |
| `simulator/tests/` | `test_phase4.py` |
| `tools/` | `build-twin-assets.py`; `script-tests/stubs-app/` (`node`, `npm`, `npx`) |

### Files of update 1, the exploded view (22 November 2026)

Against the first delivery of Phase 4 (`changes-phase4.zip`): 5 new files and 24 changed ones. `changes-phase4-update1.zip` holds these 29 files and nothing else.

| New |
|---|
| `app/overlay/packages/frontend/src/twin/data/components.ts` |
| `app/overlay/packages/frontend/src/twin/scene/exploded.ts` |
| `app/test/components.spec.ts` |
| `app/test/scene.spec.ts` |
| `docs/images/phase4-twin-components.jpg` |

| Changed | What changed |
|---|---|
| `app/overlay/packages/frontend/src/twin/scene/SceneEngine.ts` | Opens and closes a turbine: movement, cover, colours, labels with lines, camera, pointer |
| `app/overlay/packages/frontend/src/twin/scene/turbine.ts` | Tower, hub and blades each have a material of their own; the view names its parts |
| `app/overlay/packages/frontend/src/twin/TwinApp.tsx`, `TwinView.tsx` | Which turbine is open, which component the pointer is on |
| `app/overlay/packages/frontend/src/twin/ui/panels.tsx`, `ui/format.ts` | The button, the list of components, `degC` shown as °C |
| `app/overlay/packages/frontend/src/twin/twin.css` | Styles of the labels, the lines, the button and the list |
| `app/overlay/packages/frontend/src/twin/data/site.ts` | Alarm level of the oil temperature, the twin's level for the yaw error |
| `app/overlay/packages/frontend/src/twin/data/sampleProvider.ts` | Findings 16 and 17, and the four added signals |
| `app/overlay/packages/frontend/src/twin/data/contract.ts`, `app/overlay/packages/functions/src/contract.ts` | Four signals more per turbine |
| `app/overlay/packages/functions/src/live.ts`, `fabric/kql/94-twin-app-queries.kql` | The live query asks for them |
| `app/test/data.spec.ts`, `app/test/functions.spec.ts` | Tests of the new simulation and of query, mapping and contract |
| `app/screenshots.mjs` | Six pictures, two of them of the opened turbine |
| `app/preview/windfarm-twin-preview.html` | Rebuilt |
| `docs/images/phase4-twin-fault.jpg` | Taken again: the alarm codes and the panel have changed |
| `README.md`, `app/README.md`, `docs/00-architecture.md`, `docs/03-roadmap.md`, `docs/11-deployment-guide-phase4.md`, `docs/phase4-validation-log.md` | Say what is new |

### Files of update 2, the two routes for the live values (23 November 2026)

Against update 1 (`changes-phase4-update1.zip`): 10 new files and 28 changed ones. `changes-phase4-update2.zip` holds these 38 files and nothing else. It also carries what obstacles B, C, D and F changed.

| New | What it is |
|---|---|
| `app/create-principal.sh` | Sets up, shows or removes the service principal of the Eventhouse route |
| `app/overlay/packages/functions/src/principal.ts` | The service principal: its three secrets, its token from Microsoft Entra ID |
| `app/overlay/packages/functions/src/sql.ts` | T-SQL on the SQL analytics endpoint of the Lakehouse, with the driver `mssql` |
| `app/overlay/packages/frontend/src/twin/data/routes.ts` | Which route the page takes, when it falls back and when it tries again |
| `app/overlay/packages/frontend/src/twin/data/functionResult.ts` | What a function returned: the object the client parsed, text, or a failure with its reason |
| `app/test/routes.spec.ts` | Tests of the two files above and of what the badge says |
| `fabric/sql/94-twin-app-queries.sql` | The five T-SQL statements of the Lakehouse route, to run by hand |
| `tools/check-twin-sql.py` | Checks those statements: names, syntax, answers |
| `tools/script-tests/stubs-principal/az`, `npx` | Stand-ins for the scenario tests of `create-principal.sh` |

| Changed | What changed |
|---|---|
| `app/overlay/packages/functions/src/function_app.ts`, `types.ts` | Seven functions; no custom audience; SQL declared by the Lakehouse functions only; failures returned, not thrown |
| `app/overlay/packages/functions/src/live.ts` | The queries of both routes, their values, trends and checks |
| `app/overlay/packages/functions/src/fabric.ts`, `config.ts` | The Lakehouse lookup; names of the secrets; secrets masked in messages |
| `app/overlay/packages/functions/src/contract.ts`, `app/overlay/packages/frontend/src/twin/data/contract.ts` | `route` on the live state, `skipped` on a line of the check, `Failure` |
| `app/overlay/packages/frontend/src/twin/data/fabricProvider.ts`, `provider.ts`, `sampleProvider.ts` | The two routes in the page; how often it asks; what "live", "delayed" and "stale" mean |
| `app/overlay/packages/frontend/src/twin/TwinApp.tsx`, `ui/panels.tsx`, `twin.css` | The badge; the connection check with both routes |
| `app/create-app.sh` | Node.js versions (obstacle B); the keychain line in its hint (obstacle C); adds the SQL driver |
| `app/package.json` | The SQL driver for the tests of the workbench |
| `app/preview/windfarm-twin-preview.html` | Rebuilt |
| `app/test/functions.spec.ts`, `app/test/data.spec.ts`, `simulator/tests/test_phase4.py` | Tests of all of the above |
| `tools/script-tests/run.sh`, `tools/script-tests/stubs-app/npm` | Scenarios for both scripts |
| `README.md`, `app/README.md`, `fabric/README.md`, `docs/00-architecture.md`, `docs/03-roadmap.md`, `docs/11-deployment-guide-phase4.md`, `docs/phase4-validation-log.md` | The two routes; steps 2, 4, 6, 7 and 8 of the guide; obstacles A to G |


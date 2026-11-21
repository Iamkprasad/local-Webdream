# Local Dream Image

A **standalone, image-only webapp** built from the `local-webdream` repository.
It is not PilliVesh and does not import or depend on it. It runs in the same
place as PilliVesh: a Debian/Termux guest on your Snapdragon 870 phone, served
on `127.0.0.1`.

## What it is

- A self-contained Python stdlib server (`server.py`) + static web UI (`web/`).
- Uses the **portable engine from the Local Dream family**: `stable-diffusion.cpp`
  (upstream of the `happyyzy/stable-diffusion.cpp` submodule this repo uses for
  its DiT pipelines). Its native `sdcpp` HTTP API is wrapped in `server.py`.
- Reuses Local Dream's design ideas: lazy model process on a fixed loopback
  port, curated model catalog, allow-listed downloads, progress + final image
  streaming, one resident model, RAM gate.
- The Android APK, QNN SDK and Bionic binary are **not** used — they cannot run
  in Debian. The Android core is only the design reference for this app.

## Run on the phone

Everything runs on the phone inside Debian/Termux. No Windows, no APK.

### 1. Get the branch (once)

```sh
apt update
apt install -y python3 git cmake ninja-build build-essential

cd ~
git clone --branch standalone-image-webapp --single-branch \
  https://github.com/Iamkprasad/local-Webdream.git
cd local-Webdream/standalone_image
```

If you already cloned it:

```sh
cd ~/local-Webdream
git fetch origin
git checkout standalone-image-webapp
git pull
cd standalone_image
```

### 2. Build the engine (once)

```sh
chmod +x bin/*.sh
bin/install-engine.sh
```

This builds `stable-diffusion.cpp` (`sd-server`) CPU-only into
`standalone_image/bin/sd-server`. Needs a few GB of free space.

Optional checks (no model download needed):

```sh
python3 selfcheck.py     # 8 assert-based checks
bin/check.sh             # engine + catalog state
```

### 3. Start the webapp

```sh
python3 server.py
# Local Dream Image on http://127.0.0.1:8090/
```

Open **http://127.0.0.1:8090/** in a browser on the phone. If your Android
browser cannot reach the proot loopback, use a browser inside the Debian/X11
session instead.

Ports: webapp `8090`, engine `8092` — no conflict with other local tools on
8080/8091.

### 4. Use it

1. **Models** → **Download** *SD 1.5 Q8* (~1.1 GB) → wait for the progress line.
2. Click **Load**; the header pill should say **Engine online**.
3. **Create** → prompt → keep **256 × 256 / 10 steps** → **Generate**.
4. Progress streams live; the PNG appears in **Result** and in the **Gallery**.
5. **Cancel** stops a run; **Unload** frees RAM when finished.

Later sessions: skip step 2 — just `cd ~/local-Webdream/standalone_image && python3 server.py`.

HF search in the Models box is read-only. To enable in-app download of another
repo, add an entry to `CATALOG` in `server.py` (host must be `huggingface.co`,
file must be `.gguf`).

### Useful tweaks

```sh
LD_WEB_PORT=8095 LD_ENGINE_PORT=8096 python3 server.py   # different ports
LD_ENGINE=/path/to/sd-server python3 server.py           # existing engine binary
```

Faster first test: **128 × 128 / 5 steps**.

### Troubleshooting

- `python3`/`cmake`/`ninja` missing → `apt install -y python3 cmake ninja-build build-essential`
- Build fails → check `df -h`, then rerun `bin/install-engine.sh`
- `Engine offline` → run `bin/check.sh`; make sure a model is loaded
- Very slow → drop to 128×128 / 5 steps; this is CPU-only on the 870

## Limits

- CPU-only inference on Snapdragon 870 / Hexagon V68. Expect slow generation;
  start at 256×256 / 10 steps, enable 512 only with patience.
- No NPU: precompiled Qualcomm QNN assets target newer chipsets, and the
  Android-only Local Dream core cannot run in Debian.
- First run needs a build toolchain and ~1 GB of model storage.

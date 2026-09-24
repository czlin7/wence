# Local language runtime

The `packages/` directory contains CPU builds of [llama.cpp](https://github.com/ggml-org/llama.cpp) b11160 for Windows x64/ARM64 and macOS Intel/Apple Silicon. The application verifies and extracts only the current computer's runtime on first launch.

The language model is downloaded on first launch from [ModelScope](https://modelscope.cn/models/lmstudio-community/Qwen3-1.7B-GGUF) and saved under the project `Models/` directory. It is the Qwen3-1.7B Q4_K_M GGUF file (1,282,439,328 bytes); its SHA-256 is pinned in the Go service. Model inference is served on loopback and does not require a model API key.

See [`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for license details.

# Third-party notices

This project packages the following components for its local language feature:

- **llama.cpp b11160** — MIT License. The Windows CPU packages also include LLVM OpenMP runtime files under their accompanying license. License copies are in [`third_party/licenses/`](third_party/licenses/).
- **Qwen3-1.7B** — Apache License 2.0. The project downloads the Q4_K_M GGUF quantization from [ModelScope](https://modelscope.cn/models/lmstudio-community/Qwen3-1.7B-GGUF); the upstream model is [Qwen/Qwen3-1.7B](https://modelscope.cn/models/Qwen/Qwen3-1.7B). The model is not included in the repository archive.

The packaged llama.cpp builds and model file are pinned in [`server/local_llm.go`](server/local_llm.go). Model downloads are verified against a SHA-256 checksum before use.

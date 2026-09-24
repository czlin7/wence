# Changelog

Notable changes to this project are recorded here. This changelog follows the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Added

- Cross-platform Go backend and launchers for macOS and Windows.
- Runtime builds for macOS Apple Silicon and Intel, plus Windows x64 and ARM64.
- Automatic token loading from the local `api_key.txt` file and paste-friendly startup prompts.
- Concise English and Simplified Chinese user guides.
- Git ignore rules for credentials, runtime logs, editor files, and generated output.
- A local Qwen3 assistant for customer-facing reply openings, with first-run setup progress in the browser.
- Bundled llama.cpp runtime archives and checksum-verified ModelScope model downloads.
- Display the current application version in the header.

### Changed

- The shared backend now serves the web interface and retrieves Tushare data on both supported operating systems.
- Both launchers write runtime output to `Logs/wence_v3.log` inside the project.
- Customer-facing reply bodies retain their verified analysis data; the local model supplies only the opening sentence.
- Updated the overview's current-price and 20-day-average comparison.

### Removed

- Replaced the standalone `使用说明.txt` with the bilingual README files.

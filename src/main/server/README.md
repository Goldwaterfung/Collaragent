# Main Process Servers

This directory contains the various server implementations managed by the Main process.

## Subdirectories

-   `fileServer/`: Implementation of the File Server / Storage Engine utility process. This handles physical file I/O and provides a local HTTP API for workspace operations.
-   `ws/`: WebSocket server implementation for real-time synchronization between the renderer and the workspace instance.

## Architecture

-   **Separation**: The File Server runs as a separate Electron utility process to ensure file I/O doesn't block the main process.
-   **Communication**: The Main process communicates with these servers via IPC or HTTP local-loopback.

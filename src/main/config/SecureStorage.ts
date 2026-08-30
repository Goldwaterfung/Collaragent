import { safeStorage, app } from "electron";
import fs from "fs";
import path from "path";

/**
 * Manages secure storage of API keys using Electron's safeStorage.
 * Keys are stored encrypted in a separate JSON file, not in the main config.
 */
export class SecureStorage {
  private storePath: string;
  private keys: Record<string, string> = {}; // In-memory cache of ENCRYPTED keys

  constructor() {
    this.storePath = path.join(app.getPath("home"), ".collaragent", "secrets.json");
    this.ensureDirectory();
    this.loadKeys();
  }

  private ensureDirectory() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadKeys() {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, "utf-8");
        this.keys = JSON.parse(data);
      }
    } catch (error) {
      console.error("Failed to load secure keys:", error);
      // Fallback to empty
      this.keys = {};
    }
  }

  private saveKeys() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.keys, null, 2), {
        mode: 0o600, // Read/write only by owner
      });
    } catch (error) {
      console.error("Failed to save secure keys:", error);
    }
  }

  /**
   * Check if encryption is available
   */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Store an API key for a specific provider
   */
  setApiKey(provider: string, apiKey: string): boolean {
    if (!this.isAvailable()) {
      console.error("Encryption not available on this system");
      return false;
    }

    try {
      const buffer = safeStorage.encryptString(apiKey);
      this.keys[provider] = buffer.toString("base64");
      this.saveKeys();
      return true;
    } catch (error) {
      console.error(`Failed to encrypt key for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Retrieve an API key for a specific provider
   * returns the decrypted key or undefined if not found/error
   */
  getApiKey(provider: string): string | undefined {
    if (!this.keys[provider]) return undefined;
    
    if (!this.isAvailable()) {
      console.error("Encryption not available to decrypt key");
      return undefined;
    }

    try {
      const buffer = Buffer.from(this.keys[provider], "base64");
      return safeStorage.decryptString(buffer);
    } catch (error) {
      console.error(`Failed to decrypt key for ${provider}:`, error);
      return undefined;
    }
  }

  /**
   * Check if a key exists for a provider
   */
  hasKey(provider: string): boolean {
    return !!this.keys[provider];
  }

  /**
   * Remove a key for a provider
   */
  deleteKey(provider: string): void {
    if (this.keys[provider]) {
      delete this.keys[provider];
      this.saveKeys();
    }
  }
}

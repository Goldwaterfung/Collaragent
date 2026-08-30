import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { ChatCheckpointSaver } from "@collaragent/checkpoint";

export class PersistenceManager {
  private chatSavers: Map<number, ChatCheckpointSaver> = new Map();

  constructor() {
    // No-op
  }

  getCheckpointer(_threadId?: string, options?: { apiPort?: number }): BaseCheckpointSaver | undefined {
    // If apiPort is provided, we use the filesystem-based ChatCheckpointSaver
    if (options?.apiPort) {
        if (!this.chatSavers.has(options.apiPort)) {
            this.chatSavers.set(options.apiPort, new ChatCheckpointSaver(options.apiPort));
        }
        return this.chatSavers.get(options.apiPort)!;
    }

    // No persistence if no project/apiPort is available
    return undefined;
  }

  async getLatestCheckpointId(
    threadId: string,
    options?: { apiPort?: number; checkpointNs?: string }
  ): Promise<string | undefined> {
    if (!options?.apiPort) return undefined;
    if (!this.chatSavers.has(options.apiPort)) {
      this.chatSavers.set(options.apiPort, new ChatCheckpointSaver(options.apiPort));
    }

    const saver = this.chatSavers.get(options.apiPort)!;
    return saver.getLatestCheckpointId(threadId, options.checkpointNs ?? "");
  }
  
  async setup() {
    // No-op
  }
}
